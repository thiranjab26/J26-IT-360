"""Postgres storage for explanation ratings (curriculum.explanation_feedback)."""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.domain.feedback import Shown


class FeedbackStore:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def shown(self, user_id: uuid.UUID, module_id: str) -> Shown | None:
        with self._engine.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT next_concept_id, explanation, model_version"
                    " FROM curriculum.recommendation"
                    " WHERE user_id = :user_id AND module_id = :module_id"
                ),
                {"user_id": user_id, "module_id": module_id},
            ).first()
        return Shown(row[0], row[1], row[2]) if row else None

    def save(self, user_id: uuid.UUID, module_id: str, shown: Shown, helpful: bool) -> None:
        with self._engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO curriculum.explanation_feedback
                        (user_id, module_id, concept_id, explanation, model_version, helpful)
                    VALUES (:user_id, :module_id, :concept_id, :explanation, :model_version,
                            :helpful)
                    ON CONFLICT (user_id, module_id, concept_id, explanation) DO UPDATE
                    SET helpful = EXCLUDED.helpful, model_version = EXCLUDED.model_version,
                        created_at = now()
                    """
                ),
                {
                    "user_id": user_id,
                    "module_id": module_id,
                    "concept_id": shown.concept_id,
                    "explanation": shown.explanation,
                    "model_version": shown.model_version,
                    "helpful": helpful,
                },
            )
