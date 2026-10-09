"""Ties evidence, mastery and recommendations together for one learner."""

from __future__ import annotations

import uuid
from typing import Protocol

from app.domain.graph import PrerequisiteGraph
from app.domain.mastery import BktParams, MasteryRecord, Observation
from app.domain.recommend import Plan, Recommendation, fixed_order, recommend


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

    def save_recommendation(
        self, user_id: uuid.UUID, recommendation: Recommendation, graph_version: str
    ) -> None: ...

    def add_stub_attempt(
        self, user_id: uuid.UUID, concept_id: str, item_id: str, correct: bool, hints_used: int
    ) -> None: ...


class Learner:
    def __init__(self, repository: MasteryRepository) -> None:
        self.repository = repository

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
        scores = {cid: r.score for cid, r in records.items()}
        plan = (fixed_order if fixed else recommend)(graph, module_id, scores)
        if plan.recommendation is not None:
            self.repository.save_recommendation(user_id, plan.recommendation, graph.version)
        return plan

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
