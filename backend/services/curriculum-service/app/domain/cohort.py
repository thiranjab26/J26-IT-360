"""The lecturer's view of a module: how the class is doing per concept (counts, no names)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.domain.graph import PrerequisiteGraph
from app.domain.mastery import MASTERY_THRESHOLD


@dataclass(frozen=True)
class ConceptStat:
    learners: int  # learners with any evidence on this concept
    mastered: int
    mean_mastery: float | None


@dataclass(frozen=True)
class StudyCounts:
    groups: dict[str, int]
    pretest_done: int
    posttest_done: int


class CohortRepository(Protocol):
    def concept_stats(self, concept_ids: list[str], threshold: float) -> dict[str, ConceptStat]: ...

    def learners(self, concept_ids: list[str]) -> int:
        """Distinct learners with evidence on any of these concepts."""
        ...

    def study_counts(self, module_id: str) -> StudyCounts: ...


@dataclass(frozen=True)
class ConceptRow:
    concept_id: str
    stat: ConceptStat


@dataclass(frozen=True)
class Overview:
    module_id: str
    learners: int
    study: StudyCounts
    concepts: tuple[ConceptRow, ...]  # syllabus order


def overview(repository: CohortRepository, graph: PrerequisiteGraph, module_id: str) -> Overview:
    """Raises GraphError for an unknown module (via for_module)."""
    view = graph.for_module(module_id)
    own = sorted(
        (c for c in view.concepts if c.module_id == module_id),
        key=lambda c: (c.position, c.concept_id),
    )
    ids = [c.concept_id for c in own]
    stats = repository.concept_stats(ids, MASTERY_THRESHOLD)
    empty = ConceptStat(0, 0, None)
    return Overview(
        module_id=module_id,
        learners=repository.learners(ids),
        study=repository.study_counts(module_id),
        concepts=tuple(ConceptRow(cid, stats.get(cid, empty)) for cid in ids),
    )
