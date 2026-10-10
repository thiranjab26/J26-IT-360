"""C3 stand-in practice: server-checked questions that feed BKT exactly as C3 will (FR-04).

An answer is stored with C3's contract columns (correct, hints_used) and the ingester
applies the platform rule: only a first try without a hint counts as correct.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, replace
from typing import Protocol

from app.domain.assessment import option_order
from app.domain.learner import Learner
from app.domain.mastery import MasteryRecord, counts_as_correct


class PracticeError(Exception):
    """`code` is stable for the API."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class PracticeItem:
    item_id: str
    concept_id: str
    stem: str
    options: tuple[str, ...]
    answer_index: int
    hint: str | None = None


@dataclass(frozen=True)
class PracticeResult:
    concept_id: str
    correct: bool
    right_option: int  # position as shown to this learner
    counted: bool  # False for a retry: only the first try is evidence
    counted_as_correct: bool
    hints_used: int
    record: MasteryRecord | None


class PracticeRepository(Protocol):
    def items(self, concept_id: str) -> list[PracticeItem]:
        """Items in use for a concept (retired ones left out)."""
        ...

    def item(self, item_id: str) -> PracticeItem | None: ...

    def tries(self, user_id: uuid.UUID, concept_id: str) -> dict[str, int]:
        """item_id -> how many times this learner has answered it."""
        ...

    def add_hint(self, user_id: uuid.UUID, item_id: str) -> None: ...

    def hints(self, user_id: uuid.UUID, item_id: str) -> int: ...


def learner_seed(user_id: uuid.UUID) -> int:
    """Stable per learner, so a practice item always shows its options in the same order."""
    return user_id.int % (2**61)


def as_shown(item: PracticeItem, user_id: uuid.UUID) -> PracticeItem:
    order = option_order(learner_seed(user_id), item.item_id, len(item.options))
    return replace(
        item,
        options=tuple(item.options[i] for i in order),
        answer_index=order.index(item.answer_index),
    )


def _tiebreak(user_id: uuid.UUID, item_id: str) -> str:
    # Different learners meet a concept's fresh items in different orders.
    return hashlib.sha256(f"{user_id}:{item_id}".encode()).hexdigest()


class Practice:
    def __init__(self, repository: PracticeRepository, learner: Learner) -> None:
        self.repository = repository
        self.learner = learner

    def next(self, user_id: uuid.UUID, concept_id: str) -> PracticeItem:
        """The least-tried item of the concept, options in this learner's order."""
        items = self.repository.items(concept_id)
        if not items:
            raise PracticeError(
                "no_practice_items", "There are no practice questions for this yet."
            )
        tries = self.repository.tries(user_id, concept_id)
        pick = min(items, key=lambda i: (tries.get(i.item_id, 0), _tiebreak(user_id, i.item_id)))
        return as_shown(pick, user_id)

    def hint(self, user_id: uuid.UUID, item_id: str) -> tuple[str, int]:
        """Shows the hint and logs it; returns (hint, hints used so far)."""
        item = self._item(item_id)
        if not item.hint:
            raise PracticeError("no_hint", "This question has no hint.")
        self.repository.add_hint(user_id, item_id)
        return item.hint, self.repository.hints(user_id, item_id)

    def answer(self, user_id: uuid.UUID, item_id: str, shown_choice: int) -> PracticeResult:
        item = self._item(item_id)
        order = option_order(learner_seed(user_id), item.item_id, len(item.options))
        if not 0 <= shown_choice < len(order):
            raise PracticeError("bad_choice", "That option does not exist.")
        correct = order[shown_choice] == item.answer_index
        hints = self.repository.hints(user_id, item_id)
        counted, record = self.learner.practise(user_id, item.concept_id, item_id, correct, hints)
        return PracticeResult(
            concept_id=item.concept_id,
            correct=correct,
            right_option=order.index(item.answer_index),
            counted=counted,
            counted_as_correct=counted and counts_as_correct(correct, hints),
            hints_used=hints,
            record=record,
        )

    def _item(self, item_id: str) -> PracticeItem:
        item = self.repository.item(item_id)
        if item is None:
            raise PracticeError("unknown_item", "No such practice question.")
        return item
