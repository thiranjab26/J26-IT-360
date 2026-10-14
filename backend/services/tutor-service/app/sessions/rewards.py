"""Pays out bonus XP and badges when a student does something that earns them.

The rules and numbers are in app/gamification/progression.py; this module applies them to a
real student's history. It runs after an answer is saved or a session ends, never before,
so it only ever rewards something that is already recorded.

Cost control: every check below is a database round trip, so the expensive ones run only
when they can change: mastery and quest checks on a passed gating checkpoint, the end of
session bonuses and streak when a session finishes. A multiple-choice quick check pays its
points and nothing else.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from app.gamification.mastery import CheckpointResult
from app.gamification.progression import (
    BONUS_LABELS,
    BONUSES,
    Badge,
    BadgeFacts,
    badges_due,
    current_streak,
    is_flawless,
)
from app.gamification.rules import UnlockRules, is_mastered
from app.sessions.catalog import Course
from app.sessions.repository import AttemptRecord, SessionRepository
from app.sessions.state_machine import ExitReason, SessionState

Estimate = Callable[[Course, str, Sequence[CheckpointResult]], "float | None"]


@dataclass(frozen=True)
class BonusEarned:
    kind: str
    label: str
    amount: int


@dataclass
class Earned:
    """What one request paid out."""

    points: int = 0  # the checkpoint XP for the answer itself
    bonuses: list[BonusEarned] = field(default_factory=list)
    badges: list[Badge] = field(default_factory=list)
    total_xp: int | None = None  # the student's total after this request, if it was needed

    @property
    def xp_gained(self) -> int:
        return self.points + sum(b.amount for b in self.bonuses)

    @property
    def anything(self) -> bool:
        return self.xp_gained > 0 or bool(self.badges)


class RewardEngine:
    def __init__(
        self,
        repo: SessionRepository,
        unlock_rules: UnlockRules,
        estimate: Estimate,
        timezone: str = "Asia/Colombo",
    ) -> None:
        self.repo = repo
        self.unlock_rules = unlock_rules
        self.estimate = estimate
        self.tz = ZoneInfo(timezone)
        self.timezone = timezone

    def today(self, now: datetime):
        return now.astimezone(self.tz).date()

    def award(
        self,
        *,
        user_id: str,
        course: Course,
        state: SessionState,
        now: datetime,
        results: Mapping[str, Sequence[CheckpointResult]],
        gating_attempts: Sequence[tuple[str, AttemptRecord]],
        points: int = 0,
        gating_passed: bool = False,
        attempt_no: int = 0,
        reteach_after: int = 2,
    ) -> Earned:
        """Pay out what this answer or this end of session earned.

        `results` and `gating_attempts` are the student's history INCLUDING the answer just
        recorded. `gating_passed` is True when the answer was a passed gating checkpoint.
        """
        earned = Earned(points=points)
        session_id = state.session_id

        def pay(kind: str, ref: str, amount: int) -> None:
            if self.repo.add_xp_event(user_id, session_id, kind, ref, amount):
                earned.bonuses.append(BonusEarned(kind, BONUS_LABELS[kind], amount))

        mastered_now = {
            c: is_mastered(self.estimate(course, c, rs), self.unlock_rules)
            for c, rs in results.items()
        }
        quests_done = {
            topic
            for topic, members in course.topics.items()
            if all(mastered_now.get(c, False) for c in members)
        }

        if gating_passed:
            concept = state.concept_id
            rs = results.get(concept, [])
            was_mastered = is_mastered(self.estimate(course, concept, rs[:-1]), self.unlock_rules)
            if mastered_now.get(concept) and not was_mastered:
                pay("mastery", concept, BONUSES.mastery)
            topic = course.topic_of.get(concept)
            if topic in quests_done:
                pay("quest", topic, BONUSES.quest)

        finished = state.is_over and state.exit in (
            ExitReason.COMPLETED,
            ExitReason.MASTERY_SATISFIED,
        )
        flawless_now = False
        streak = 0
        if finished:
            today = self.today(now)
            # Once per concept per day, so replaying a concept for its bonus is not a grind.
            # The checkpoint points still count every time.
            daily = f"{state.concept_id}@{today.isoformat()}"
            pay("concept_clear", daily, BONUSES.concept_clear)
            mine = [
                (a.question_id, a.attempt_no, a.outcome, a.gating)
                for a in self.repo.attempts(session_id)
            ]
            flawless_now = is_flawless(mine, state.gating_done)
            if flawless_now:
                pay("flawless", daily, BONUSES.flawless)
            streak = current_streak(self.repo.activity_days(user_id, self.timezone), today)
            if streak >= BONUSES.streak_from_days:
                pay("streak", today.isoformat(), BONUSES.streak)

        # Badges and the running total are worth a round trip only when something that could
        # earn one happened: a passed checkpoint, or a finished session.
        if gating_passed or finished:
            owned = self.repo.badges(user_id)
            total = self.repo.total_xp(user_id)
            facts = BadgeFacts(
                completed_sessions=self.repo.completed_session_count(user_id) if finished else 0,
                first_try_pass=any(
                    a.outcome == "correct" and a.attempt_no == 1 for _, a in gating_attempts
                ),
                session_flawless=flawless_now,
                comeback=gating_passed and attempt_no >= reteach_after + 1,
                mastered_concepts=sum(mastered_now.values()),
                quests_complete=len(quests_done),
                streak=streak,
                total_xp=total,
            )
            for badge in badges_due(facts, owned):
                if self.repo.award_badge(user_id, badge.id, session_id):
                    earned.badges.append(badge)
            earned.total_xp = total
        elif earned.points > 0:
            earned.total_xp = self.repo.total_xp(user_id)
        return earned
