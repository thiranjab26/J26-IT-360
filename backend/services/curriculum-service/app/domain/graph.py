"""The prerequisite graph of concepts (FR-01, Objective 1).

Pure Python, no FastAPI or database imports, so every rule here is unit-tested
on its own. A graph is built from concepts and directed edges, where an edge
says "`prerequisite_id` must be learned before `concept_id`".

Construction validates the graph and refuses anything the engine cannot reason
over: unknown concept ids, self-loops and, most importantly, cycles. A cycle
would mean "A before B before A", which no learner can follow.
"""

from __future__ import annotations

import hashlib
import heapq
import json
from collections.abc import Iterable
from dataclasses import dataclass


class GraphError(ValueError):
    """The concepts and edges do not form a valid prerequisite graph."""


@dataclass(frozen=True)
class Concept:
    concept_id: str
    name: str
    module_id: str
    topic_id: str
    topic_name: str
    position: int


@dataclass(frozen=True)
class Edge:
    """`prerequisite_id` must be learned before `concept_id`."""

    concept_id: str
    prerequisite_id: str
    cross_module: bool


class PrerequisiteGraph:
    """An immutable, validated directed acyclic graph of concepts."""

    def __init__(self, concepts: Iterable[Concept], edges: Iterable[Edge], version: str) -> None:
        self.version = version
        self._concepts: dict[str, Concept] = {}
        for concept in concepts:
            if concept.concept_id in self._concepts:
                raise GraphError(f"Duplicate concept id: {concept.concept_id}")
            self._concepts[concept.concept_id] = concept

        unique: dict[tuple[str, str], Edge] = {}
        for edge in edges:
            if edge.concept_id == edge.prerequisite_id:
                raise GraphError(f"A concept cannot be its own prerequisite: {edge.concept_id}")
            for endpoint in (edge.concept_id, edge.prerequisite_id):
                if endpoint not in self._concepts:
                    raise GraphError(f"Edge refers to an unknown concept: {endpoint}")
            unique[(edge.concept_id, edge.prerequisite_id)] = edge
        self._edges = tuple(
            sorted(unique.values(), key=lambda e: (e.concept_id, e.prerequisite_id))
        )

        self._prerequisites: dict[str, list[str]] = {cid: [] for cid in self._concepts}
        self._dependents: dict[str, list[str]] = {cid: [] for cid in self._concepts}
        for edge in self._edges:
            self._prerequisites[edge.concept_id].append(edge.prerequisite_id)
            self._dependents[edge.prerequisite_id].append(edge.concept_id)

        self._order = self._topological_order()
        self._depth: dict[str, int] = {}
        for concept_id in self._order:
            prerequisites = self._prerequisites[concept_id]
            self._depth[concept_id] = (
                1 + max(self._depth[p] for p in prerequisites) if prerequisites else 0
            )

    # --- reading ------------------------------------------------------------

    @property
    def concepts(self) -> tuple[Concept, ...]:
        """Concepts in learning order: every prerequisite comes before its dependents."""
        return tuple(self._concepts[cid] for cid in self._order)

    @property
    def edges(self) -> tuple[Edge, ...]:
        return self._edges

    def __contains__(self, concept_id: object) -> bool:
        return concept_id in self._concepts

    def __len__(self) -> int:
        return len(self._concepts)

    def concept(self, concept_id: str) -> Concept:
        try:
            return self._concepts[concept_id]
        except KeyError as exc:
            raise GraphError(f"Unknown concept: {concept_id}") from exc

    def prerequisites_of(self, concept_id: str) -> tuple[str, ...]:
        self.concept(concept_id)
        return tuple(sorted(self._prerequisites[concept_id]))

    def dependents_of(self, concept_id: str) -> tuple[str, ...]:
        self.concept(concept_id)
        return tuple(sorted(self._dependents[concept_id]))

    def depth(self, concept_id: str) -> int:
        """Longest chain of prerequisites below a concept. Starting concepts are 0."""
        self.concept(concept_id)
        return self._depth[concept_id]

    def module_ids(self) -> tuple[str, ...]:
        return tuple(sorted({c.module_id for c in self._concepts.values()}))

    def for_module(self, module_id: str) -> PrerequisiteGraph:
        """A module's concepts plus the cross-module prerequisites they depend on.

        The DSA view therefore still shows the Programming Fundamentals concepts
        that DSA builds on, which is what a learner needs to see.
        """
        own = {cid for cid, c in self._concepts.items() if c.module_id == module_id}
        if not own:
            raise GraphError(f"Unknown module: {module_id}")
        keep = own | {e.prerequisite_id for e in self._edges if e.concept_id in own}
        return PrerequisiteGraph(
            (self._concepts[cid] for cid in keep),
            (e for e in self._edges if e.concept_id in own),
            self.version,
        )

    def checksum(self) -> str:
        """Stable fingerprint of the structure, used to detect changed graphs."""
        payload = {
            "concepts": sorted(self._concepts),
            "edges": sorted([e.concept_id, e.prerequisite_id] for e in self._edges),
        }
        return hashlib.sha256(json.dumps(payload).encode()).hexdigest()

    # --- validation ---------------------------------------------------------

    def _topological_order(self) -> list[str]:
        """Kahn's algorithm. Ties are broken by teaching position, then id."""
        remaining = {cid: len(p) for cid, p in self._prerequisites.items()}
        ready = [
            (self._concepts[cid].position, cid) for cid, count in remaining.items() if count == 0
        ]
        heapq.heapify(ready)
        order: list[str] = []
        while ready:
            _, concept_id = heapq.heappop(ready)
            order.append(concept_id)
            for dependent in self._dependents[concept_id]:
                remaining[dependent] -= 1
                if remaining[dependent] == 0:
                    heapq.heappush(ready, (self._concepts[dependent].position, dependent))

        if len(order) != len(self._concepts):
            stuck = {cid for cid, count in remaining.items() if count > 0}
            raise GraphError(f"The prerequisite graph has a cycle: {self._find_cycle(stuck)}")
        return order

    def _find_cycle(self, candidates: set[str]) -> str:
        """Follow prerequisite links inside the stuck set until a concept repeats."""
        start = min(candidates)
        path: list[str] = []
        seen: dict[str, int] = {}
        current = start
        while current not in seen:
            seen[current] = len(path)
            path.append(current)
            current = next(p for p in sorted(self._prerequisites[current]) if p in candidates)
        cycle = [*path[seen[current] :], current]
        return " -> ".join(reversed(cycle))
