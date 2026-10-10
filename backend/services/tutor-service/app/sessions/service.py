"""Guided sessions, end to end: start, teach, check, answer, end, resume.

This is the glue between the pure parts (state machine, plan, marking, XP, mastery,
unlock rules) and the world (a repository and a clock). It holds no rules of its own.
It has no FastAPI imports: the routes translate `SessionProblem` into HTTP errors.

What it does not do yet is write the teaching. Explanations are the authored course
passages and a hint is a fixed nudge; the language model and the faithfulness gate
replace both in P2 and P3 without changing anything about how a session moves.

Three rules worth knowing:
  * A student has at most one active session. Starting another concept ends the old one
    as `student_ended` (resumable). Starting the same concept returns the one in progress.
  * The answer key never leaves this module before the student has answered. Feedback
    carries the authored explanation only after a correct answer, or after a wrong quick
    check (which never blocks anything).
  * Multiple-choice options are shuffled, from a seed made of the session and question,
    so a page refresh shows the same order and the marking agrees with what was shown.
"""

from __future__ import annotations

import random
import uuid
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import UTC, datetime

from app.domain.questions import AnswerKey, BankEntry, Question, shuffled
from app.gamification.mastery import MIN_EVIDENCE, CheckpointResult, estimate
from app.gamification.rules import (
    Policy,
    UnlockRules,
    is_mastered,
    module_status,
    next_concept,
    unlock_status,
)
from app.gamification.xp import xp_for_checkpoint
from app.grading.deterministic import grade
from app.models.sessions import (
    ConceptProgressOut,
    FeedbackOut,
    OptionOut,
    PositionOut,
    ProgressOut,
    QuestionOut,
    RequirementOut,
    SessionOut,
    SummaryOut,
)
from app.retrieval.hybrid import BM25, tokens
from app.sessions.catalog import Course, UnknownModule
from app.sessions.plan import build_plan
from app.sessions.repository import AttemptRecord, SessionRepository, StoredSession, StoredText
from app.sessions.state_machine import (
    Answer,
    Continue,
    EndedByStudent,
    InvalidTransition,
    MasteryReached,
    Phase,
    Rules,
    SessionState,
    Tick,
    can_resume,
    resume,
    start,
    step,
)
from app.sessions.writer import EXPLAIN, HINT, RETEACH, TutorWriter, gives_away

GENERIC_HINT = (
    "Look back at the explanation you just read, then trace the code one line at a time. "
    "Write down the value of each variable after every step."
)


class SessionProblem(Exception):
    """Something the caller did that the service refuses. `kind` picks the HTTP status."""

    def __init__(self, kind: str, code: str, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.kind = kind  # not_found | conflict | forbidden
        self.code = code
        self.message = message
        self.details = details or {}


def results_from_attempts(
    attempts: Sequence[tuple[str, AttemptRecord]], max_attempts: int
) -> dict[str, list[CheckpointResult]]:
    """Gating results per concept, oldest first, from the attempts recorded.

    One result per (session, question): passed with the try that got it right, or failed
    after using every try. A question the student walked away from mid-way (one miss, say)
    is unfinished and says nothing either way, so it is left out.
    """
    groups: dict[tuple[str, str], list[AttemptRecord]] = defaultdict(list)
    for session_id, attempt in attempts:
        groups[(session_id, attempt.question_id)].append(attempt)

    finished: list[tuple[datetime, str, CheckpointResult]] = []
    for group in groups.values():
        right = next((a for a in group if a.outcome == "correct"), None)
        if right is not None:
            finished.append(
                (right.created_at, right.concept_id, CheckpointResult(True, right.attempt_no))
            )
        elif len(group) >= max_attempts:
            last = group[-1]
            finished.append(
                (last.created_at, last.concept_id, CheckpointResult(False, max_attempts))
            )

    by_concept: dict[str, list[CheckpointResult]] = defaultdict(list)
    for _, concept_id, result in sorted(finished, key=lambda item: item[0]):
        by_concept[concept_id].append(result)
    return dict(by_concept)


class SessionService:
    def __init__(
        self,
        repo: SessionRepository,
        courses: Callable[[str], Course],
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        policy: Policy = Policy.MASTERY_GATED,
        enforce_unlocks: bool = True,
        rules: Rules | None = None,
        unlock_rules: UnlockRules | None = None,
        writer: TutorWriter | None = None,
    ) -> None:
        self.repo = repo
        self._courses = courses
        self.clock = clock
        self.policy = policy
        self.enforce_unlocks = enforce_unlocks
        self.rules = rules or Rules()
        self.unlock_rules = unlock_rules or UnlockRules()
        self.writer = writer or TutorWriter(None)

    # ------------------------------------------------------------------ actions
    def start(self, user_id: str, concept_id: str) -> SessionOut:
        course = self._course_of(concept_id)
        if not course.has_concept(concept_id):
            raise SessionProblem(
                "not_found", "concept_not_found", f"No concept with id {concept_id!r}."
            )

        now = self.clock()
        active = self._expire(self.repo.get_active(user_id), now)
        if active is not None and not active.state.is_over:
            if active.state.concept_id == concept_id:
                return self._view(active, course)
        elif active is not None:
            active = None  # it had just timed out

        self._require_unlocked(user_id, course, concept_id)

        if active is not None:  # a different concept is in progress: put it down, resumably
            self.repo.save(self._apply(active, EndedByStudent(), now))

        session_id = str(uuid.uuid4())
        seen = self.repo.seen_questions(user_id, concept_id)
        plan = build_plan(
            concept_id=concept_id, teach_refs=course.theory[concept_id], bank=course.bank, seen=seen
        )
        state = start(
            session_id=session_id,
            user_id=user_id,
            concept_id=concept_id,
            steps=plan,
            now=now,
            rules=self.rules,
        ).state
        stored = StoredSession(state, course.module_id, self.policy.value)

        if not self.repo.create(stored):  # two starts at once: the other one won
            winner = self.repo.get_active(user_id)
            if winner is not None and winner.state.concept_id == concept_id:
                return self._view(winner, course)
            raise SessionProblem(
                "conflict", "session_in_progress", "You already have a session in progress."
            )
        return self._view(stored, course)

    def view(self, user_id: str, session_id: str) -> SessionOut:
        stored, course = self._load(user_id, session_id)
        return self._view(stored, course)

    def cont(self, user_id: str, session_id: str) -> SessionOut:
        stored, course = self._load(user_id, session_id)
        self._require_open(stored)
        stored = self._advance(stored, Continue())
        return self._view(stored, course)

    def answer(self, user_id: str, session_id: str, text: str) -> SessionOut:
        stored, course = self._load(user_id, session_id)
        self._require_open(stored)
        state = stored.state
        if state.phase is not Phase.CHECKPOINT:
            raise SessionProblem(
                "conflict", "not_awaiting_answer", "There is no question open right now."
            )

        now = self.clock()
        current = state.current
        entry = course.bank[current.ref]
        question, key = self._presented(state.session_id, entry)
        verdict = grade(question, key, text)

        gating = current.gating
        attempt_no = state.attempts + 1 if gating else 1
        xp = 0
        if verdict.outcome == "correct":
            xp = xp_for_checkpoint(
                gating=gating, passed=True, attempts_used=attempt_no, hints_used=attempt_no - 1
            )
        self.repo.add_attempt(
            AttemptRecord(
                session_id=state.session_id,
                question_id=current.ref,
                concept_id=state.concept_id,
                kind=question.kind,
                gating=gating,
                attempt_no=attempt_no,
                answer=text,
                outcome=verdict.outcome,
                reason=verdict.reason,
                xp=xp,
                hints_used=attempt_no - 1 if gating else 0,
                created_at=now,
            )
        )

        transition = step(state, Answer(verdict.outcome), now)
        new_state = transition.state

        # A correct gating answer may lift mastery enough to finish early.
        if gating and verdict.outcome == "correct":
            level = self._estimate(
                course, state.concept_id, self._concept_results(state.user_id, state.concept_id)
            )
            if level is not None and level >= self.unlock_rules.early_exit_mastery:
                new_state = step(new_state, MasteryReached(), now).state

        stored = replace(stored, state=new_state)
        self.repo.save(stored)
        return self._view(stored, course, with_feedback=True)

    def end(self, user_id: str, session_id: str) -> SessionOut:
        stored, course = self._load(user_id, session_id)
        if not stored.state.is_over:
            stored = self._advance(stored, EndedByStudent())
        return self._view(stored, course)

    def resume(self, user_id: str, session_id: str) -> SessionOut:
        stored, course = self._load(user_id, session_id)
        now = self.clock()
        if not can_resume(stored.state, now):
            raise SessionProblem(
                "conflict",
                "cannot_resume",
                "This session cannot be resumed. Start the concept again instead.",
                {"exit_reason": stored.state.exit.value if stored.state.exit else None},
            )

        other = self._expire(self.repo.get_active(user_id), now)
        if other is not None and not other.state.is_over:
            self.repo.save(self._apply(other, EndedByStudent(), now))

        stored = replace(stored, state=resume(stored.state, now).state)
        self.repo.save(stored)
        return self._view(stored, course)

    def progress(self, user_id: str, module_id: str) -> ProgressOut:
        try:
            course = self._courses(module_id)
        except UnknownModule:
            raise SessionProblem(
                "not_found", "module_not_found", f"No module with id {module_id!r}."
            ) from None

        results = self._results(user_id)
        mastery = {c: self._estimate(course, c, results.get(c, ())) for c in course.order}
        total_xp = self.repo.total_xp(user_id)
        statuses = module_status(
            course.order,
            prerequisites=course.prerequisites,
            mastery=mastery,
            total_xp=total_xp,
            policy=self.policy,
            rules=self.unlock_rules,
        )

        active = self._expire(self.repo.get_active(user_id), self.clock())
        return ProgressOut(
            module_id=module_id,
            policy=self.policy.value,
            total_xp=total_xp,
            next_concept_id=next_concept(statuses, mastery, self.unlock_rules),
            active_session_id=(
                active.state.session_id if active and not active.state.is_over else None
            ),
            concepts=[
                ConceptProgressOut(
                    concept_id=s.concept_id,
                    title=course.titles[s.concept_id],
                    unlocked=s.unlocked or not self.enforce_unlocks,
                    mastery=mastery[s.concept_id],
                    mastered=is_mastered(mastery[s.concept_id], self.unlock_rules),
                    unmet=[
                        RequirementOut(
                            kind=r.kind,
                            concept_id=r.concept_id,
                            required=r.required,
                            current=r.current,
                        )
                        for r in s.unmet
                    ],
                )
                for s in statuses
            ],
        )

    # ------------------------------------------------------------------ helpers
    def _course_of(self, concept_id: str) -> Course:
        module_id = concept_id.partition(".")[0]
        try:
            return self._courses(module_id)
        except UnknownModule:
            raise SessionProblem(
                "not_found", "concept_not_found", f"No concept with id {concept_id!r}."
            ) from None

    def _load(self, user_id: str, session_id: str) -> tuple[StoredSession, Course]:
        stored = self.repo.get(session_id, lock=True)
        # Someone else's session is reported as missing, so ids cannot be probed.
        if stored is None or stored.state.user_id != user_id:
            raise SessionProblem("not_found", "session_not_found", "No such session.")
        stored = replace(stored, state=replace(stored.state, rules=self.rules))
        stored = self._expire(stored, self.clock()) or stored
        return stored, self._courses(stored.module_id)

    def _expire(self, stored: StoredSession | None, now: datetime) -> StoredSession | None:
        """End a session that has sat silent too long. Saves the change."""
        if stored is None or stored.state.is_over:
            return stored
        stored = replace(stored, state=replace(stored.state, rules=self.rules))
        timed_out = step(stored.state, Tick(), now).state
        if not timed_out.is_over:
            return stored
        stored = replace(stored, state=timed_out)
        self.repo.save(stored)
        return stored

    def _apply(self, stored: StoredSession, event, now: datetime) -> StoredSession:
        try:
            return replace(stored, state=step(stored.state, event, now).state)
        except InvalidTransition as exc:
            raise SessionProblem("conflict", "invalid_action", str(exc)) from exc

    def _advance(self, stored: StoredSession, event) -> StoredSession:
        stored = self._apply(stored, event, self.clock())
        self.repo.save(stored)
        return stored

    @staticmethod
    def _require_open(stored: StoredSession) -> None:
        if stored.state.is_over:
            raise SessionProblem(
                "conflict",
                "session_ended",
                "This session has ended.",
                {"exit_reason": stored.state.exit.value if stored.state.exit else None},
            )

    def _require_unlocked(self, user_id: str, course: Course, concept_id: str) -> None:
        if not self.enforce_unlocks:
            return
        mastery = {
            c: self._estimate(course, c, rs)
            for c, rs in self._results(user_id).items()
            if c in course.titles
        }
        status = unlock_status(
            concept_id,
            prerequisites=course.prerequisites,
            mastery=mastery,
            total_xp=self.repo.total_xp(user_id),
            policy=self.policy,
            rules=self.unlock_rules,
        )
        if not status.unlocked:
            raise SessionProblem(
                "forbidden",
                "concept_locked",
                f"{course.titles[concept_id]} is locked until you have mastered what it builds on.",
                {
                    "concept_id": concept_id,
                    "unmet": [
                        {
                            "kind": r.kind,
                            "concept_id": r.concept_id,
                            "required": r.required,
                            "current": r.current,
                        }
                        for r in status.unmet
                    ],
                },
            )

    def _results(self, user_id: str) -> dict[str, list[CheckpointResult]]:
        return results_from_attempts(self.repo.gating_attempts(user_id), self.rules.max_attempts)

    def _concept_results(self, user_id: str, concept_id: str) -> list[CheckpointResult]:
        return self._results(user_id).get(concept_id, [])

    @staticmethod
    def _estimate(
        course: Course, concept_id: str, results: Sequence[CheckpointResult]
    ) -> float | None:
        """Mastery from gating results. A concept with fewer gating questions than the
        usual minimum evidence (the Java intro has one) must not be unmasterable, so the
        minimum is capped at what the concept can offer."""
        needed = max(1, min(MIN_EVIDENCE, course.gating_count(concept_id)))
        return estimate(results, min_evidence=needed)

    @staticmethod
    def _presented(session_id: str, entry: BankEntry) -> tuple[Question, AnswerKey]:
        """The question as this session shows it. The same every time it is rebuilt."""
        rng = random.Random(f"{session_id}:{entry.question.question_id}")
        return shuffled(entry.question, entry.key, rng)

    # -------------------------------------------------------------------- views
    def _view(
        self, stored: StoredSession, course: Course, *, with_feedback: bool = False
    ) -> SessionOut:
        state = stored.state
        attempts = self.repo.attempts(state.session_id)
        xp = sum(a.xp for a in attempts)
        out = SessionOut(
            session_id=state.session_id,
            concept_id=state.concept_id,
            concept_title=course.titles[state.concept_id],
            phase=state.phase.value,
            position=PositionOut(
                step_number=min(state.index + 1, len(state.steps)),
                total_steps=len(state.steps),
                gating_done=state.gating_done,
                gating_total=state.gating_total,
            ),
            xp_earned=xp,
        )

        last = attempts[-1] if attempts else None
        phase = state.phase

        if phase is Phase.ENDED:
            results = self._concept_results(state.user_id, state.concept_id)
            out.summary = SummaryOut(
                exit_reason=state.exit.value if state.exit else "completed",
                xp_earned=xp,
                gating_done=state.gating_done,
                gating_total=state.gating_total,
                mastery=self._estimate(course, state.concept_id, results),
                can_resume=can_resume(state, self.clock()),
            )
            if with_feedback and last is not None:
                out.feedback = self._feedback(last, state, course)
            return out

        step_ = state.current
        if phase is Phase.HOOK:
            out.heading = "What you will be able to do"
            out.text = course.objectives(state.concept_id) or course.titles[state.concept_id]
        elif phase is Phase.TEACH:
            out.heading = course.titles[state.concept_id]
            passage = course.chunk_text[step_.ref]
            shown = self._words(
                state, f"teach:{step_.ref}", EXPLAIN, course, passage=passage, fallback=passage
            )
            out.text, out.text_source = shown.text, shown.source
            out.source_text = passage if shown.source == "generated" else None
        elif phase is Phase.CHECKPOINT:
            entry = course.bank[step_.ref]
            question, key = self._presented(state.session_id, entry)
            hint = None
            if step_.gating and state.attempts >= 1:
                hint = self._words(
                    state,
                    f"hint:{step_.ref}:{state.attempts}",
                    HINT,
                    course,
                    passage=self._reteach_passage(course, state, step_.ref),
                    fallback=GENERIC_HINT,
                    question=question.stem,
                    expected_output=key.expected_output,
                )
            out.question = QuestionOut(
                question_id=question.question_id,
                kind=question.kind,
                stem=question.stem,
                options=[OptionOut(letter=o.letter, text=o.text) for o in question.options],
                gating=step_.gating,
                attempt=state.attempts + 1 if step_.gating else 1,
                max_attempts=state.rules.max_attempts,
                hint=hint.text if hint else None,
                hint_source=hint.source if hint else None,
            )
            if last is not None and last.question_id == step_.ref and last.outcome == "unreadable":
                out.feedback = self._feedback(last, state, course)
        else:  # feedback or reteach: the answer was judged
            if last is not None:
                out.feedback = self._feedback(last, state, course)
            if phase is Phase.RETEACH:
                out.heading = "Let's look at that again"
                passage = self._reteach_passage(course, state, step_.ref)
                shown = self._words(
                    state,
                    f"reteach:{step_.ref}:{state.attempts}",
                    RETEACH,
                    course,
                    passage=passage,
                    fallback=passage,
                    question=course.bank[step_.ref].question.stem,
                )
                out.text, out.text_source = shown.text, shown.source
                out.source_text = passage if shown.source == "generated" else None
        return out

    def _words(
        self,
        state: SessionState,
        key: str,
        kind: str,
        course: Course,
        *,
        passage: str,
        fallback: str,
        question: str | None = None,
        expected_output: str | None = None,
    ) -> StoredText:
        """What the tutor says at one point. Written once, then read back on every view."""
        saved = self.repo.get_text(state.session_id, key)
        if saved is not None:
            return saved

        made = self.writer.write(
            kind, concept=course.titles[state.concept_id], passage=passage, question=question
        )
        if made is not None and not (kind == HINT and gives_away(made.text, expected_output)):
            saved = StoredText(made.text, "generated", made.provider, made.model)
        else:
            saved = StoredText(fallback, "authored")
        self.repo.put_text(state.session_id, key, saved)
        return saved

    def _feedback(self, last: AttemptRecord, state: SessionState, course: Course) -> FeedbackOut:
        if last.outcome == "unreadable":
            return FeedbackOut(
                outcome="unreadable",
                message="I could not read that as an answer. Nothing was counted, so try again.",
                attempt=last.attempt_no,
            )

        entry = course.bank[last.question_id]
        _, key = self._presented(state.session_id, entry)

        if last.outcome == "correct":
            return FeedbackOut(
                outcome="correct",
                message="Correct.",
                explanation=key.explanation or None,
                xp_earned=last.xp,
                attempt=last.attempt_no,
            )

        if not last.gating:  # a quick check never blocks, so there is nothing to hide
            return FeedbackOut(
                outcome="wrong",
                message="Not quite. Here is the answer.",
                explanation=key.explanation or None,
                correct_option=key.correct_option,
                attempt=1,
            )

        left = max(0, state.rules.max_attempts - last.attempt_no)
        return FeedbackOut(
            outcome="wrong",
            message="Not quite." if left else "Not quite, and that was your last try.",
            attempt=last.attempt_no,
            tries_left=left,
        )

    @staticmethod
    def _reteach_passage(course: Course, state: SessionState, question_id: str) -> str:
        """The explanation part closest to the question the student keeps missing."""
        refs = course.theory[state.concept_id]
        stem = course.bank[question_id].question.stem
        scores = BM25([tokens(course.chunk_text[r]) for r in refs]).scores(tokens(stem))
        best = max(scores, key=scores.__getitem__) if scores else 0
        return course.chunk_text[refs[best]]
