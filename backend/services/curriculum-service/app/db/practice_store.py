"""Postgres storage for C3 stand-in practice items and the hint log."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.domain.practice import PracticeItem
from app.integrations.attempts import STUB_RELATION

_COLUMNS = "item_id, concept_id, stem, options, answer_index, hint"


def _item(row: Mapping[str, Any]) -> PracticeItem:
    return PracticeItem(**{**row, "options": tuple(row["options"])})


class PracticeStore:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def items(self, concept_id: str) -> list[PracticeItem]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    f"SELECT {_COLUMNS} FROM curriculum.practice_item"
                    " WHERE concept_id = :concept_id AND NOT retired ORDER BY item_id"
                ),
                {"concept_id": concept_id},
            ).mappings()
            return [_item(r) for r in rows]

    def item(self, item_id: str) -> PracticeItem | None:
        with self._engine.connect() as connection:
            row = (
                connection.execute(
                    text(
                        f"SELECT {_COLUMNS} FROM curriculum.practice_item WHERE item_id = :item_id"
                    ),
                    {"item_id": item_id},
                )
                .mappings()
                .first()
            )
        return _item(row) if row else None

    def tries(self, user_id: uuid.UUID, concept_id: str) -> dict[str, int]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    f"SELECT item_id, count(*) FROM {STUB_RELATION}"
                    " WHERE user_id = :user_id AND concept_id = :concept_id GROUP BY item_id"
                ),
                {"user_id": user_id, "concept_id": concept_id},
            ).all()
        return {item_id: int(n) for item_id, n in rows}

    def add_hint(self, user_id: uuid.UUID, item_id: str) -> None:
        with self._engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO curriculum.practice_hint (user_id, item_id)"
                    " VALUES (:user_id, :item_id)"
                ),
                {"user_id": user_id, "item_id": item_id},
            )

    def hints(self, user_id: uuid.UUID, item_id: str) -> int:
        with self._engine.connect() as connection:
            return int(
                connection.execute(
                    text(
                        "SELECT count(*) FROM curriculum.practice_hint"
                        " WHERE user_id = :user_id AND item_id = :item_id"
                    ),
                    {"user_id": user_id, "item_id": item_id},
                ).scalar()
            )
