"""Levels, bonus XP, badges and streaks. Pure logic: no database, no clock, no FastAPI.

Everything a student can earn beyond the per-checkpoint XP lives here, in one place, so
the numbers can be read, changed and cited in one file. The same values are written up in
docs/c3/gamification-spec.md; change that document with this file.

Two principles keep this layer from confounding the study (research claim 3, mastery-gated
against points-only progression):

  * Rewards are identical in both conditions. Only what XP is allowed to UNLOCK differs
    (rules.py), so a difference in learning gain cannot come from one group being paid
    more.
  * A reward is earned for demonstrated work, never for time spent or answers submitted:
    finishing a session, passing on the first try, mastering a concept. Nothing here pays
    for guessing a multiple-choice check.

Every reward is recorded once. The service gives each bonus a `ref` (the session, concept,
topic or day it was earned for) and the database refuses a second bonus with the same kind
and ref, so replaying a request can never pay twice.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

# --------------------------------------------------------------------------- levels


@dataclass(frozen=True)
class Level:
    number: int
    name: str
    xp_required: int  # total XP at which this level is reached


LEVELS: tuple[Level, ...] = (
    Level(1, "Rookie", 0),
    Level(2, "Apprentice", 150),
    Level(3, "Coder", 400),
    Level(4, "Debugger", 800),
    Level(5, "Tracer", 1300),
    Level(6, "Architect", 1900),
    Level(7, "Expert", 2600),
    Level(8, "Master", 3500),
    Level(9, "Grandmaster", 4600),
    Level(10, "Legend", 6000),
)


@dataclass(frozen=True)
class LevelProgress:
    level: Level
    next_level: Level | None  # None at the top
    xp_into_level: int
    xp_for_next: int | None  # XP between this level and the next; None at the top
    percent: float  # 0 to 100 through the current level; 100 at the top


def level_for(total_xp: int) -> LevelProgress:
    xp = max(0, total_xp)
    index = max(i for i, level in enumerate(LEVELS) if xp >= level.xp_required)
    level = LEVELS[index]
    if index == len(LEVELS) - 1:
        return LevelProgress(level, None, xp - level.xp_required, None, 100.0)
    nxt = LEVELS[index + 1]
    span = nxt.xp_required - level.xp_required
    into = xp - level.xp_required
    return LevelProgress(level, nxt, into, span, round(100 * into / span, 1))


# ----------------------------------------------------------------------------- bonuses


@dataclass(frozen=True)
class Bonuses:
    concept_clear: int = 50  # a session ends completed or mastery_satisfied
    flawless: int = 50  # ... and every checkpoint was passed on the first try
    mastery: int = 100  # a concept reaches the mastery threshold for the first time
    quest: int = 150  # every concept in a topic is mastered
    streak: int = 25  # first finished session of a day, with a streak of 3 days or more
    streak_from_days: int = 3


BONUSES = Bonuses()

# What each bonus is called on screen. The kind is also the database value.
BONUS_LABELS = {
    "concept_clear": "Concept cleared",
    "flawless": "Flawless run",
    "mastery": "Concept mastered",
    "quest": "Quest complete",
    "streak": "Streak bonus",
}


# ------------------------------------------------------------------------------ badges


@dataclass(frozen=True)
class Badge:
    id: str
    name: str
    description: str
    rarity: str  # common | rare | epic: drives the colour and the unlock fanfare


BADGES: tuple[Badge, ...] = (
    Badge("first_steps", "First Steps", "Finish your first session.", "common"),
    Badge("sharp_start", "Sharp Start", "Pass a checkpoint on the first try.", "common"),
    Badge(
        "flawless",
        "Flawless",
        "Finish a session passing every checkpoint on the first try.",
        "rare",
    ),
    Badge("comeback", "Comeback Kid", "Pass a checkpoint after a re-teach.", "rare"),
    Badge("concept_master", "Concept Master", "Master your first concept.", "common"),
    Badge(
        "topic_champion",
        "Topic Champion",
        "Master every concept in a topic and complete its quest.",
        "epic",
    ),
    Badge("on_fire", "On Fire", "Learn on 3 days in a row.", "rare"),
    Badge("week_warrior", "Week Warrior", "Learn on 7 days in a row.", "epic"),
    Badge("xp_500", "Half a Grand", "Earn 500 XP.", "common"),
    Badge("xp_2000", "Two Thousand Club", "Earn 2,000 XP.", "rare"),
)
BADGE_BY_ID = {badge.id: badge for badge in BADGES}


@dataclass(frozen=True)
class BadgeFacts:
    """What is true of a student right now, gathered by the service. Plain numbers, so the
    rules below can be tested without a database."""

    completed_sessions: int = 0  # sessions that ended completed or mastery_satisfied
    first_try_pass: bool = False  # has passed a gating checkpoint on try 1
    session_flawless: bool = False  # the session that just ended was flawless
    comeback: bool = False  # passed a checkpoint straight after a re-teach, just now
    mastered_concepts: int = 0
    quests_complete: int = 0
    streak: int = 0
    total_xp: int = 0


def badges_due(facts: BadgeFacts, owned: Collection[str]) -> list[Badge]:
    """Badges the facts earn that the student does not hold yet, in catalogue order."""
    earned = {
        "first_steps": facts.completed_sessions >= 1,
        "sharp_start": facts.first_try_pass,
        "flawless": facts.session_flawless,
        "comeback": facts.comeback,
        "concept_master": facts.mastered_concepts >= 1,
        "topic_champion": facts.quests_complete >= 1,
        "on_fire": facts.streak >= 3,
        "week_warrior": facts.streak >= 7,
        "xp_500": facts.total_xp >= 500,
        "xp_2000": facts.total_xp >= 2000,
    }
    return [b for b in BADGES if earned[b.id] and b.id not in owned]


# ----------------------------------------------------------------------------- streaks


def current_streak(days: Iterable[date], today: date) -> int:
    """Consecutive days of learning, ending today or yesterday.

    Not having learned yet today does not break the streak: it is still alive until the
    day is over, so the screen can say "learn today to keep it".
    """
    active = set(days)
    if today in active:
        cursor = today
    elif today - timedelta(days=1) in active:
        cursor = today - timedelta(days=1)
    else:
        return 0
    count = 0
    while cursor in active:
        count += 1
        cursor -= timedelta(days=1)
    return count


def longest_streak(days: Iterable[date]) -> int:
    ordered = sorted(set(days))
    best = run = 0
    previous: date | None = None
    for day in ordered:
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = day
    return best


# -------------------------------------------------------------------------- flawlessness


def is_flawless(session_attempts: Sequence[tuple[str, int, str, bool]], gating_done: int) -> bool:
    """A session where every checkpoint answered was passed on the first try.

    `session_attempts` is (question_id, attempt_no, outcome, gating) for the session and
    `gating_done` the number of checkpoints it passed. Unreadable answers cost nothing, so
    they are ignored, and quick checks never count. A finished session passes every
    checkpoint it asked (or stops early on mastery, skipping the rest), so "every one was
    first try" is the whole test.
    """
    tries: dict[str, list[str]] = {}
    for question_id, _, outcome, gating in session_attempts:
        if gating and outcome in ("correct", "wrong"):
            tries.setdefault(question_id, []).append(outcome)
    if gating_done < 1 or len(tries) != gating_done:
        return False
    return all(t == ["correct"] for t in tries.values())
