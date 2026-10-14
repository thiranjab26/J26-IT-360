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
from app.gamification.progression import (
    BADGE_BY_ID,
    BADGES,
    BONUS_LABELS,
    BONUSES,
    Badge,
    current_streak,
    level_for,
    longest_streak,
)
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
    BadgeOut,
    BadgeStatusOut,
    BonusOut,
    ConceptProgressOut,
    FeedbackOut,
    HistoryOut,
    HistoryPartOut,
    LeaderboardOut,
    LeaderEntryOut,
    LevelOut,
    LevelUpOut,
    OptionOut,
    PositionOut,
    ProfileOut,
    ProgressOut,
    QuestionOut,
    QuestOut,
    RequirementOut,
    RewardsOut,
    SessionOut,
    SourceOut,
    StreakOut,
    SummaryOut,
)
from app.retrieval.hybrid import BM25, tokens
from app.sessions.catalog import Course, UnknownModule
from app.sessions.gate_log import record_audits
from app.sessions.grounding import Grounding, primary_only
from app.sessions.plan import build_plan
from app.sessions.repository import (
    AttemptRecord,
    CachedExplanation,
    SessionRepository,
    StoredSession,
    StoredText,
)
from app.sessions.rewards import Earned, RewardEngine
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
from app.verification.fill import Filler

GENERIC_HINT = (
    "Look back at the explanation you just read, then trace the code one line at a time. "
    "Write down the value of each variable after every step."
)


def _check(text: StoredText) -> str | None:
    """How a stored text relates to the faithfulness gate, for the screen."""
    if text.source == "generated":
        return "verified" if text.verified else "unchecked"
    return "blocked" if text.verified is False else None


def _sources_out(text: StoredText) -> list[SourceOut] | None:
    if text.source != "generated" or not text.sources:
        return None
    return [SourceOut(**item) for item in text.sources]


def _badge_out(badge: Badge) -> BadgeOut:
    return BadgeOut(
        id=badge.id, name=badge.name, description=badge.description, rarity=badge.rarity
    )


def _level_out(total_xp: int) -> LevelOut:
    p = level_for(total_xp)
    return LevelOut(
        number=p.level.number,
        name=p.level.name,
        total_xp=total_xp,
        xp_into_level=p.xp_into_level,
        xp_for_next=p.xp_for_next,
        percent=p.percent,
        next_name=p.next_level.name if p.next_level else None,
    )


def _short_name(full_name: str) -> str:
    """First name and the initial of the last, so a leaderboard names nobody in full."""
    parts = full_name.split()
    if len(parts) < 2:
        return full_name or "Student"
    return f"{parts[0]} {parts[-1][0]}."


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
        timezone: str = "Asia/Colombo",
        grounding: Callable[[Course, str], Grounding] | None = None,
        filler: Filler | None = None,
        fill_wait: float = 150.0,
    ) -> None:
        self.repo = repo
        self._courses = courses
        self.clock = clock
        self.policy = policy
        self.enforce_unlocks = enforce_unlocks
        self.rules = rules or Rules()
        self.unlock_rules = unlock_rules or UnlockRules()
        self.writer = writer or TutorWriter(None)
        self.timezone = timezone
        self._grounding = grounding
        self.filler = filler
        self.fill_wait = fill_wait
        self.rewards = RewardEngine(repo, self.unlock_rules, self._estimate, timezone)

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
        earned = None
        if stored.state.is_over:  # the last Continue completes a session
            earned = self._pay(stored.state, course, now=self.clock())
        return self._view(stored, course, earned=earned)

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

        correct = verdict.outcome == "correct"
        history = self.repo.gating_attempts(state.user_id) if gating and correct else None

        # A correct gating answer may lift mastery enough to finish early.
        if history is not None:
            results = results_from_attempts(history, self.rules.max_attempts)
            level = self._estimate(course, state.concept_id, results.get(state.concept_id, []))
            if level is not None and level >= self.unlock_rules.early_exit_mastery:
                new_state = step(new_state, MasteryReached(), now).state

        stored = replace(stored, state=new_state)
        self.repo.save(stored)

        earned = None
        if correct:  # a wrong or unreadable answer pays nothing
            earned = self._pay(
                new_state,
                course,
                now=now,
                points=xp,
                history=history,
                gating_passed=gating,
                attempt_no=attempt_no,
            )
        return self._view(stored, course, with_feedback=True, earned=earned)

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
            level=_level_out(total_xp),
            quests=self._quests(user_id, course, mastery),
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

    def profile(self, user_id: str) -> ProfileOut:
        """The student's level, streak and badges, across every module."""
        now = self.clock()
        today = self.rewards.today(now)
        days = self.repo.activity_days(user_id, self.timezone)
        held = self.repo.badges(user_id)
        total = self.repo.total_xp(user_id)
        return ProfileOut(
            total_xp=total,
            level=_level_out(total),
            streak=StreakOut(
                current=current_streak(days, today),
                longest=longest_streak(days),
                learned_today=today in set(days),
            ),
            badges=[
                BadgeStatusOut(
                    **_badge_out(b).model_dump(), earned=b.id in held, earned_at=held.get(b.id)
                )
                for b in BADGES
            ],
            completed_sessions=self.repo.completed_session_count(user_id),
        )

    def leaderboard(self, user_id: str, limit: int = 10) -> LeaderboardOut:
        rows = self.repo.leaderboard(limit + 50)  # a little past the top, to find the caller
        names = self.repo.display_names([r.user_id for r in rows])

        def entry(rank: int, row) -> LeaderEntryOut:
            lvl = level_for(row.xp).level
            return LeaderEntryOut(
                rank=rank,
                name=_short_name(names.get(row.user_id, "Student")),
                xp=row.xp,
                level_number=lvl.number,
                level_name=lvl.name,
                is_you=row.user_id == user_id,
            )

        ranked = [entry(i, r) for i, r in enumerate(rows, 1)]
        top = ranked[:limit]
        you = None if any(e.is_you for e in top) else next((e for e in ranked if e.is_you), None)
        return LeaderboardOut(entries=top, you=you)

    def _quests(
        self, user_id: str, course: Course, mastery: dict[str, float | None]
    ) -> list[QuestOut]:
        claimed = self.repo.bonus_refs(user_id, "quest")
        quests = []
        for topic, members in course.topics.items():
            done = sum(is_mastered(mastery.get(c), self.unlock_rules) for c in members)
            quests.append(
                QuestOut(
                    topic=topic,
                    concept_ids=list(members),
                    mastered=done,
                    total=len(members),
                    complete=done == len(members),
                    reward_xp=BONUSES.quest,
                    reward_claimed=topic in claimed,
                )
            )
        return quests

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
    def _pay(
        self,
        state: SessionState,
        course: Course,
        *,
        now: datetime,
        points: int = 0,
        history=None,
        gating_passed: bool = False,
        attempt_no: int = 0,
    ) -> Earned:
        """Bonus XP and badges for what just happened. See rewards.py."""
        needs_history = gating_passed or state.is_over
        if history is None and needs_history:
            history = self.repo.gating_attempts(state.user_id)
        results = results_from_attempts(history, self.rules.max_attempts) if history else {}
        return self.rewards.award(
            user_id=state.user_id,
            course=course,
            state=state,
            now=now,
            results=results,
            gating_attempts=history or [],
            points=points,
            gating_passed=gating_passed,
            attempt_no=attempt_no,
            reteach_after=self.rules.reteach_after,
        )

    def _rewards_out(self, earned: Earned | None) -> RewardsOut | None:
        if earned is None or not earned.anything or earned.total_xp is None:
            return None
        before = level_for(earned.total_xp - earned.xp_gained).level
        after = level_for(earned.total_xp)
        return RewardsOut(
            xp_gained=earned.xp_gained,
            points=earned.points,
            bonuses=[BonusOut(kind=b.kind, label=b.label, amount=b.amount) for b in earned.bonuses],
            badges=[_badge_out(b) for b in earned.badges],
            level=_level_out(earned.total_xp),
            level_up=(
                LevelUpOut(
                    from_level=before.number, to_level=after.level.number, name=after.level.name
                )
                if after.level.number > before.number
                else None
            ),
        )

    def _view(
        self,
        stored: StoredSession,
        course: Course,
        *,
        with_feedback: bool = False,
        earned: Earned | None = None,
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
        if phase is not Phase.ENDED:
            self._prefetch(state, course)

        out.rewards = self._rewards_out(earned)

        if phase is Phase.ENDED:
            results = self._concept_results(state.user_id, state.concept_id)
            recorded = self.repo.session_rewards(state.session_id)
            bonuses = [
                BonusOut(kind=r.kind, label=BONUS_LABELS[r.kind], amount=r.amount)
                for r in recorded
                if r.kind != "badge"
            ]
            bonus_xp = sum(b.amount for b in bonuses)
            out.xp_earned = xp + bonus_xp
            out.summary = SummaryOut(
                exit_reason=state.exit.value if state.exit else "completed",
                xp_earned=xp + bonus_xp,
                bonuses=bonuses,
                badges=[_badge_out(BADGE_BY_ID[r.ref]) for r in recorded if r.kind == "badge"],
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
                state, f"teach:{step_.ref}", EXPLAIN, course, passage_id=step_.ref, fallback=passage
            )
            out.text, out.text_source = shown.text, shown.source
            out.text_check = _check(shown)
            out.sources = _sources_out(shown)
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
                    passage_id=self._closest_ref(course, state, step_.ref),
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
                hint_check=_check(hint) if hint else None,
            )
            if last is not None and last.question_id == step_.ref and last.outcome == "unreadable":
                out.feedback = self._feedback(last, state, course)
        else:  # feedback or reteach: the answer was judged
            if last is not None:
                out.feedback = self._feedback(last, state, course)
            if phase is Phase.RETEACH:
                out.heading = "Let's look at that again"
                ref = self._closest_ref(course, state, step_.ref)
                passage = course.chunk_text[ref]
                shown = self._words(
                    state,
                    f"reteach:{step_.ref}:{state.attempts}",
                    RETEACH,
                    course,
                    passage_id=ref,
                    fallback=passage,
                )
                out.text, out.text_source = shown.text, shown.source
                out.text_check = _check(shown)
                out.sources = _sources_out(shown)
                out.source_text = passage if shown.source == "generated" else None
        return out

    def _prefetch(self, state: SessionState, course: Course) -> None:
        """While the student reads, prepare the next explanation so it is ready when they
        click. It never waits; if they are quicker than it, the click waits for it instead."""
        if self.filler is None or self.writer.cache_fingerprint(EXPLAIN) is None:
            return
        upcoming = next((st for st in state.steps[state.index + 1 :] if st.kind == "teach"), None)
        if upcoming is not None:
            self.filler.prefetch(EXPLAIN, course.module_id, upcoming.ref)

    def history(self, user_id: str, session_id: str) -> HistoryOut:
        """The parts already read, in order, exactly as the student saw them."""
        stored, course = self._load(user_id, session_id)
        state = stored.state
        shown = self.repo.session_texts(session_id)
        parts: list[HistoryPartOut] = []
        for number, step_ in enumerate(state.steps[: state.index], 1):
            if step_.kind == "hook":
                parts.append(
                    HistoryPartOut(
                        step_number=number,
                        heading="What you will be able to do",
                        text=course.objectives(state.concept_id) or course.titles[state.concept_id],
                        text_source="authored",
                    )
                )
            elif step_.kind == "teach":
                text = shown.get(f"teach:{step_.ref}")
                parts.append(
                    HistoryPartOut(
                        step_number=number,
                        heading=course.titles[state.concept_id],
                        text=text.text if text else course.chunk_text[step_.ref],
                        text_source=text.source if text else "authored",
                        text_check=_check(text) if text else None,
                        sources=_sources_out(text) if text else None,
                    )
                )
        return HistoryOut(parts=parts)

    def _ground(self, course: Course, passage_id: str) -> Grounding:
        """The main passage and the passages retrieved to help with it."""
        return (self._grounding or primary_only)(course, passage_id)

    def _words(
        self,
        state: SessionState,
        key: str,
        kind: str,
        course: Course,
        *,
        passage_id: str,
        fallback: str,
        question: str | None = None,
        expected_output: str | None = None,
    ) -> StoredText:
        """What the tutor says at one point. Written once, then read back on every view."""
        saved = self.repo.get_text(state.session_id, key)
        if saved is not None:
            return saved

        # A hint is about one question and short, so it is built from the main passage alone.
        ground = (
            primary_only(course, passage_id) if kind == HINT else self._ground(course, passage_id)
        )
        fingerprint = self.writer.cache_fingerprint(kind)
        digest = ground.digest
        sources = [s.as_json() for s in ground.sources] if kind != HINT else None

        if fingerprint is not None:
            # An explanation the gate already passed for this material, prompt, model and gate
            # setting is shared: no model call, no new check, and the student still gets text
            # that was verified.
            hit = self.repo.get_verified(passage_id, digest, fingerprint)
            if hit is not None:
                saved = StoredText(
                    hit.text, "generated", hit.provider, hit.model, True, hit.output_id, hit.sources
                )
                self.repo.put_text(state.session_id, key, saved)
                return saved

            if self.filler is not None:
                # Not prepared yet, and the student has just asked for this part. Prepare it
                # now (retrieve, write, check) and wait, so what they see is the finished,
                # checked text. Never the course text first and a swap later.
                self.repo.commit()  # hold no connection or lock while the model and checker run
                self.filler.wait(kind, course.module_id, passage_id, self.fill_wait)
                hit = self.repo.get_verified(passage_id, digest, fingerprint)
                if hit is not None:
                    saved = StoredText(
                        hit.text,
                        "generated",
                        hit.provider,
                        hit.model,
                        True,
                        hit.output_id,
                        hit.sources,
                    )
                else:
                    # The checker rejected every attempt, or the model could not be reached.
                    # Say which, and keep what the student saw so it never changes under them.
                    failed = self.filler.recently_failed(kind, course.module_id, passage_id)
                    saved = StoredText(fallback, "authored", verified=False if failed else None)
                self.repo.put_text(state.session_id, key, saved)
                return saved

        result = self.writer.write(
            kind,
            concept=course.titles[state.concept_id],
            passage=ground.primary,
            question=question,
            support=ground.support if kind != HINT else (),
        )
        output_id = record_audits(self.repo, result.audits, passage_id)

        made = result.generated
        if made is not None and not (kind == HINT and gives_away(made.text, expected_output)):
            saved = StoredText(
                made.text, "generated", made.provider, made.model, made.verified, output_id, sources
            )
        else:
            # Nothing generated reached the student: the authored text is shown. `verified`
            # is False when the gate was the reason, so the screen can say so.
            saved = StoredText(fallback, "authored", verified=False if result.blocked else None)
        self.repo.put_text(state.session_id, key, saved)
        if fingerprint is not None and saved.source == "generated" and saved.verified is True:
            self.repo.put_verified(
                passage_id,
                digest,
                fingerprint,
                CachedExplanation(
                    saved.text, saved.provider or "", saved.model or "", output_id, sources
                ),
            )
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
    def _closest_ref(course: Course, state: SessionState, question_id: str) -> str:
        """The explanation part closest to the question the student keeps missing."""
        refs = course.theory[state.concept_id]
        stem = course.bank[question_id].question.stem
        scores = BM25([tokens(course.chunk_text[r]) for r in refs]).scores(tokens(stem))
        best = max(scores, key=scores.__getitem__) if scores else 0
        return refs[best]
