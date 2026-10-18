"""Lecturer-made practicals and the history of replaced ones, as plain data plus their store.

A practical is identified by its question id. Several question ids can share one SLOT, the place
in a concept's list of practicals that they fill one after another: the authored question names
the slot (its own id), and each approved replacement joins it. Student credit and XP follow the
slot, so replacing a question never makes a student redo it or earn its bonus twice.

No FastAPI imports.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, Protocol

from sqlalchemy import insert, select, update
from sqlalchemy.orm import Session

from app.db.tables import assessment_items

DRAFT, APPROVED, REJECTED, RETIRED = "draft", "approved", "rejected", "retired"
AUTHORED, GENERATED, MANUAL = "authored", "generated", "manual"


@dataclass(frozen=True)
class Item:
    question_id: str
    slot_id: str
    concept_id: str
    origin: str
    status: str
    number: int
    level: int
    statement: str
    reference_solution: str
    checks: list[dict[str, Any]] = field(default_factory=list)
    generation: dict[str, Any] | None = None
    replaces_question_id: str | None = None
    replaced_by_question_id: str | None = None
    created_by: str | None = None
    created_at: datetime | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    retired_at: datetime | None = None
    retired_by: str | None = None

    @property
    def blocked(self) -> bool:
        """True when a check failed outright, so the item cannot be approved as it is."""
        return any(c.get("status") == "fail" for c in self.checks)


def new_question_id(concept_id: str) -> str:
    return f"{concept_id}#gen-{uuid.uuid4().hex[:8]}"


def now() -> datetime:
    return datetime.now(UTC)


class AssessmentStore(Protocol):
    def all(self) -> list[Item]: ...

    def get(self, question_id: str) -> Item | None: ...

    def add(self, item: Item) -> None: ...

    def change(self, question_id: str, **fields: Any) -> None:
        """Update the named fields of one item."""
        ...


class NoAssessmentStore:
    """For a service with no lecturer-made practicals: the authored course, exactly as it was."""

    def all(self) -> list[Item]:
        return []

    def get(self, question_id: str) -> Item | None:
        return None

    def add(self, item: Item) -> None:
        raise NotImplementedError

    def change(self, question_id: str, **fields: Any) -> None:
        raise NotImplementedError


def _uuid(value: str | None) -> uuid.UUID | None:
    return uuid.UUID(value) if value else None


class SqlAssessmentStore:
    _UUID_FIELDS = ("created_by", "reviewed_by", "retired_by")

    def __init__(self, db: Session) -> None:
        self.db = db

    def all(self) -> list[Item]:
        rows = self.db.execute(
            select(assessment_items).order_by(assessment_items.c.created_at)
        ).mappings()
        return [self._item(r) for r in rows]

    def get(self, question_id: str) -> Item | None:
        row = (
            self.db.execute(
                select(assessment_items).where(assessment_items.c.question_id == question_id)
            )
            .mappings()
            .first()
        )
        return self._item(row) if row else None

    def add(self, item: Item) -> None:
        values = {k: getattr(item, k) for k in _COLUMNS}
        for key in self._UUID_FIELDS:
            values[key] = _uuid(values[key])
        if item.created_at is None:
            values.pop("created_at")  # the database stamps it
        self.db.execute(insert(assessment_items).values(**values))

    def change(self, question_id: str, **fields: Any) -> None:
        for key in self._UUID_FIELDS:
            if key in fields:
                fields[key] = _uuid(fields[key])
        self.db.execute(
            update(assessment_items)
            .where(assessment_items.c.question_id == question_id)
            .values(**fields)
        )

    @staticmethod
    def _item(row) -> Item:
        values = {k: row[k] for k in _COLUMNS}
        for key in SqlAssessmentStore._UUID_FIELDS:
            values[key] = str(values[key]) if values[key] else None
        values["checks"] = list(values["checks"] or [])
        return Item(**values)


_COLUMNS = (
    "question_id",
    "slot_id",
    "concept_id",
    "origin",
    "status",
    "number",
    "level",
    "statement",
    "reference_solution",
    "checks",
    "generation",
    "replaces_question_id",
    "replaced_by_question_id",
    "created_by",
    "created_at",
    "reviewed_by",
    "reviewed_at",
    "review_note",
    "retired_at",
    "retired_by",
)


def with_status(item: Item, status: str, **extra: Any) -> Item:
    return replace(item, status=status, **extra)
