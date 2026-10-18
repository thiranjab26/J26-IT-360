"""The practicals a student can see right now: the authored ones, with lecturer changes laid over.

The authored course is read first. Then the lecturer-made rows are applied:

    an authored practical that was replaced is left out;
    a lecturer-made practical that was approved is added, as the same kind of object
    (`BankEntry`) the authored ones are, so listing, running, marking and rewards need no
    special case for where a practical came from.

With no rows the result is exactly the authored practicals, in the authored order.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.domain.questions import KIND_CODE, AnswerKey, BankEntry, Question
from app.practicals.items import APPROVED, AUTHORED, RETIRED, Item
from app.sessions.catalog import Course


class AssessmentCatalog:
    def __init__(self, course: Course, items: Sequence[Item] = ()) -> None:
        self.course = course
        self._items = {item.question_id: item for item in items}
        self._slot = {item.question_id: item.slot_id for item in items}

        replaced = {i.question_id for i in items if i.origin == AUTHORED and i.status == RETIRED}
        entries = [
            e
            for e in course.bank.values()
            if e.question.kind == KIND_CODE and e.question.question_id not in replaced
        ]
        entries += [
            self._entry_for(i) for i in items if i.origin != AUTHORED and i.status == APPROVED
        ]
        position = {c: n for n, c in enumerate(course.order)}
        entries.sort(
            key=lambda e: (
                position[e.question.concept_id],
                e.question.number,
                e.question.question_id,
            )
        )
        self._effective = {e.question.question_id: e for e in entries}

    # ---------------------------------------------------------------- reading
    def entries(self) -> list[BankEntry]:
        return list(self._effective.values())

    def entry(self, question_id: str) -> BankEntry | None:
        return self._effective.get(question_id)

    def title(self, entry: BankEntry) -> str:
        q = entry.question
        return f"{self.course.titles[q.concept_id]}: practical {q.number}"

    def slot_of(self, question_id: str) -> str:
        """The slot a question fills. An authored question that was never replaced fills its own."""
        return self._slot.get(question_id, question_id)

    def question_ids_in(self, slot_id: str) -> set[str]:
        """Every question that has ever filled this slot, replaced ones included."""
        return {slot_id} | {q for q, s in self._slot.items() if s == slot_id}

    def current_in(self, slot_id: str) -> BankEntry | None:
        for question_id in self.question_ids_in(slot_id):
            entry = self._effective.get(question_id)
            if entry is not None:
                return entry
        return None

    def authored(self, question_id: str) -> BankEntry | None:
        entry = self.course.bank.get(question_id)
        return entry if entry is not None and entry.question.kind == KIND_CODE else None

    def item(self, question_id: str) -> Item | None:
        return self._items.get(question_id)

    # ---------------------------------------------------------------- helpers
    def _entry_for(self, item: Item) -> BankEntry:
        sibling = next(
            (
                e.question.unit_id
                for e in self.course.bank.values()
                if e.question.concept_id == item.concept_id
            ),
            item.concept_id,
        )
        question = Question(
            question_id=item.question_id,
            unit_id=sibling,
            concept_id=item.concept_id,
            number=item.number,
            level=item.level,
            kind=KIND_CODE,
            stem=item.statement,
        )
        key = AnswerKey(
            question_id=item.question_id,
            kind=KIND_CODE,
            reference_solution=item.reference_solution,
        )
        return BankEntry(question, key)
