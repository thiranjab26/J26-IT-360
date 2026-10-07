"""Builds the graph loader from settings.

With Neo4j configured: Neo4j first, then the Postgres snapshot, then `core`.
Without Neo4j (teammates' machines): `core` only. Nothing connects here; the
first request does.
"""

from __future__ import annotations

from dataclasses import dataclass

from neo4j import Driver

from app.config import Settings
from app.db.graph_sources import CoreGraphSource, SnapshotRepository
from app.db.neo4j_store import Neo4jGraphStore, create_driver
from app.db.session import get_engine
from app.domain.graph_loader import GraphCache, GraphLoader


@dataclass
class GraphRuntime:
    cache: GraphCache
    driver: Driver | None = None

    def close(self) -> None:
        if self.driver is not None:
            self.driver.close()


def build_graph_runtime(settings: Settings) -> GraphRuntime:
    engine = get_engine()
    core = CoreGraphSource(engine)
    if not settings.neo4j_enabled:
        return GraphRuntime(GraphCache(GraphLoader([core])))

    driver = create_driver(settings)
    snapshot = SnapshotRepository(engine)
    loader = GraphLoader([Neo4jGraphStore(driver), snapshot, core], snapshot_store=snapshot)
    return GraphRuntime(GraphCache(loader), driver)
