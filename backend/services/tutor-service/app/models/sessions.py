"""What the browser sends and receives for guided sessions.

Nothing here can carry an answer key: the correct option, the expected output and the
authored explanation are added to a response only by the session service, and only
after the student has answered (see SessionService._feedback).
"""

from __future__ import annotations

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


class FeedbackOut(BaseModel):
    outcome: Literal["correct", "wrong", "unreadable"]
    message: str
    # Only after a correct answer, or after a wrong quick check (which never blocks).
    explanation: str | None = None
    correct_option: str | None = None
    xp_earned: int = 0
    attempt: int = 1
    tries_left: int | None = None


class PositionOut(BaseModel):
    step_number: int
    total_steps: int
    gating_done: int
    gating_total: int


class SummaryOut(BaseModel):
    exit_reason: str
    xp_earned: int
    gating_done: int
    gating_total: int
    mastery: float | None
    can_resume: bool


class SessionOut(BaseModel):
    session_id: str
    concept_id: str
    concept_title: str
    phase: Literal["hook", "teach", "checkpoint", "feedback", "reteach", "ended"]
    position: PositionOut
    xp_earned: int
    heading: str | None = None
    text: str | None = None  # the hook, an explanation part, or a re-teach passage
    question: QuestionOut | None = None
    feedback: FeedbackOut | None = None
    summary: SummaryOut | None = None


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
    unmet: list[RequirementOut] = []


class ProgressOut(BaseModel):
    module_id: str
    policy: str
    total_xp: int
    next_concept_id: str | None
    active_session_id: str | None
    concepts: list[ConceptProgressOut]
