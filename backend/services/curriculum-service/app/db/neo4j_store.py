"""The prerequisite graph in Neo4j: the authoritative copy lecturers edit.

Model:
    (:Concept {id, name, module_id, topic_id, topic_name, position})
    (:Concept)-[:PREREQUISITE_OF {cross_module, status, graph_version}]->(:Concept)
    (:GraphMeta {key: 'curriculum', graph_version, updated_at})

An arrow means "the start concept must be learned before the end concept".
Every query passes values as $parameters; no Cypher is built from strings.
"""

from __future__ import annotations

from datetime import UTC, datetime

from neo4j import Driver, GraphDatabase

from app.config import Settings
from app.domain.graph import Concept, Edge, PrerequisiteGraph

_CONSTRAINT = (
    "CREATE CONSTRAINT concept_id_unique IF NOT EXISTS FOR (c:Concept) REQUIRE c.id IS UNIQUE"
)
_READ_CONCEPTS = """
MATCH (c:Concept)
RETURN c.id AS concept_id, c.name AS name, c.module_id AS module_id,
       c.topic_id AS topic_id, c.topic_name AS topic_name, c.position AS position
"""
_READ_EDGES = """
MATCH (p:Concept)-[r:PREREQUISITE_OF]->(c:Concept)
RETURN c.id AS concept_id, p.id AS prerequisite_id, r.cross_module AS cross_module
"""
_READ_VERSION = "MATCH (m:GraphMeta {key: 'curriculum'}) RETURN m.graph_version AS version"


def create_driver(settings: Settings) -> Driver:
    assert settings.neo4j_enabled, "Neo4j settings are incomplete"
    return GraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password.get_secret_value()),  # type: ignore[union-attr]
        connection_timeout=5,
        connection_acquisition_timeout=5,
        max_transaction_retry_time=5,
    )


class Neo4jGraphStore:
    name = "neo4j"

    def __init__(self, driver: Driver) -> None:
        self._driver = driver

    def read(self) -> PrerequisiteGraph | None:
        with self._driver.session() as session:
            concepts = [
                Concept(
                    concept_id=r["concept_id"],
                    name=r["name"],
                    module_id=r["module_id"],
                    topic_id=r["topic_id"],
                    topic_name=r["topic_name"],
                    position=int(r["position"]),
                )
                for r in session.run(_READ_CONCEPTS)
            ]
            if not concepts:
                return None
            edges = [
                Edge(r["concept_id"], r["prerequisite_id"], bool(r["cross_module"]))
                for r in session.run(_READ_EDGES)
            ]
            record = session.run(_READ_VERSION).single()
        version = record["version"] if record and record["version"] else "unversioned"
        return PrerequisiteGraph(concepts, edges, version)

    def replace_graph(self, graph: PrerequisiteGraph, status: str) -> dict[str, int]:
        """Make Neo4j hold exactly `graph`: upsert it, then remove what it no longer has.

        Concepts are defined in `core`, so a Neo4j concept that `core` no longer
        has is deleted together with its edges.
        """
        concepts = [c.__dict__ | {"id": c.concept_id} for c in graph.concepts]
        edges = [
            {
                "concept_id": e.concept_id,
                "prerequisite_id": e.prerequisite_id,
                "cross": e.cross_module,
            }
            for e in graph.edges
        ]
        concept_ids = [c.concept_id for c in graph.concepts]
        pairs = [[e.prerequisite_id, e.concept_id] for e in graph.edges]

        def work(tx) -> dict[str, int]:  # noqa: ANN001
            tx.run(
                """
                UNWIND $concepts AS row
                MERGE (c:Concept {id: row.id})
                SET c.name = row.name, c.module_id = row.module_id, c.topic_id = row.topic_id,
                    c.topic_name = row.topic_name, c.position = row.position
                """,
                concepts=concepts,
            )
            removed_concepts = tx.run(
                "MATCH (c:Concept) WHERE NOT c.id IN $ids DETACH DELETE c RETURN count(c) AS n",
                ids=concept_ids,
            ).single()["n"]
            removed_edges = tx.run(
                """
                MATCH (p:Concept)-[r:PREREQUISITE_OF]->(c:Concept)
                WHERE NOT [p.id, c.id] IN $pairs
                DELETE r RETURN count(r) AS n
                """,
                pairs=pairs,
            ).single()["n"]
            tx.run(
                """
                UNWIND $edges AS row
                MATCH (p:Concept {id: row.prerequisite_id}), (c:Concept {id: row.concept_id})
                MERGE (p)-[r:PREREQUISITE_OF]->(c)
                SET r.cross_module = row.cross, r.status = $status, r.graph_version = $version
                """,
                edges=edges,
                status=status,
                version=graph.version,
            )
            tx.run(
                """
                MERGE (m:GraphMeta {key: 'curriculum'})
                SET m.graph_version = $version, m.updated_at = $now
                """,
                version=graph.version,
                now=datetime.now(UTC).isoformat(),
            )
            return {"removed_concepts": removed_concepts, "removed_edges": removed_edges}

        with self._driver.session() as session:
            session.run(_CONSTRAINT)
            return session.execute_write(work)
