"""Which copy of the prerequisite graph the engine uses, and what happens when one fails.

Order of preference:

1. Neo4j, the authoritative graph that lecturers edit (when configured).
2. The last good copy saved in Postgres (`curriculum.graph_snapshot`), used
   when Neo4j is unreachable, for example when the free tier has paused.
3. The agreed starting graph in `core.concept_prerequisites`, used when Neo4j
   is not configured (teammates' machines) or has not been imported yet.

Recommendations must never stop because one store is down (NFR-05), so a failing
source is logged and the next one is tried. The sources are passed in, which
keeps this module free of database code and easy to test.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Protocol

from app.domain.graph import PrerequisiteGraph

logger = logging.getLogger("curriculum.graph")


class GraphSource(Protocol):
    name: str

    def read(self) -> PrerequisiteGraph | None:
        """Return the graph, None when this source holds no graph yet, or raise."""


class SnapshotStore(Protocol):
    def save(self, graph: PrerequisiteGraph, source: str) -> None: ...


class GraphUnavailableError(RuntimeError):
    """No source could provide a graph."""


@dataclass(frozen=True)
class LoadedGraph:
    graph: PrerequisiteGraph
    source: str
    # Set when a preferred source failed or was empty and a later one was used.
    fallback_reason: str | None = None


class GraphLoader:
    def __init__(
        self,
        sources: list[GraphSource],
        snapshot_store: SnapshotStore | None = None,
        snapshot_from: str = "neo4j",
    ) -> None:
        self._sources = sources
        self._snapshot_store = snapshot_store
        self._snapshot_from = snapshot_from

    def load(self) -> LoadedGraph:
        problems: list[str] = []
        for source in self._sources:
            try:
                graph = source.read()
            except Exception as exc:  # any store failure must fall through to the next
                problems.append(f"{source.name} failed ({type(exc).__name__})")
                logger.warning(
                    "graph source failed",
                    extra={"source": source.name, "error": type(exc).__name__},
                )
                continue
            if graph is None:
                if getattr(source, "optional", False):
                    continue  # e.g. no lecturer edit yet: nothing to report
                problems.append(f"{source.name} is empty")
                logger.warning("graph source is empty", extra={"source": source.name})
                continue

            if source.name == self._snapshot_from and self._snapshot_store is not None:
                self._save_snapshot(graph, source.name)
            logger.info(
                "graph loaded",
                extra={
                    "source": source.name,
                    "graph_version": graph.version,
                    "concepts": len(graph),
                    "edges": len(graph.edges),
                },
            )
            return LoadedGraph(graph, source.name, "; ".join(problems) or None)

        raise GraphUnavailableError("; ".join(problems) or "no graph sources configured")

    def _save_snapshot(self, graph: PrerequisiteGraph, source: str) -> None:
        # A failed snapshot must not fail the request: the graph itself is fine.
        try:
            self._snapshot_store.save(graph, source)  # type: ignore[union-attr]
        except Exception as exc:
            logger.warning("graph snapshot not saved", extra={"error": type(exc).__name__})


class GraphCache:
    """Loads the graph once and serves the in-memory copy until `reload()`.

    The graph changes only when a lecturer edits it, so reading it on every
    request would only add latency (NFR-01).
    """

    def __init__(self, loader: GraphLoader) -> None:
        self._loader = loader
        self._loaded: LoadedGraph | None = None
        self._lock = threading.Lock()

    def get(self) -> LoadedGraph:
        if self._loaded is None:
            with self._lock:
                if self._loaded is None:
                    self._loaded = self._loader.load()
        return self._loaded

    def reload(self) -> LoadedGraph:
        with self._lock:
            self._loaded = self._loader.load()
        return self._loaded
