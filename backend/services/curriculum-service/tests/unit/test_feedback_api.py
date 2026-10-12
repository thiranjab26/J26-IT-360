"""POST /me/recommendation/feedback with an in-memory repository."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.domain.feedback import Shown
from app.main import create_app

PREFIX = "/api/v1/curriculum"
URL = f"{PREFIX}/me/recommendation/feedback?module=prog"
USER = uuid.uuid4()
STUDENT = {"X-User-Id": str(USER), "X-User-Role": "student"}
SENTENCE = "You are ready for Loops because you have mastered Variables."


class FakeFeedback:
    def __init__(self) -> None:
        self.current: dict[tuple[uuid.UUID, str], Shown] = {}
        self.ratings: dict[tuple[uuid.UUID, str, str, str], bool] = {}

    def shown(self, user_id: uuid.UUID, module_id: str) -> Shown | None:
        return self.current.get((user_id, module_id))

    def save(self, user_id: uuid.UUID, module_id: str, shown: Shown, helpful: bool) -> None:
        self.ratings[(user_id, module_id, shown.concept_id, shown.explanation or "")] = helpful


@pytest.fixture
def repo() -> FakeFeedback:
    return FakeFeedback()


@pytest.fixture
def client(repo: FakeFeedback) -> TestClient:
    app = create_app()
    app.state.feedback = repo
    return TestClient(app, raise_server_exceptions=False)


def test_requires_a_signed_in_caller(client: TestClient) -> None:
    assert client.post(URL, json={"concept_id": "prog.loops", "helpful": True}).status_code == 401


def test_rates_the_stored_explanation(client: TestClient, repo: FakeFeedback) -> None:
    repo.current[(USER, "prog")] = Shown("prog.loops", SENTENCE, "gat-v2")
    response = client.post(URL, json={"concept_id": "prog.loops", "helpful": True}, headers=STUDENT)
    assert response.status_code == 204
    assert repo.ratings == {(USER, "prog", "prog.loops", SENTENCE): True}


def test_changing_your_mind_replaces_the_rating(client: TestClient, repo: FakeFeedback) -> None:
    repo.current[(USER, "prog")] = Shown("prog.loops", SENTENCE, "gat-v2")
    for helpful in (True, False):
        client.post(URL, json={"concept_id": "prog.loops", "helpful": helpful}, headers=STUDENT)
    assert list(repo.ratings.values()) == [False]


def test_a_stale_card_is_refused(client: TestClient, repo: FakeFeedback) -> None:
    repo.current[(USER, "prog")] = Shown("prog.arrays", SENTENCE, "gat-v2")
    response = client.post(URL, json={"concept_id": "prog.loops", "helpful": True}, headers=STUDENT)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "stale_recommendation"
    assert repo.ratings == {}


def test_without_any_recommendation_nothing_is_rated(client: TestClient) -> None:
    response = client.post(URL, json={"concept_id": "prog.loops", "helpful": True}, headers=STUDENT)
    assert response.json()["error"]["code"] == "stale_recommendation"


def test_the_comparison_group_has_nothing_to_rate(client: TestClient, repo: FakeFeedback) -> None:
    repo.current[(USER, "prog")] = Shown("prog.loops", None, "fixed-order-v1")
    response = client.post(URL, json={"concept_id": "prog.loops", "helpful": True}, headers=STUDENT)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_explanation"


def test_a_bad_concept_id_is_rejected(client: TestClient) -> None:
    response = client.post(URL, json={"concept_id": "nope", "helpful": True}, headers=STUDENT)
    assert response.status_code == 422
