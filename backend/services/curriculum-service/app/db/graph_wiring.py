"""Builds the graph loader and the edit writer from settings.

With Neo4j configured: Neo4j first, then the Postgres snapshot, then `core`.
Without Neo4j (teammates' machines): lecturer edits in the snapshot first (none
until someone edits), then `core`. Nothing connects here; the first request does.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from neo4j import Driver

from app.config import Settings
from app.db.graph_sources import CoreGraphSource, SnapshotRepository
from app.db.graph_writer import PostgresGraphWriter
from app.db.neo4j_store import Neo4jGraphStore, create_driver
from app.db.session import get_engine
from app.domain.graph_edit import GraphEditor, GraphWriter
from app.domain.graph_loader import GraphCache, GraphLoader


@dataclass
class GraphRuntime:
    cache: GraphCache
    driver: Driver | None = None
    writer: GraphWriter | None = None
    _editor: GraphEditor | None = field(default=None, init=False, repr=False)

    def editor(self) -> GraphEditor | None:
        """One editor per runtime, so its lock serialises every edit."""
        if self._editor is None and self.writer is not None:
            self._editor = GraphEditor(self.cache, self.writer)
        return self._editor

    def close(self) -> None:
        if self.driver is not None:
            self.driver.close()


def build_graph_runtime(settings: Settings) -> GraphRuntime:
    engine = get_engine()
    core = CoreGraphSource(engine)
    if not settings.neo4j_enabled:
        edits = SnapshotRepository(engine, optional=True)
        return GraphRuntime(
            GraphCache(GraphLoader([edits, core])), writer=PostgresGraphWriter(engine)
        )

    driver = create_driver(settings)
    neo4j = Neo4jGraphStore(driver)
    snapshot = SnapshotRepository(engine)
    loader = GraphLoader([neo4j, snapshot, core], snapshot_store=snapshot)
    return GraphRuntime(GraphCache(loader), driver, PostgresGraphWriter(engine, neo4j))
