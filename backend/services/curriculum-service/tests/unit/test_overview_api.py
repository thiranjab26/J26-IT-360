"""Lecturer overview: per-concept class numbers in syllabus order, staff only, no learner ids."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.db.graph_wiring import GraphRuntime
from app.domain.cohort import ConceptStat, StudyCounts
from app.domain.graph_loader import GraphCache, GraphLoader
from app.main import create_app
from tests.unit.test_graph_api import Source
from tests.unit.test_recommend import graph

URL = "/api/v1/curriculum/study/prog/overview"
LECTURER = {"X-User-Id": str(uuid.uuid4()), "X-User-Role": "lecturer"}


class FakeCohort:
    def concept_stats(self, concept_ids: list[str], threshold: float) -> dict[str, ConceptStat]:
        return {"prog.variables": ConceptStat(4, 3, 0.72), "prog.loops": ConceptStat(2, 0, 0.31)}

    def learners(self, concept_ids: list[str]) -> int:
        return 4

    def study_counts(self, module_id: str) -> StudyCounts:
        return StudyCounts({"adaptive": 2, "comparison": 2}, 4, 1)


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    app.state.graph_runtime = GraphRuntime(GraphCache(GraphLoader([Source("core", graph())])))
    app.state.cohort = FakeCohort()
    return TestClient(app, raise_server_exceptions=False)


def test_overview_lists_the_module_concepts_in_syllabus_order(client: TestClient) -> None:
    body = client.get(URL, headers=LECTURER).json()
    assert [c["concept_id"] for c in body["concepts"]] == [
        "prog.variables",
        "prog.loops",
        "prog.arrays",
    ]
    assert body["concepts"][0] | {} == {
        "concept_id": "prog.variables",
        "name": "Variables",
        "topic_id": "prog.basics",
        "learners": 4,
        "mastered": 3,
        "mastered_pct": 75.0,
        "mean_mastery": 0.72,
    }
    assert body["concepts"][2]["learners"] == 0 and body["concepts"][2]["mastered_pct"] is None
    assert (body["learners"], body["groups"], body["pretest_done"], body["posttest_done"]) == (
        4,
        {"adaptive": 2, "comparison": 2},
        4,
        1,
    )
    assert "user_id" not in str(body)


def test_overview_is_for_staff_only(client: TestClient) -> None:
    student = {"X-User-Id": str(uuid.uuid4()), "X-User-Role": "student"}
    assert client.get(URL, headers=student).status_code == 403
    assert client.get(URL).status_code == 401


def test_an_unknown_module_is_a_404(client: TestClient) -> None:
    response = client.get("/api/v1/curriculum/study/physics/overview", headers=LECTURER)
    assert response.json()["error"]["code"] == "unknown_module"
