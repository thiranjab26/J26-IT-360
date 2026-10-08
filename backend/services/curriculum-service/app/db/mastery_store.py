"""Postgres storage for evidence, mastery and recommendations (curriculum schema)."""

from __future__ import annotations

import uuid
from itertools import groupby

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.domain.mastery import DEFAULT_PARAMS, BktParams, MasteryRecord, Observation, apply
from app.domain.recommend import Recommendation
from app.integrations.attempts import STUB_RELATION

# First try per learner and item only, for known concepts, not yet ingested.
# {relation} is one of two constants in app.integrations.attempts, never input.
_PENDING_SQL = """
WITH attempts AS (
    SELECT a.user_id, a.concept_id, a.item_id, a.correct, a.hints_used, a.attempted_at,
           row_number() OVER (PARTITION BY a.user_id, a.item_id
                              ORDER BY a.attempted_at) AS try_number
    FROM {relation} AS a
    WHERE CAST(:user_id AS uuid) IS NULL OR a.user_id = CAST(:user_id AS uuid)
)
SELECT p.user_id, p.concept_id, p.item_id, p.correct, p.hints_used, p.attempted_at,
       p.user_id::text || '|' || p.item_id AS source_ref
FROM attempts AS p
JOIN core.concepts AS c ON c.concept_id = p.concept_id
WHERE p.try_number = 1
  AND NOT EXISTS (
      SELECT 1 FROM curriculum.mastery_evidence AS e
      WHERE e.source = 'practice' AND e.source_ref = p.user_id::text || '|' || p.item_id
  )
ORDER BY p.user_id, p.attempted_at
LIMIT :limit
"""


class MasteryStore:
    def __init__(
        self, engine: Engine, attempts_relation: str, params: BktParams = DEFAULT_PARAMS
    ) -> None:
        self._engine = engine
        self._pending_sql = text(_PENDING_SQL.format(relation=attempts_relation))
        self.params = params
        self.params_version = params.version

    def ingest(self, user_id: uuid.UUID | None = None, limit: int = 1000) -> set[uuid.UUID]:
        with self._engine.connect() as connection:
            rows = (
                connection.execute(
                    self._pending_sql,
                    {"user_id": str(user_id) if user_id else None, "limit": limit},
                )
                .mappings()
                .all()
            )
        changed: set[uuid.UUID] = set()
        for learner, group in groupby(rows, key=lambda r: r["user_id"]):
            observations = [
                Observation(
                    concept_id=r["concept_id"],
                    item_id=r["item_id"],
                    source="practice",
                    source_ref=r["source_ref"],
                    correct_raw=bool(r["correct"]),
                    hints_used=int(r["hints_used"] or 0),
                    observed_at=r["attempted_at"],
                )
                for r in group
            ]
            if self.apply(learner, observations):
                changed.add(learner)
        return changed

    def apply(self, user_id: uuid.UUID, observations: list[Observation]) -> int:
        """Apply observations in time order in one transaction; returns how many were new."""
        applied = 0
        with self._engine.begin() as connection:
            # One writer per learner at a time, so concurrent requests cannot interleave.
            connection.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                {"key": f"curriculum.mastery:{user_id}"},
            )
            records = self._read(connection, user_id, lock=True)
            touched: set[str] = set()
            for obs in sorted(observations, key=lambda o: o.observed_at):
                before, after = apply(records.get(obs.concept_id), obs, self.params)
                inserted = connection.execute(
                    text(
                        """
                        INSERT INTO curriculum.mastery_evidence
                            (user_id, concept_id, item_id, source, source_ref, correct_raw,
                             hints_used, correct, observed_at, mastery_before, mastery_after,
                             params_version)
                        VALUES (:user_id, :concept_id, :item_id, :source, :source_ref,
                                :correct_raw, :hints_used, :correct, :observed_at,
                                :before, :after, :params_version)
                        ON CONFLICT (source, source_ref) DO NOTHING
                        RETURNING evidence_id
                        """
                    ),
                    {
                        "user_id": user_id,
                        "concept_id": obs.concept_id,
                        "item_id": obs.item_id,
                        "source": obs.source,
                        "source_ref": obs.source_ref,
                        "correct_raw": obs.correct_raw,
                        "hints_used": obs.hints_used,
                        "correct": obs.correct,
                        "observed_at": obs.observed_at,
                        "before": before,
                        "after": after.score,
                        "params_version": self.params_version,
                    },
                ).first()
                if inserted is None:
                    continue
                records[obs.concept_id] = after
                touched.add(obs.concept_id)
                applied += 1

            for concept_id in touched:
                record = records[concept_id]
                connection.execute(
                    text(
                        """
                        INSERT INTO curriculum.concept_mastery
                            (user_id, concept_id, p_mastery, evidence_count, params_version,
                             updated_at)
                        VALUES (:user_id, :concept_id, :score, :count, :params_version, now())
                        ON CONFLICT (user_id, concept_id) DO UPDATE
                        SET p_mastery = EXCLUDED.p_mastery,
                            evidence_count = EXCLUDED.evidence_count,
                            params_version = EXCLUDED.params_version,
                            updated_at = EXCLUDED.updated_at
                        """
                    ),
                    {
                        "user_id": user_id,
                        "concept_id": concept_id,
                        "score": record.score,
                        "count": record.evidence_count,
                        "params_version": self.params_version,
                    },
                )
        return applied

    def mastery(self, user_id: uuid.UUID) -> dict[str, MasteryRecord]:
        with self._engine.connect() as connection:
            return self._read(connection, user_id, lock=False)

    def save_recommendation(
        self, user_id: uuid.UUID, recommendation: Recommendation, graph_version: str
    ) -> None:
        with self._engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO curriculum.recommendation
                        (user_id, module_id, next_concept_id, next_topic_id, target_concept_id,
                         weak_prerequisite_id, readiness, explanation, reason, model_version,
                         graph_version, updated_at)
                    VALUES (:user_id, :module_id, :next_concept_id, :next_topic_id,
                            :target_concept_id, :weak_prerequisite_id, :readiness, :explanation,
                            :reason, :model_version, :graph_version, now())
                    ON CONFLICT (user_id, module_id) DO UPDATE
                    SET next_concept_id = EXCLUDED.next_concept_id,
                        next_topic_id = EXCLUDED.next_topic_id,
                        target_concept_id = EXCLUDED.target_concept_id,
                        weak_prerequisite_id = EXCLUDED.weak_prerequisite_id,
                        readiness = EXCLUDED.readiness,
                        explanation = EXCLUDED.explanation,
                        reason = EXCLUDED.reason,
                        model_version = EXCLUDED.model_version,
                        graph_version = EXCLUDED.graph_version,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {"user_id": user_id, "graph_version": graph_version, **recommendation.__dict__},
            )

    def add_stub_attempt(
        self, user_id: uuid.UUID, concept_id: str, item_id: str, correct: bool, hints_used: int
    ) -> None:
        with self._engine.begin() as connection:
            connection.execute(
                text(
                    f"INSERT INTO {STUB_RELATION}"
                    " (user_id, concept_id, item_id, correct, hints_used)"
                    " VALUES (:user_id, :concept_id, :item_id, :correct, :hints_used)"
                ),
                {
                    "user_id": user_id,
                    "concept_id": concept_id,
                    "item_id": item_id,
                    "correct": correct,
                    "hints_used": hints_used,
                },
            )

    @staticmethod
    def _read(connection: Connection, user_id: uuid.UUID, lock: bool) -> dict[str, MasteryRecord]:
        sql = (
            "SELECT concept_id, p_mastery, evidence_count, needs_reassessment, updated_at"
            " FROM curriculum.concept_mastery WHERE user_id = :user_id"
            + (" FOR UPDATE" if lock else "")
        )
        return {
            r["concept_id"]: MasteryRecord(
                score=r["p_mastery"],
                evidence_count=r["evidence_count"],
                needs_reassessment=r["needs_reassessment"],
                updated_at=r["updated_at"],
            )
            for r in connection.execute(text(sql), {"user_id": user_id}).mappings()
        }
