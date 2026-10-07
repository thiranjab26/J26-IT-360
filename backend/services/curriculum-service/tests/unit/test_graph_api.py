"""GET /api/v1/curriculum/graph, with the database replaced by in-memory sources."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.db.graph_wiring import GraphRuntime
from app.domain.graph import Concept, Edge, PrerequisiteGraph
from app.domain.graph_loader import GraphCache, GraphLoader
from app.main import create_app

URL = "/api/v1/curriculum/graph"
STUDENT = {"X-User-Id": str(uuid.uuid4()), "X-User-Role": "student"}


def real_slice() -> PrerequisiteGraph:
    concepts = [
        Concept("prog.methods", "Methods", "prog", "prog.methods", "Methods", 7),
        Concept(
            "prog.call_flow", "Method Call Flow and Scope", "prog", "prog.methods", "Methods", 8
        ),
        Concept("dsa.stack", "Stacks", "dsa", "dsa.linear_structures", "Linear Structures", 5),
        Concept("dsa.call_stack", "The call stack", "dsa", "dsa.recursion", "Recursion", 7),
    ]
    edges = [
        Edge("prog.call_flow", "prog.methods", False),
        Edge("dsa.call_stack", "prog.call_flow", True),
        Edge("dsa.call_stack", "dsa.stack", False),
    ]
    return PrerequisiteGraph(concepts, edges, "v0-core")


class Source:
    def __init__(self, name: str, result: PrerequisiteGraph | Exception) -> None:
        self.name, self.result = name, result

    def read(self) -> PrerequisiteGraph:
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def client_with(*sources: Source) -> TestClient:
    app = create_app()
    app.state.graph_runtime = GraphRuntime(GraphCache(GraphLoader(list(sources))))
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def client() -> TestClient:
    return client_with(Source("core", real_slice()))


def test_the_graph_requires_a_signed_in_caller(client: TestClient) -> None:
    response = client.get(URL)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_the_whole_graph(client: TestClient) -> None:
    body = client.get(URL, headers=STUDENT).json()

    assert body["graph_version"] == "v0-core"
    assert body["source"] == "core"
    assert body["stats"] == {"concepts": 4, "edges": 3, "cross_module_edges": 1, "max_depth": 2}
    depth = {n["concept_id"]: n["depth"] for n in body["nodes"]}
    assert depth == {"prog.methods": 0, "dsa.stack": 0, "prog.call_flow": 1, "dsa.call_stack": 2}
    assert {
        "concept_id": "dsa.call_stack",
        "prerequisite_id": "prog.call_flow",
        "cross_module": True,
    } in body["edges"]


def test_a_module_view_includes_its_cross_module_prerequisites(client: TestClient) -> None:
    body = client.get(URL, params={"module": "dsa"}, headers=STUDENT).json()
    ids = {n["concept_id"] for n in body["nodes"]}
    assert ids == {"dsa.stack", "dsa.call_stack", "prog.call_flow"}
    assert body["module_id"] == "dsa"


def test_an_unknown_module_is_a_404(client: TestClient) -> None:
    response = client.get(URL, params={"module": "physics"}, headers=STUDENT)
    assert response.status_code == 404
    assert response.json()["error"]["details"]["modules"] == ["dsa", "prog"]


@pytest.mark.parametrize("bad", ["DSA", "dsa;drop", "x" * 40, "d"])
def test_malformed_module_values_are_rejected(client: TestClient, bad: str) -> None:
    response = client.get(URL, params={"module": bad}, headers=STUDENT)
    assert response.status_code == 422


def test_fallback_is_reported_to_the_caller() -> None:
    client = client_with(Source("neo4j", ConnectionError("paused")), Source("core", real_slice()))
    body = client.get(URL, headers=STUDENT).json()
    assert body["source"] == "core"
    assert "neo4j failed" in body["fallback_reason"]


def test_no_graph_at_all_is_a_clean_503() -> None:
    client = client_with(Source("core", OSError("database down")))
    response = client.get(URL, headers=STUDENT)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "graph_unavailable"
    # Internal error details never reach the caller.
    assert "database down" not in response.text
