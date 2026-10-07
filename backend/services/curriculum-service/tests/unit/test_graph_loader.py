"""The graph keeps loading when a store is down (NFR-05), in the agreed order."""

from __future__ import annotations

import pytest

from app.domain.graph import Concept, PrerequisiteGraph
from app.domain.graph_loader import GraphCache, GraphLoader, GraphUnavailableError


def tiny_graph(version: str) -> PrerequisiteGraph:
    return PrerequisiteGraph([Concept("dsa.a", "A", "dsa", "dsa.t", "T", 1)], [], version)


class Source:
    def __init__(self, name: str, result: PrerequisiteGraph | None | Exception) -> None:
        self.name = name
        self.result = result
        self.calls = 0

    def read(self) -> PrerequisiteGraph | None:
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class Snapshots:
    def __init__(self, fail: bool = False) -> None:
        self.saved: list[tuple[str, str]] = []
        self.fail = fail

    def save(self, graph: PrerequisiteGraph, source: str) -> None:
        if self.fail:
            raise RuntimeError("table missing")
        self.saved.append((graph.version, source))


def test_neo4j_is_used_first_and_snapshotted() -> None:
    snapshots = Snapshots()
    loader = GraphLoader(
        [Source("neo4j", tiny_graph("v1")), Source("core", tiny_graph("v0-core"))],
        snapshot_store=snapshots,
    )
    loaded = loader.load()
    assert (loaded.source, loaded.graph.version, loaded.fallback_reason) == ("neo4j", "v1", None)
    assert snapshots.saved == [("v1", "neo4j")]


def test_neo4j_down_falls_back_to_the_snapshot() -> None:
    loader = GraphLoader(
        [
            Source("neo4j", ConnectionError("paused")),
            Source("snapshot", tiny_graph("v1")),
            Source("core", tiny_graph("v0-core")),
        ],
        snapshot_store=Snapshots(),
    )
    loaded = loader.load()
    assert loaded.source == "snapshot"
    assert loaded.graph.version == "v1"
    assert "neo4j failed" in (loaded.fallback_reason or "")


def test_empty_neo4j_and_no_snapshot_falls_back_to_core() -> None:
    loaded = GraphLoader(
        [Source("neo4j", None), Source("snapshot", None), Source("core", tiny_graph("v0-core"))]
    ).load()
    assert loaded.source == "core"
    assert "neo4j is empty" in (loaded.fallback_reason or "")


def test_a_failed_snapshot_save_does_not_fail_the_load() -> None:
    loaded = GraphLoader(
        [Source("neo4j", tiny_graph("v1"))], snapshot_store=Snapshots(fail=True)
    ).load()
    assert loaded.source == "neo4j"


def test_only_the_authoritative_source_is_snapshotted() -> None:
    snapshots = Snapshots()
    GraphLoader([Source("core", tiny_graph("v0-core"))], snapshot_store=snapshots).load()
    assert snapshots.saved == []


def test_no_source_at_all_raises() -> None:
    with pytest.raises(GraphUnavailableError, match="core failed"):
        GraphLoader([Source("core", OSError("db down"))]).load()


def test_cache_loads_once_until_reloaded() -> None:
    source = Source("core", tiny_graph("v0-core"))
    cache = GraphCache(GraphLoader([source]))
    cache.get()
    cache.get()
    assert source.calls == 1
    cache.reload()
    assert source.calls == 2
