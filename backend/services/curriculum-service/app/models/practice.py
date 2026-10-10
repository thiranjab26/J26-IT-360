"""Request and response shapes for the C3 stand-in practice."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.assessment import ITEM_ID_PATTERN
from app.models.mastery import ConceptMastery, ConceptRef


class PracticeItemOut(BaseModel):
    """A practice question as the learner sees it: never the answer."""

    item_id: str
    concept: ConceptRef
    stem: str
    options: list[str]
    has_hint: bool


class HintIn(BaseModel):
    item_id: str = Field(pattern=ITEM_ID_PATTERN)


class HintOut(BaseModel):
    hint: str
    hints_used: int


class PracticeAnswerIn(BaseModel):
    item_id: str = Field(pattern=ITEM_ID_PATTERN)
    chosen_index: int = Field(ge=0, le=9)  # position as shown


class PracticeAnswerOut(BaseModel):
    correct: bool
    right_option: int  # shown after answering: practice is for learning
    counted: bool  # False for a retry
    counted_as_correct: bool  # first try and no hint
    hints_used: int
    mastery: ConceptMastery
