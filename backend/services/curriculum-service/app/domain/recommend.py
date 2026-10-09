"""rules-v1 next-concept recommendation with a one-sentence explanation (FR-05, FR-06)."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from app.domain.graph import PrerequisiteGraph
from app.domain.mastery import MASTERY_THRESHOLD

MODEL_VERSION = "rules-v1"
FIXED_ORDER_VERSION = "fixed-order-v1"


@dataclass(frozen=True)
class Recommendation:
    module_id: str
    next_concept_id: str
    next_topic_id: str
    target_concept_id: str | None  # set when next_concept_id is a prerequisite to fix first
    weak_prerequisite_id: str | None
    readiness: float
    explanation: str | None  # None for the comparison group (contract v_next_topic)
    reason: str
    model_version: str


@dataclass(frozen=True)
class Locked:
    concept_id: str
    weak_prerequisite_id: str
    weak_prerequisite_mastery: float


@dataclass(frozen=True)
class Plan:
    module_id: str
    recommendation: Recommendation | None  # None when the module is complete
    locked: tuple[Locked, ...]

    @property
    def complete(self) -> bool:
        return self.recommendation is None


def recommend(
    graph: PrerequisiteGraph,
    module_id: str,
    mastery: Mapping[str, float],
    threshold: float = MASTERY_THRESHOLD,
) -> Plan:
    """Ready = every prerequisite mastered; pick the ready concept with the lowest mastery.

    Concepts without evidence count as 0. Raises GraphError for an unknown module.
    """
    view = graph.for_module(module_id)
    order = {c.concept_id: i for i, c in enumerate(graph.concepts)}

    def score(concept_id: str) -> float:
        return mastery.get(concept_id, 0.0)

    def mastered(concept_id: str) -> bool:
        return score(concept_id) >= threshold

    def weakest_prerequisite(concept_id: str) -> str | None:
        weak = [p for p in graph.prerequisites_of(concept_id) if not mastered(p)]
        return min(weak, key=lambda p: (score(p), order[p])) if weak else None

    open_concepts = [
        c.concept_id
        for c in view.concepts
        if c.module_id == module_id and not mastered(c.concept_id)
    ]
    if not open_concepts:
        return Plan(module_id, None, ())

    locked = tuple(
        Locked(cid, weak, score(weak))
        for cid in open_concepts
        if (weak := weakest_prerequisite(cid)) is not None
    )
    ready = [cid for cid in open_concepts if weakest_prerequisite(cid) is None]

    if ready:
        next_id = min(ready, key=lambda cid: (score(cid), order[cid]))
        target_id = weak_id = None
        explanation = _ready_sentence(graph, next_id)
    else:
        # Every open concept waits on another module (e.g. DSA on PF): fix that first.
        target_id = open_concepts[0]
        weak_id = weakest_prerequisite(target_id)
        next_id = target_id
        while (deeper := weakest_prerequisite(next_id)) is not None:
            next_id = deeper
        progress = f"{_pct(score(next_id))} mastered" if next_id in mastery else "not started yet"
        explanation = (
            f"Strengthen {graph.concept(next_id).name} first ({progress}), "
            f"because {graph.concept(target_id).name} builds on it."
        )

    prerequisites = graph.prerequisites_of(next_id)
    return Plan(
        module_id,
        Recommendation(
            module_id=module_id,
            next_concept_id=next_id,
            next_topic_id=graph.concept(next_id).topic_id,
            target_concept_id=target_id,
            weak_prerequisite_id=weak_id,
            readiness=min((score(p) for p in prerequisites), default=1.0),
            explanation=explanation,
            reason="adaptive",
            model_version=MODEL_VERSION,
        ),
        locked,
    )


def fixed_order(
    graph: PrerequisiteGraph,
    module_id: str,
    mastery: Mapping[str, float],
    threshold: float = MASTERY_THRESHOLD,
) -> Plan:
    """Comparison group: the first unmastered concept in syllabus position, no explanation."""
    view = graph.for_module(module_id)
    syllabus = sorted(
        (c for c in view.concepts if c.module_id == module_id),
        key=lambda c: (c.position, c.concept_id),
    )
    upcoming = next((c for c in syllabus if mastery.get(c.concept_id, 0.0) < threshold), None)
    if upcoming is None:
        return Plan(module_id, None, ())
    prerequisites = graph.prerequisites_of(upcoming.concept_id)
    return Plan(
        module_id,
        Recommendation(
            module_id=module_id,
            next_concept_id=upcoming.concept_id,
            next_topic_id=upcoming.topic_id,
            target_concept_id=None,
            weak_prerequisite_id=None,
            readiness=min((mastery.get(p, 0.0) for p in prerequisites), default=1.0),
            explanation=None,
            reason="fixed_order",
            model_version=FIXED_ORDER_VERSION,
        ),
        (),
    )


def _ready_sentence(graph: PrerequisiteGraph, concept_id: str) -> str:
    name = graph.concept(concept_id).name
    prerequisites = [graph.concept(p).name for p in graph.prerequisites_of(concept_id)]
    if not prerequisites:
        return f"{name} has no prerequisites, so it is a good place to start."
    return f"You are ready for {name} because you have mastered {_join(prerequisites)}."


def _join(names: list[str]) -> str:
    if len(names) > 3:
        return f"all {len(names)} of its prerequisites"
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"


def _pct(value: float) -> str:
    return f"{round(value * 100)}%"
