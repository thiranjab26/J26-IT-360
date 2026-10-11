"""Ties evidence, mastery and recommendations together for one learner."""

from __future__ import annotations

import logging
import uuid
from typing import Protocol

from app.domain.gat import GatModel, score
from app.domain.graph import PrerequisiteGraph
from app.domain.mastery import BktParams, MasteryRecord, Observation
from app.domain.recommend import (
    MODEL_VERSION,
    Plan,
    Recommendation,
    Scores,
    fixed_order,
    recommend,
)

logger = logging.getLogger("curriculum-service")


class MasteryRepository(Protocol):
    params: BktParams
    params_version: str

    def ingest(self, user_id: uuid.UUID | None = None) -> set[uuid.UUID]:
        """Turn new practice attempts into evidence; returns learners whose mastery changed."""
        ...

    def apply(self, user_id: uuid.UUID, observations: list[Observation]) -> int:
        """Store observations as evidence, idempotent per (source, source_ref)."""
        ...

    def mastery(self, user_id: uuid.UUID) -> dict[str, MasteryRecord]: ...

    def history(self, user_id: uuid.UUID) -> list[bool]:
        """Every evidence row's counted correctness (all sources), oldest first."""
        ...

    def save_recommendation(
        self, user_id: uuid.UUID, recommendation: Recommendation, graph_version: str
    ) -> None: ...

    def add_stub_attempt(
        self, user_id: uuid.UUID, concept_id: str, item_id: str, correct: bool, hints_used: int
    ) -> None: ...


class Learner:
    def __init__(self, repository: MasteryRepository, model: GatModel | None = None) -> None:
        """`model` None = rules-v1 only (model file missing or rejected at startup)."""
        self.repository = repository
        self.model = model

    @property
    def recommender_version(self) -> str:
        return self.model.version if self.model else MODEL_VERSION

    @property
    def params(self) -> BktParams:
        return self.repository.params

    @property
    def params_version(self) -> str:
        return self.repository.params_version

    def mastery(self, user_id: uuid.UUID) -> dict[str, MasteryRecord]:
        """Ingests the learner's new attempts first, so the answer is never stale."""
        self.repository.ingest(user_id)
        return self.repository.mastery(user_id)

    def record(self, user_id: uuid.UUID, observations: list[Observation]) -> int:
        """Test answers as evidence; returns how many were new."""
        return self.repository.apply(user_id, observations)

    def plan(
        self, user_id: uuid.UUID, graph: PrerequisiteGraph, module_id: str, *, fixed: bool = False
    ) -> Plan:
        """`fixed` = comparison group: syllabus order instead of the adaptive ranking."""
        records = self.mastery(user_id)
        mastery = {cid: r.score for cid, r in records.items()}
        if fixed:
            plan = fixed_order(graph, module_id, mastery)
        else:
            plan = recommend(
                graph, module_id, mastery, scores=self._model_scores(user_id, graph, records)
            )
        if plan.recommendation is not None:
            self.repository.save_recommendation(user_id, plan.recommendation, graph.version)
        return plan

    def _model_scores(
        self, user_id: uuid.UUID, graph: PrerequisiteGraph, records: dict[str, MasteryRecord]
    ) -> Scores | None:
        """None = use rules-v1. A model failure must never take recommendations down."""
        if self.model is None:
            return None
        try:
            return score(self.model, graph, records, self.repository.history(user_id), self.params)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "readiness model failed, using rules-v1", extra={"error": type(exc).__name__}
            )
            return None

    def practise(
        self, user_id: uuid.UUID, concept_id: str, item_id: str, correct: bool, hints_used: int
    ) -> tuple[bool, MasteryRecord | None]:
        """C3 stand-in: store the attempt as C3 will, ingest it. Returns (counted, record)."""
        before = self.mastery(user_id).get(concept_id)
        self.repository.add_stub_attempt(user_id, concept_id, item_id, correct, hints_used)
        after = self.mastery(user_id).get(concept_id)
        counted = after is not None and (
            before is None or after.evidence_count > before.evidence_count
        )
        return counted, after
