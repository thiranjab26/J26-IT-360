"""What the browser sends and receives for guided sessions.

Nothing here can carry an answer key: the correct option, the expected output and the
authored explanation are added to a response only by the session service, and only
after the student has answered (see SessionService._feedback).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class OptionOut(BaseModel):
    letter: str
    text: str


class QuestionOut(BaseModel):
    question_id: str
    kind: Literal["mcq", "predict_output", "explain", "code"]
    stem: str
    options: list[OptionOut] = []
    gating: bool
    attempt: int
    max_attempts: int
    hint: str | None = None
    hint_source: Literal["generated", "authored"] | None = None
    hint_check: Literal["verified", "unchecked", "blocked"] | None = None


class FeedbackOut(BaseModel):
    outcome: Literal["correct", "wrong", "unreadable"]
    message: str
    # Only after a correct answer, or after a wrong quick check (which never blocks).
    explanation: str | None = None
    correct_option: str | None = None
    xp_earned: int = 0
    attempt: int = 1
    tries_left: int | None = None


class SourceOut(BaseModel):
    """A passage an explanation was built from."""

    chunk_id: str
    label: str
    kind: Literal["main", "retrieved"]


class PositionOut(BaseModel):
    step_number: int
    total_steps: int
    gating_done: int
    gating_total: int


class BonusOut(BaseModel):
    kind: str
    label: str
    amount: int


class BadgeOut(BaseModel):
    id: str
    name: str
    description: str
    rarity: Literal["common", "rare", "epic"]


class LevelOut(BaseModel):
    number: int
    name: str
    total_xp: int
    xp_into_level: int
    xp_for_next: int | None  # null at the top level
    percent: float
    next_name: str | None


class LevelUpOut(BaseModel):
    from_level: int
    to_level: int
    name: str


class RewardsOut(BaseModel):
    """What one action paid out, for the celebration on screen."""

    xp_gained: int
    points: int  # the checkpoint XP; the rest is bonuses
    bonuses: list[BonusOut] = []
    badges: list[BadgeOut] = []
    level: LevelOut
    level_up: LevelUpOut | None = None


class SummaryOut(BaseModel):
    exit_reason: str
    xp_earned: int  # checkpoint points plus this session's bonuses
    gating_done: int
    gating_total: int
    mastery: float | None
    can_resume: bool
    bonuses: list[BonusOut] = []
    badges: list[BadgeOut] = []


class SessionOut(BaseModel):
    session_id: str
    concept_id: str
    concept_title: str
    phase: Literal["hook", "teach", "checkpoint", "feedback", "reteach", "ended"]
    position: PositionOut
    xp_earned: int
    heading: str | None = None
    text: str | None = None  # the hook, an explanation part, or a re-teach passage
    # "generated" when a model wrote `text` from the course passage, which is then given
    # in `source_text` so the student can read the original. "authored" is the course text.
    text_source: Literal["generated", "authored"] | None = None
    # verified: the faithfulness gate passed the generated text. unchecked: generated, but
    # no gate ran. blocked: the gate rejected the model's wording, so this is the course
    # text. Null: authored course text that was never replaced.
    text_check: Literal["verified", "unchecked", "blocked"] | None = None
    source_text: str | None = None
    # What a generated text was built from: the main passage and what retrieval added.
    sources: list[SourceOut] | None = None
    question: QuestionOut | None = None
    feedback: FeedbackOut | None = None
    summary: SummaryOut | None = None
    rewards: RewardsOut | None = None  # only on responses to an action that earned something


class HistoryPartOut(BaseModel):
    """A part the student has already read, for looking back. Read-only."""

    step_number: int
    heading: str
    text: str
    text_source: Literal["generated", "authored"] | None = None
    text_check: Literal["verified", "unchecked", "blocked"] | None = None
    sources: list[SourceOut] | None = None


class HistoryOut(BaseModel):
    parts: list[HistoryPartOut]


class StartIn(BaseModel):
    concept_id: str = Field(min_length=1, max_length=100)


class AnswerIn(BaseModel):
    answer: str = Field(max_length=4000)


class RequirementOut(BaseModel):
    kind: str
    concept_id: str | None
    required: float
    current: float | None


class ConceptProgressOut(BaseModel):
    concept_id: str
    title: str
    unlocked: bool
    mastery: float | None
    mastered: bool = False
    unmet: list[RequirementOut] = []


class QuestOut(BaseModel):
    """A topic as a quest: master every concept in it."""

    topic: str
    concept_ids: list[str]
    mastered: int
    total: int
    complete: bool
    reward_xp: int
    reward_claimed: bool


class ProgressOut(BaseModel):
    module_id: str
    policy: str
    total_xp: int
    next_concept_id: str | None
    active_session_id: str | None
    concepts: list[ConceptProgressOut]
    quests: list[QuestOut] = []
    level: LevelOut | None = None


class StreakOut(BaseModel):
    current: int
    longest: int
    learned_today: bool  # False with current > 0 means "learn today to keep it"


class BadgeStatusOut(BadgeOut):
    earned: bool
    earned_at: datetime | None = None


class ProfileOut(BaseModel):
    total_xp: int
    level: LevelOut
    streak: StreakOut
    badges: list[BadgeStatusOut]
    completed_sessions: int


class LeaderEntryOut(BaseModel):
    rank: int
    name: str
    xp: int
    level_number: int
    level_name: str
    is_you: bool


class LeaderboardOut(BaseModel):
    entries: list[LeaderEntryOut]
    you: LeaderEntryOut | None = None  # set when the student is outside the top entries
