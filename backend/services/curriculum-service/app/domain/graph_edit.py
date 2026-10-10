"""Lecturer edits to the prerequisite graph, validated and audited (Objective 1, NFR-11).

An edit never changes a graph in place: it builds a new graph with a new version,
which the PrerequisiteGraph constructor validates (no unknown concept, no self-loop,
no cycle). Only a valid graph is stored, together with its audit row.
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from app.domain.graph import Edge, GraphError, PrerequisiteGraph
from app.domain.graph_loader import GraphCache

EditAction = Literal["add_edge", "remove_edge"]


class GraphEditError(Exception):
    """`code` is stable for the API."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class AuditEntry:
    actor: str
    action: str
    concept_id: str | None
    prerequisite_id: str | None
    graph_version: str
    details: dict
    changed_at: datetime | None = None


class GraphWriter(Protocol):
    def save(self, graph: PrerequisiteGraph, entry: AuditEntry) -> None:
        """Store the edited graph and its audit row together, or raise and store nothing."""
        ...

    def audit(self, limit: int) -> list[AuditEntry]: ...


def next_version(version: str) -> str:
    """v0-core -> v0-core+e1 -> v0-core+e2; an import (e.g. v1) starts a new base."""
    base, _, count = version.partition("+e")
    return f"{base}+e{int(count) + 1 if count.isdigit() else 1}"


def edit(
    graph: PrerequisiteGraph, action: EditAction, concept_id: str, prerequisite_id: str
) -> PrerequisiteGraph:
    for concept in (concept_id, prerequisite_id):
        if concept not in graph:
            raise GraphEditError("unknown_concept", f"No such concept: {concept}.")
    if concept_id == prerequisite_id:
        raise GraphEditError("self_loop", "A concept cannot be its own prerequisite.")
    exists = prerequisite_id in graph.prerequisites_of(concept_id)
    if action == "add_edge":
        if exists:
            raise GraphEditError("edge_exists", "That prerequisite link already exists.")
        cross = graph.concept(concept_id).module_id != graph.concept(prerequisite_id).module_id
        edges = [*graph.edges, Edge(concept_id, prerequisite_id, cross)]
    else:
        if not exists:
            raise GraphEditError("no_such_edge", "That prerequisite link does not exist.")
        edges = [
            e
            for e in graph.edges
            if (e.concept_id, e.prerequisite_id) != (concept_id, prerequisite_id)
        ]
    try:
        return PrerequisiteGraph(graph.concepts, edges, next_version(graph.version))
    except GraphError as exc:  # the only way a valid graph plus one edge fails: a cycle
        raise GraphEditError("creates_cycle", f"This link would create a loop: {exc}") from exc


class GraphEditor:
    """Applies one edit at a time to the freshest graph, then refreshes the cache."""

    def __init__(self, cache: GraphCache, writer: GraphWriter) -> None:
        self._cache = cache
        self._writer = writer
        self._lock = threading.Lock()  # one service process; edits are rare

    def apply(
        self,
        actor: uuid.UUID,
        action: EditAction,
        concept_id: str,
        prerequisite_id: str,
        reason: str,
    ) -> PrerequisiteGraph:
        with self._lock:
            current = self._cache.reload().graph  # never edit a stale copy
            edited = edit(current, action, concept_id, prerequisite_id)
            self._writer.save(
                edited,
                AuditEntry(
                    actor=str(actor),
                    action=action,
                    concept_id=concept_id,
                    prerequisite_id=prerequisite_id,
                    graph_version=edited.version,
                    details={
                        "reason": reason,
                        "previous_version": current.version,
                        "edges_before": len(current.edges),
                        "edges_after": len(edited.edges),
                    },
                ),
            )
            return self._cache.reload().graph

    def audit(self, limit: int = 50) -> list[AuditEntry]:
        return self._writer.audit(limit)
