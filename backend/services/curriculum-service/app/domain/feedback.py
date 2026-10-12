"""Learner ratings of recommendation explanations (FR-07 pilot: was it helpful?)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Protocol


class FeedbackError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Shown:
    """The recommendation the learner was last shown for a module."""

    concept_id: str
    explanation: str | None
    model_version: str


class FeedbackRepository(Protocol):
    def shown(self, user_id: uuid.UUID, module_id: str) -> Shown | None: ...

    def save(self, user_id: uuid.UUID, module_id: str, shown: Shown, helpful: bool) -> None:
        """Upsert: a learner who changes their mind replaces the earlier rating."""
        ...


def rate(
    repository: FeedbackRepository,
    user_id: uuid.UUID,
    module_id: str,
    concept_id: str,
    helpful: bool,
) -> None:
    """Rates the stored recommendation, so the browser cannot rate a sentence it never saw."""
    shown = repository.shown(user_id, module_id)
    if shown is None or shown.concept_id != concept_id:
        raise FeedbackError(
            "stale_recommendation", "Your recommendation has changed. Refresh and try again."
        )
    if shown.explanation is None:
        raise FeedbackError("no_explanation", "This recommendation has no explanation to rate.")
    repository.save(user_id, module_id, shown, helpful)
