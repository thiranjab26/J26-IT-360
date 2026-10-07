"""Postgres sources of the prerequisite graph.

`CoreGraphSource` reads the agreed starting graph from the shared `core` schema,
which every service may read directly. `SnapshotRepository` keeps the last good
copy of the Neo4j graph in this service's own `curriculum` schema.

All SQL uses bound parameters; nothing is built by string concatenation.
"""

from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.domain.graph import Concept, Edge, PrerequisiteGraph

CORE_GRAPH_VERSION = "v0-core"

_CONCEPTS_SQL = text(
    """
    SELECT c.concept_id, c.name, c.module_id, c.topic_id, t.name AS topic_name, c.position
    FROM core.concepts AS c
    JOIN core.topics AS t ON t.topic_id = c.topic_id
    """
)
_EDGES_SQL = text(
    "SELECT concept_id, prerequisite_id, cross_module FROM core.concept_prerequisites"
)


def concept_from_row(row: dict) -> Concept:
    return Concept(
        concept_id=row["concept_id"],
        name=row["name"],
        module_id=row["module_id"],
        topic_id=row["topic_id"],
        topic_name=row["topic_name"],
        position=int(row["position"]),
    )


def edge_from_row(row: dict) -> Edge:
    return Edge(
        concept_id=row["concept_id"],
        prerequisite_id=row["prerequisite_id"],
        cross_module=bool(row["cross_module"]),
    )


class CoreGraphSource:
    name = "core"

    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def read(self) -> PrerequisiteGraph | None:
        with self._engine.connect() as connection:
            concepts = [concept_from_row(r) for r in connection.execute(_CONCEPTS_SQL).mappings()]
            edges = [edge_from_row(r) for r in connection.execute(_EDGES_SQL).mappings()]
        if not concepts:
            return None
        return PrerequisiteGraph(concepts, edges, CORE_GRAPH_VERSION)


class SnapshotRepository:
    """Last good copy of the authoritative graph, in `curriculum.graph_snapshot`.

    A new row is written only when the graph's structure changed, so the table
    doubles as a history of graph versions.
    """

    name = "snapshot"

    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def read(self) -> PrerequisiteGraph | None:
        with self._engine.connect() as connection:
            row = (
                connection.execute(
                    text(
                        "SELECT graph_version, concepts, edges FROM curriculum.graph_snapshot "
                        "ORDER BY snapshot_id DESC LIMIT 1"
                    )
                )
                .mappings()
                .first()
            )
        if row is None:
            return None
        return PrerequisiteGraph(
            (concept_from_row(c) for c in row["concepts"]),
            (edge_from_row(e) for e in row["edges"]),
            row["graph_version"],
        )

    def save(self, graph: PrerequisiteGraph, source: str) -> None:
        checksum = graph.checksum()
        with self._engine.begin() as connection:
            latest = connection.execute(
                text(
                    "SELECT checksum, graph_version FROM curriculum.graph_snapshot "
                    "ORDER BY snapshot_id DESC LIMIT 1"
                )
            ).first()
            if latest is not None and tuple(latest) == (checksum, graph.version):
                return
            connection.execute(
                text(
                    """
                    INSERT INTO curriculum.graph_snapshot
                        (graph_version, source, checksum, concepts, edges)
                    VALUES (:version, :source, :checksum,
                            CAST(:concepts AS jsonb), CAST(:edges AS jsonb))
                    """
                ),
                {
                    "version": graph.version,
                    "source": source,
                    "checksum": checksum,
                    "concepts": json.dumps([c.__dict__ for c in graph.concepts]),
                    "edges": json.dumps([e.__dict__ for e in graph.edges]),
                },
            )
