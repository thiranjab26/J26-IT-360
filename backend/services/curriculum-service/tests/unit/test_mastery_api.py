"""/me/mastery, /me/recommendation and /dev/attempts with an in-memory repository."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db.graph_wiring import GraphRuntime
from app.domain.graph_loader import GraphCache, GraphLoader
from app.domain.learner import Learner
from app.domain.mastery import DEFAULT_PARAMS, MasteryRecord, Observation, apply
from app.domain.recommend import Recommendation
from app.main import create_app
from tests.unit.test_graph_api import Source
from tests.unit.test_recommend import graph

PREFIX = "/api/v1/curriculum"
USER = uuid.uuid4()
STUDENT = {"X-User-Id": str(USER), "X-User-Role": "student"}


class FakeRepository:
    """Same behaviour as MasteryStore: first try per item only, BKT on ingest."""

    params_version = DEFAULT_PARAMS.version

    def __init__(self) -> None:
        self.attempts: list[tuple[uuid.UUID, str, str, bool, int]] = []
        self.records: dict[uuid.UUID, dict[str, MasteryRecord]] = {}
        self.seen: set[str] = set()
        self.saved: dict[tuple[uuid.UUID, str], Recommendation] = {}

    def ingest(self, user_id: uuid.UUID | None = None) -> set[uuid.UUID]:
        changed = set()
        for learner, concept_id, item_id, correct, hints in self.attempts:
            ref = f"{learner}|{item_id}"
            if (user_id and learner != user_id) or ref in self.seen:
                continue
            self.seen.add(ref)
            obs = Observation(
                concept_id, item_id, "practice", ref, correct, hints, datetime.now(UTC)
            )
            records = self.records.setdefault(learner, {})
            _, records[concept_id] = apply(records.get(concept_id), obs, DEFAULT_PARAMS)
            changed.add(learner)
        return changed

    def mastery(self, user_id: uuid.UUID) -> dict[str, MasteryRecord]:
        return dict(self.records.get(user_id, {}))

    def save_recommendation(self, user_id, recommendation, graph_version) -> None:  # noqa: ANN001
        self.saved[(user_id, recommendation.module_id)] = recommendation

    def add_stub_attempt(self, user_id, concept_id, item_id, correct, hints_used) -> None:  # noqa: ANN001
        self.attempts.append((user_id, concept_id, item_id, correct, hints_used))


@pytest.fixture
def repo() -> FakeRepository:
    return FakeRepository()


@pytest.fixture
def client(repo: FakeRepository) -> TestClient:
    app = create_app()
    app.state.graph_runtime = GraphRuntime(GraphCache(GraphLoader([Source("core", graph())])))
    app.state.learner = Learner(repo)
    return TestClient(app, raise_server_exceptions=False)


def practise(
    client: TestClient, concept_id: str, item_id: str, correct: bool = True, hints: int = 0
):  # noqa: ANN201
    return client.post(
        f"{PREFIX}/dev/attempts",
        json={
            "concept_id": concept_id,
            "item_id": item_id,
            "correct": correct,
            "hints_used": hints,
        },
        headers=STUDENT,
    )


@pytest.mark.parametrize(
    ("method", "path"),
    [("get", "/me/mastery"), ("get", "/me/recommendation?module=prog"), ("post", "/dev/attempts")],
)
def test_every_learner_route_requires_a_signed_in_caller(
    client: TestClient, method: str, path: str
) -> None:
    response = getattr(client, method)(f"{PREFIX}{path}")
    assert response.status_code == 401


def test_a_new_learner_has_no_evidence(client: TestClient) -> None:
    body = client.get(f"{PREFIX}/me/mastery", params={"module": "prog"}, headers=STUDENT).json()
    assert body["threshold"] == 0.7
    assert [c["concept_id"] for c in body["concepts"]] == [
        "prog.variables",
        "prog.loops",
        "prog.arrays",
    ]
    assert all(c["mastery_score"] is None and c["evidence_count"] == 0 for c in body["concepts"])


def test_a_practice_answer_updates_mastery(client: TestClient) -> None:
    body = practise(client, "prog.variables", "q1").json()
    assert body["counted"] and body["counted_as_correct"]
    assert body["mastery"]["evidence_count"] == 1
    assert body["mastery"]["mastery_score"] > DEFAULT_PARAMS.p_init


def test_a_retry_of_the_same_item_is_not_evidence(client: TestClient) -> None:
    practise(client, "prog.variables", "q1", correct=False)
    body = practise(client, "prog.variables", "q1", correct=True).json()
    assert body["counted"] is False
    assert body["mastery"]["evidence_count"] == 1


def test_a_hinted_answer_counts_as_wrong(client: TestClient) -> None:
    body = practise(client, "prog.variables", "q1", correct=True, hints=1).json()
    assert body["counted"] and not body["counted_as_correct"]
    assert body["mastery"]["mastery_score"] < DEFAULT_PARAMS.p_init


def test_practice_moves_the_recommendation_forward(
    client: TestClient, repo: FakeRepository
) -> None:
    first = client.get(f"{PREFIX}/me/recommendation", params={"module": "prog"}, headers=STUDENT)
    assert first.json()["recommendation"]["next_concept"]["concept_id"] == "prog.variables"

    for i in range(4):
        practise(client, "prog.variables", f"q{i}")
    body = client.get(
        f"{PREFIX}/me/recommendation", params={"module": "prog"}, headers=STUDENT
    ).json()

    rec = body["recommendation"]
    assert rec["next_concept"] == {"concept_id": "prog.loops", "name": "Loops"}
    assert rec["explanation"] == "You are ready for Loops because you have mastered Variables."
    assert body["locked"][0]["concept"]["concept_id"] == "prog.arrays"
    assert repo.saved[(USER, "prog")].next_concept_id == "prog.loops"


def test_an_unknown_module_or_concept_is_a_404(client: TestClient) -> None:
    response = client.get(
        f"{PREFIX}/me/recommendation", params={"module": "physics"}, headers=STUDENT
    )
    assert response.json()["error"]["code"] == "unknown_module"
    assert practise(client, "prog.nothing", "q1").json()["error"]["code"] == "unknown_concept"


@pytest.mark.parametrize(
    "body",
    [
        {"concept_id": "PROG.x", "item_id": "q1", "correct": True},
        {"concept_id": "prog.loops", "item_id": "q 1; drop", "correct": True},
        {"concept_id": "prog.loops", "item_id": "q1", "correct": True, "hints_used": -1},
    ],
)
def test_malformed_attempts_are_rejected(client: TestClient, body: dict) -> None:
    response = client.post(f"{PREFIX}/dev/attempts", json=body, headers=STUDENT)
    assert response.status_code == 422


def test_dev_routes_do_not_exist_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    get_settings.cache_clear()
    try:
        client = TestClient(create_app(), raise_server_exceptions=False)
        response = client.post(f"{PREFIX}/dev/attempts", json={}, headers=STUDENT)
        assert response.status_code == 404
    finally:
        get_settings.cache_clear()
