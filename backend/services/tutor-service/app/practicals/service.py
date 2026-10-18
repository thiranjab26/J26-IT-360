"""Practicals: write a Java program, run it, submit it against every test.

A practical is a program-writing question from the course. `run` tries the program on input the
student chooses and scores nothing. `submit` runs it on every test, visible and hidden, and the
practical is passed only if all of them match. The first pass pays a bonus (once per practical)
and may earn a badge, through the same ledger the guided sessions use.

No FastAPI imports: the routes translate `SessionProblem` into HTTP errors.
"""

from __future__ import annotations

from collections.abc import Callable

from app.gamification.progression import BONUS_LABELS, BONUSES, BadgeFacts, badges_due, level_for
from app.models.practicals import (
    PracticalListOut,
    PracticalOut,
    PracticalSummaryOut,
    RunOut,
    SubmitOut,
    TestResultOut,
    VisibleTestOut,
)
from app.models.sessions import BonusOut, LevelUpOut, RewardsOut
from app.practicals.catalog import AssessmentCatalog
from app.practicals.items import AssessmentStore, NoAssessmentStore
from app.practicals.repository import PracticalRepository, Standing
from app.practicals.runner import CodeRunner, RunnerUnavailable
from app.practicals.tests_builder import same_output, starter_for
from app.sessions.catalog import Course
from app.sessions.repository import SessionRepository
from app.sessions.service import SessionProblem, _badge_out, _level_out

CODE = "code"


def practical_id(question_id: str) -> str:
    """A question id made safe for a URL (the `#` becomes `~`)."""
    return question_id.replace("#", "~")


class PracticalService:
    def __init__(
        self,
        repo: PracticalRepository,
        game: SessionRepository,
        course: Course,
        runner: CodeRunner | None,
        *,
        unlocked: Callable[[str], set[str]] | None = None,
        items: AssessmentStore | None = None,
    ) -> None:
        self.repo = repo
        self.game = game  # the XP ledger and badges, shared with the guided sessions
        self.course = course
        self.runner = runner
        self._unlocked = unlocked
        self._items = items if items is not None else NoAssessmentStore()
        self._catalog: AssessmentCatalog | None = None

    @property
    def catalog(self) -> AssessmentCatalog:
        """The authored practicals with lecturer changes laid over, read once per request."""
        if self._catalog is None:
            self._catalog = AssessmentCatalog(self.course, self._items.all())
        return self._catalog

    # ---------------------------------------------------------------- reading
    def listing(self, user_id: str) -> PracticalListOut:
        ready = self.repo.tested()
        standing = self.repo.standings(user_id)
        open_concepts = self._open(user_id)
        items = []
        for entry in self.catalog.entries():
            q = entry.question
            s = standing.get(q.question_id)
            credited = self._credited(standing, q.question_id)
            items.append(
                PracticalSummaryOut(
                    practical_id=practical_id(q.question_id),
                    concept_id=q.concept_id,
                    concept_title=self.course.titles[q.concept_id],
                    level=q.level,
                    title=self._title(entry),
                    unlocked=open_concepts is None or q.concept_id in open_concepts,
                    ready=q.question_id in ready,
                    passed=credited,
                    best=f"{s.best_passed} of {s.total}" if s else None,
                )
            )
        return PracticalListOut(practicals=items)

    def detail(self, user_id: str, pid: str) -> PracticalOut:
        entry = self._entry(pid)
        q = entry.question
        self._require_open(user_id, q.concept_id)
        tests = self.repo.tests(q.question_id)
        credited = self._credited(self.repo.standings(user_id), q.question_id)
        return PracticalOut(
            practical_id=pid,
            concept_id=q.concept_id,
            concept_title=self.course.titles[q.concept_id],
            level=q.level,
            title=self._title(entry),
            statement=q.stem,
            starter_code=starter_for(q.stem),
            last_source=self.repo.last_source(user_id, q.question_id),
            visible_tests=[
                VisibleTestOut(stdin=t.stdin, expected=t.expected) for t in tests if t.visible
            ],
            tests_total=len(tests),
            passed=credited,
        )

    # ---------------------------------------------------------------- running
    def run(self, user_id: str, pid: str, source: str, stdin: str) -> RunOut:
        entry = self._entry(pid)
        self._require_open(user_id, entry.question.concept_id)
        batch = self._runner().run_batch(source, [stdin])
        if not batch.compiled:
            return RunOut(
                compiled=False, compile_output=batch.compile_output, status="not_compiled"
            )
        run = batch.runs[0]
        return RunOut(
            compiled=True,
            status=run.status,  # type: ignore[arg-type]
            stdout=run.stdout,
            stderr=run.stderr,
            ms=run.ms,
        )

    def submit(self, user_id: str, pid: str, source: str) -> SubmitOut:
        entry = self._entry(pid)
        q = entry.question
        self._require_open(user_id, q.concept_id)
        tests = self.repo.tests(q.question_id)
        if not tests:
            raise SessionProblem(
                "conflict",
                "practical_not_ready",
                "This practical has no tests yet, so it cannot be marked.",
            )

        batch = self._runner().run_batch(source, [t.stdin for t in tests])
        if not batch.compiled:
            self.repo.record_attempt(user_id, q.question_id, source, False, False, 0, len(tests))
            return SubmitOut(
                compiled=False,
                compile_output=batch.compile_output,
                passed=False,
                tests_passed=0,
                tests_total=len(tests),
            )

        results: list[TestResultOut] = []
        for number, (test, run) in enumerate(zip(tests, batch.runs, strict=True), 1):
            ok = run.status == "ok" and same_output(run.stdout, test.expected)
            results.append(
                TestResultOut(
                    number=number,
                    visible=test.visible,
                    passed=ok,
                    status=run.status,  # type: ignore[arg-type]
                    stdin=test.stdin if test.visible else None,
                    expected=test.expected if test.visible else None,
                    actual=run.stdout[:2000] if test.visible else None,
                    ms=run.ms,
                )
            )
        passed_count = sum(r.passed for r in results)
        passed = passed_count == len(results)
        self.repo.record_attempt(
            user_id, q.question_id, source, True, passed, passed_count, len(results)
        )

        return SubmitOut(
            compiled=True,
            passed=passed,
            tests_passed=passed_count,
            tests_total=len(results),
            results=results,
            rewards=self._reward(user_id, entry) if passed else None,
        )

    # --------------------------------------------------------------- rewards
    def _reward(self, user_id: str, entry) -> RewardsOut | None:
        """Pay the practical bonus the first time, and any badge it unlocks. None after that."""
        q = entry.question
        amount = BONUSES.practical_hard if q.level >= 5 else BONUSES.practical
        before = self.game.total_xp(user_id)
        # Paid once per SLOT, not per question: a student who cleared a practical that a lecturer
        # later replaced does not earn its bonus again by clearing the new one.
        slot = self.catalog.slot_of(q.question_id)
        if not self.game.add_xp_event(user_id, None, "practical", slot, amount):
            return None

        total = before + amount
        passed_count = len(
            {self.catalog.slot_of(q) for q, s in self.repo.standings(user_id).items() if s.passed}
        )
        owned = self.game.badges(user_id)
        facts = BadgeFacts(total_xp=total, practicals_passed=passed_count)
        earned = [b for b in badges_due(facts, owned) if self.game.award_badge(user_id, b.id, None)]

        was, now = level_for(before).level, level_for(total).level
        return RewardsOut(
            xp_gained=amount,
            points=0,
            bonuses=[BonusOut(kind="practical", label=BONUS_LABELS["practical"], amount=amount)],
            badges=[_badge_out(b) for b in earned],
            level=_level_out(total),
            level_up=(
                LevelUpOut(from_level=was.number, to_level=now.number, name=now.name)
                if now.number > was.number
                else None
            ),
        )

    # --------------------------------------------------------------- helpers
    def _runner(self) -> CodeRunner:
        if self.runner is None:
            raise SessionProblem(
                "unavailable", "runner_unavailable", "Running code is switched off on this server."
            )
        return _Guarded(self.runner)

    def _entry(self, pid: str):
        question_id = pid.replace("~", "#")
        entry = self.catalog.entry(question_id)
        if entry is None:
            # A practical a lecturer has just replaced: say what took its place, so a student
            # whose screen is out of date is taken there instead of meeting a dead end.
            successor = self.catalog.current_in(self.catalog.slot_of(question_id))
            if successor is not None:
                raise SessionProblem(
                    "not_found",
                    "practical_replaced",
                    "Your lecturer has just updated this practical.",
                    {"replaced_by": practical_id(successor.question.question_id)},
                )
            raise SessionProblem("not_found", "practical_not_found", "No such practical.")
        return entry

    def _title(self, entry) -> str:
        return self.catalog.title(entry)

    def _credited(self, standing: dict[str, Standing], question_id: str) -> bool:
        """Passed this practical, or any earlier version that filled its slot."""
        ids = self.catalog.question_ids_in(self.catalog.slot_of(question_id))
        return any(standing[q].passed for q in ids if q in standing)

    def _open(self, user_id: str) -> set[str] | None:
        return self._unlocked(user_id) if self._unlocked else None

    def _require_open(self, user_id: str, concept_id: str) -> None:
        open_concepts = self._open(user_id)
        if open_concepts is not None and concept_id not in open_concepts:
            raise SessionProblem(
                "forbidden",
                "concept_locked",
                f"{self.course.titles[concept_id]} is locked until you have mastered what it "
                "builds on.",
                {"concept_id": concept_id},
            )


class _Guarded:
    """A runner that turns "no JDK here" into the error a student can be told about."""

    def __init__(self, inner: CodeRunner) -> None:
        self._inner = inner

    def run_batch(self, source, stdins):
        try:
            return self._inner.run_batch(source, stdins)
        except RunnerUnavailable as exc:
            raise SessionProblem("unavailable", "runner_unavailable", str(exc)) from exc
