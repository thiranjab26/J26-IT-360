"""Graph edits: validation, versions, audit, staff only, and the loader picking up the edit."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.db.graph_wiring import GraphRuntime
from app.domain.graph import PrerequisiteGraph
from app.domain.graph_edit import AuditEntry, GraphEditError, edit, next_version
from app.domain.graph_loader import GraphCache, GraphLoader
from app.main import create_app
from tests.unit.test_graph_api import Source
from tests.unit.test_recommend import graph

PREFIX = "/api/v1/curriculum"
LECTURER = {"X-User-Id": str(uuid.uuid4()), "X-User-Role": "lecturer"}
STUDENT = {"X-User-Id": str(uuid.uuid4()), "X-User-Role": "student"}


class EditStore:
    """In-memory writer that is also the first graph source, like the Postgres snapshot."""

    name = "snapshot"
    optional = True

    def __init__(self) -> None:
        self.graph: PrerequisiteGraph | None = None
        self.entries: list[AuditEntry] = []

    def read(self) -> PrerequisiteGraph | None:
        return self.graph

    def save(self, graph: PrerequisiteGraph, entry: AuditEntry) -> None:
        self.graph = graph
        self.entries.append(entry)

    def audit(self, limit: int) -> list[AuditEntry]:
        return self.entries[::-1][:limit]


@pytest.fixture
def store() -> EditStore:
    return EditStore()


@pytest.fixture
def client(store: EditStore) -> TestClient:
    app = create_app()
    loader = GraphLoader([store, Source("core", graph())])
    app.state.graph_runtime = GraphRuntime(GraphCache(loader), writer=store)
    return TestClient(app, raise_server_exceptions=False)


def post_edit(client: TestClient, action: str, concept: str, prerequisite: str, who=LECTURER):  # noqa: ANN001, ANN201
    return client.post(
        f"{PREFIX}/graph/edits",
        json={
            "action": action,
            "concept_id": concept,
            "prerequisite_id": prerequisite,
            "reason": "lecturer review",
        },
        headers=who,
    )


def test_versions_count_edits_on_top_of_a_base() -> None:
    assert next_version("v0-core") == "v0-core+e1"
    assert next_version("v0-core+e1") == "v0-core+e2"
    assert next_version("v1") == "v1+e1"


def test_adding_and_removing_an_edge() -> None:
    added = edit(graph(), "add_edge", "prog.arrays", "prog.variables")
    assert "prog.variables" in added.prerequisites_of("prog.arrays")
    assert added.version == "test+e1"
    removed = edit(added, "remove_edge", "prog.arrays", "prog.variables")
    assert "prog.variables" not in removed.prerequisites_of("prog.arrays")


def test_a_cross_module_edge_is_marked() -> None:
    added = edit(graph(), "add_edge", "dsa.stack", "prog.loops")
    edge = next(
        e for e in added.edges if (e.concept_id, e.prerequisite_id) == ("dsa.stack", "prog.loops")
    )
    assert edge.cross_module is True


@pytest.mark.parametrize(
    ("action", "concept", "prerequisite", "code"),
    [
        (
            "add_edge",
            "prog.variables",
            "prog.arrays",
            "creates_cycle",
        ),  # arrays needs variables already
        ("add_edge", "prog.loops", "prog.variables", "edge_exists"),
        ("add_edge", "prog.loops", "prog.loops", "self_loop"),
        ("add_edge", "prog.loops", "prog.nothing", "unknown_concept"),
        ("remove_edge", "prog.arrays", "prog.variables", "no_such_edge"),
    ],
)
def test_invalid_edits_are_refused(action: str, concept: str, prerequisite: str, code: str) -> None:
    with pytest.raises(GraphEditError) as error:
        edit(graph(), action, concept, prerequisite)  # type: ignore[arg-type]
    assert error.value.code == code


def test_an_edit_is_stored_audited_and_served(client: TestClient, store: EditStore) -> None:
    response = post_edit(client, "add_edge", "prog.arrays", "prog.variables")
    assert response.status_code == 200
    assert response.json()["graph_version"] == "test+e1"

    served = client.get(f"{PREFIX}/graph", headers=STUDENT).json()
    assert served["graph_version"] == "test+e1"
    assert served["source"] == "snapshot" and served["fallback_reason"] is None
    assert {
        "concept_id": "prog.arrays",
        "prerequisite_id": "prog.variables",
        "cross_module": False,
    } in served["edges"]

    audit = client.get(f"{PREFIX}/graph/audit", headers=LECTURER).json()
    assert audit[0]["action"] == "add_edge"
    assert audit[0]["actor"] == LECTURER["X-User-Id"]
    assert audit[0]["details"]["previous_version"] == "test"
    assert audit[0]["details"]["reason"] == "lecturer review"


def test_a_refused_edit_changes_nothing(client: TestClient, store: EditStore) -> None:
    response = post_edit(client, "add_edge", "prog.variables", "prog.arrays")
    assert (response.status_code, response.json()["error"]["code"]) == (409, "creates_cycle")
    assert store.graph is None and store.entries == []


def test_before_any_edit_core_is_used_without_a_fallback_warning(client: TestClient) -> None:
    served = client.get(f"{PREFIX}/graph", headers=STUDENT).json()
    assert (served["source"], served["fallback_reason"]) == ("core", None)


@pytest.mark.parametrize(("method", "path"), [("post", "/graph/edits"), ("get", "/graph/audit")])
def test_students_cannot_edit_or_read_the_audit(client: TestClient, method: str, path: str) -> None:
    kwargs = (
        {
            "json": {
                "action": "add_edge",
                "concept_id": "prog.arrays",
                "prerequisite_id": "prog.variables",
                "reason": "nope",
            }
        }
        if method == "post"
        else {}
    )
    response = getattr(client, method)(f"{PREFIX}{path}", headers=STUDENT, **kwargs)
    assert response.status_code == 403


def test_a_reason_is_required(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/graph/edits",
        json={
            "action": "add_edge",
            "concept_id": "prog.arrays",
            "prerequisite_id": "prog.variables",
        },
        headers=LECTURER,
    )
    assert response.status_code == 422
