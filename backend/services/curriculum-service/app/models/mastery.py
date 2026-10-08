"""Request and response shapes for mastery, recommendations and the C3 stand-in."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

CONCEPT_ID_PATTERN = r"^[a-z]{2,16}\.[a-z0-9_]{1,64}$"


class ConceptMastery(BaseModel):
    concept_id: str
    name: str
    module_id: str
    topic_id: str
    mastery_score: float | None  # None = no evidence yet
    is_mastered: bool
    evidence_count: int
    needs_reassessment: bool
    updated_at: datetime | None


class MasteryResponse(BaseModel):
    module_id: str | None
    threshold: float
    params_version: str
    concepts: list[ConceptMastery]


class ConceptRef(BaseModel):
    concept_id: str
    name: str


class RecommendationOut(BaseModel):
    next_concept: ConceptRef
    next_topic_id: str
    target_concept: ConceptRef | None
    weak_prerequisite: ConceptRef | None
    readiness: float
    explanation: str
    reason: str
    model_version: str


class LockedOut(BaseModel):
    concept: ConceptRef
    weak_prerequisite: ConceptRef
    weak_prerequisite_mastery: float


class PlanResponse(BaseModel):
    module_id: str
    graph_version: str
    complete: bool
    recommendation: RecommendationOut | None
    locked: list[LockedOut]


class StubAttemptIn(BaseModel):
    concept_id: str = Field(pattern=CONCEPT_ID_PATTERN)
    item_id: str = Field(pattern=r"^[A-Za-z0-9._:-]{1,64}$")
    correct: bool
    hints_used: int = Field(default=0, ge=0, le=20)


class StubAttemptOut(BaseModel):
    counted: bool  # False for a retry of an item already answered
    counted_as_correct: bool
    mastery: ConceptMastery
