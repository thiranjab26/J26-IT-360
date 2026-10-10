"""Stores lecturer edits: Neo4j (when configured), then the Postgres snapshot and audit row.

This service never writes `core`: without Neo4j the edited graph lives in
`curriculum.graph_snapshot`, which the loader reads before `core`.
"""

from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.db.graph_sources import insert_snapshot
from app.db.neo4j_store import Neo4jGraphStore
from app.domain.graph import PrerequisiteGraph
from app.domain.graph_edit import AuditEntry


class PostgresGraphWriter:
    def __init__(self, engine: Engine, neo4j: Neo4jGraphStore | None = None) -> None:
        self._engine = engine
        self._neo4j = neo4j

    def save(self, graph: PrerequisiteGraph, entry: AuditEntry) -> None:
        # Neo4j first: if it is unreachable, nothing is written anywhere and the edit fails.
        if self._neo4j is not None:
            self._neo4j.replace_graph(graph, status="edited")
        with self._engine.begin() as connection:
            insert_snapshot(connection, graph, "edit")
            connection.execute(
                text(
                    """
                    INSERT INTO curriculum.graph_audit
                        (actor, action, concept_id, prerequisite_id, graph_version, details)
                    VALUES (:actor, :action, :concept_id, :prerequisite_id, :version,
                            CAST(:details AS jsonb))
                    """
                ),
                {
                    "actor": entry.actor,
                    "action": entry.action,
                    "concept_id": entry.concept_id,
                    "prerequisite_id": entry.prerequisite_id,
                    "version": entry.graph_version,
                    "details": json.dumps(entry.details),
                },
            )

    def audit(self, limit: int) -> list[AuditEntry]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT actor, action, concept_id, prerequisite_id, graph_version, details,"
                    " changed_at FROM curriculum.graph_audit ORDER BY audit_id DESC LIMIT :limit"
                ),
                {"limit": limit},
            ).mappings()
            return [AuditEntry(**r) for r in rows]
