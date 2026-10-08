"""Bayesian Knowledge Tracing mastery per learner and concept (FR-03, FR-04)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

# Platform-wide threshold from the contracts; C3 unlocks on the same number.
MASTERY_THRESHOLD = 0.70

EvidenceSource = Literal["pretest", "practice", "posttest"]
# Tests only measure, so only practice gets the BKT learning step.
LEARNING_SOURCES: frozenset[str] = frozenset({"practice"})


@dataclass(frozen=True)
class BktParams:
    p_init: float
    p_learn: float
    p_guess: float
    p_slip: float
    version: str

    def __post_init__(self) -> None:
        for name in ("p_init", "p_learn", "p_guess", "p_slip"):
            value = getattr(self, name)
            if not 0.0 < value < 1.0:
                raise ValueError(f"{name} must be between 0 and 1, got {value}")
        if self.p_guess + self.p_slip >= 1.0:
            raise ValueError("p_guess + p_slip must be below 1")


# Until notebook 03 fits them on Junyi. guess 0.25 = four-option MCQ.
DEFAULT_PARAMS = BktParams(
    p_init=0.20, p_learn=0.15, p_guess=0.25, p_slip=0.10, version="bkt-default-v1"
)


def counts_as_correct(correct: bool, hints_used: int) -> bool:
    """Correct only without a hint; sources pass first tries only."""
    return correct and hints_used == 0


def update(p_mastery: float, correct: bool, params: BktParams, *, learning: bool) -> float:
    g, s = params.p_guess, params.p_slip
    if correct:
        posterior = p_mastery * (1 - s) / (p_mastery * (1 - s) + (1 - p_mastery) * g)
    else:
        posterior = p_mastery * s / (p_mastery * s + (1 - p_mastery) * (1 - g))
    if learning:
        posterior += (1 - posterior) * params.p_learn
    return posterior


@dataclass(frozen=True)
class Observation:
    concept_id: str
    item_id: str
    source: EvidenceSource
    source_ref: str  # unique per source, so an answer is never counted twice
    correct_raw: bool
    hints_used: int
    observed_at: datetime

    @property
    def correct(self) -> bool:
        return counts_as_correct(self.correct_raw, self.hints_used)

    @property
    def learning(self) -> bool:
        return self.source in LEARNING_SOURCES


@dataclass(frozen=True)
class MasteryRecord:
    score: float
    evidence_count: int
    needs_reassessment: bool
    updated_at: datetime

    @property
    def is_mastered(self) -> bool:
        return self.score >= MASTERY_THRESHOLD


def apply(
    record: MasteryRecord | None, observation: Observation, params: BktParams
) -> tuple[float, MasteryRecord]:
    """Returns (mastery before, new record)."""
    before = record.score if record else params.p_init
    after = update(before, observation.correct, params, learning=observation.learning)
    return before, MasteryRecord(
        score=after,
        evidence_count=(record.evidence_count if record else 0) + 1,
        needs_reassessment=record.needs_reassessment if record else False,
        updated_at=observation.observed_at,
    )
