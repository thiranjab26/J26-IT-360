"""Practice (C3 stand-in): server-checked answers, hints, first-try rule, stub mode only."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db.graph_wiring import GraphRuntime
from app.domain.graph_loader import GraphCache, GraphLoader
from app.domain.learner import Learner
from app.domain.mastery import DEFAULT_PARAMS
from app.domain.practice import Practice, PracticeItem
from app.main import create_app
from tests.unit.fakes import FakePracticeRepository
from tests.unit.test_graph_api import Source
from tests.unit.test_mastery_api import FakeRepository
from tests.unit.test_recommend import graph

PREFIX = "/api/v1/curriculum/me/practice"
ITEMS = (
    PracticeItem("pr-v1", "prog.variables", "Q1", ("r", "w", "x", "y"), 0, "think"),
    PracticeItem("pr-v2", "prog.variables", "Q2", ("r", "w", "x", "y"), 0, "think again"),
    PracticeItem("pr-l1", "prog.loops", "Q3", ("r", "w"), 0, None),
)


def student() -> dict[str, str]:
    return {"X-User-Id": str(uuid.uuid4()), "X-User-Role": "student"}


@pytest.fixture
def client() -> TestClient:
    mastery = FakeRepository()
    app = create_app()
    app.state.graph_runtime = GraphRuntime(GraphCache(GraphLoader([Source("core", graph())])))
    app.state.learner = Learner(mastery)
    app.state.practice = Practice(
        FakePracticeRepository(ITEMS, mastery.attempts), app.state.learner
    )
    return TestClient(app, raise_server_exceptions=False)


def next_item(client: TestClient, who: dict, concept: str = "prog.variables") -> dict:
    return client.get(f"{PREFIX}/next", params={"concept": concept}, headers=who).json()


def answer(client: TestClient, who: dict, item: dict, right: bool) -> dict:
    shown = item["options"]
    choice = shown.index("r") if right else next(i for i, o in enumerate(shown) if o != "r")
    return client.post(
        f"{PREFIX}/answer", json={"item_id": item["item_id"], "chosen_index": choice}, headers=who
    ).json()


@pytest.mark.parametrize(
    ("method", "path"),
    [("get", "/next?concept=prog.loops"), ("post", "/hint"), ("post", "/answer")],
)
def test_practice_needs_a_signed_in_caller(client: TestClient, method: str, path: str) -> None:
    assert getattr(client, method)(f"{PREFIX}{path}").status_code == 401


def test_a_question_reaches_the_browser_without_answer_or_hint(client: TestClient) -> None:
    response = client.get(f"{PREFIX}/next", params={"concept": "prog.variables"}, headers=student())
    body = response.json()
    assert body["concept"] == {"concept_id": "prog.variables", "name": "Variables"}
    assert body["has_hint"] is True and sorted(body["options"]) == ["r", "w", "x", "y"]
    assert "answer_index" not in response.text and "think" not in response.text


def test_a_right_first_try_raises_mastery(client: TestClient) -> None:
    who = student()
    body = answer(client, who, next_item(client, who), right=True)
    assert body["correct"] and body["counted"] and body["counted_as_correct"]
    assert body["mastery"]["mastery_score"] > DEFAULT_PARAMS.p_init


def test_only_the_first_try_counts(client: TestClient) -> None:
    who = student()
    item = next_item(client, who)
    answer(client, who, item, right=False)
    retry = answer(client, who, item, right=True)
    assert retry["correct"] is True and retry["counted"] is False
    assert retry["mastery"]["evidence_count"] == 1


def test_a_hint_makes_a_right_answer_count_as_wrong(client: TestClient) -> None:
    who = student()
    item = next_item(client, who)
    hint = client.post(f"{PREFIX}/hint", json={"item_id": item["item_id"]}, headers=who).json()
    assert hint["hints_used"] == 1 and hint["hint"].startswith("think")
    body = answer(client, who, item, right=True)
    assert body["correct"] is True and body["counted_as_correct"] is False
    assert body["mastery"]["mastery_score"] < DEFAULT_PARAMS.p_init


def test_the_next_question_is_one_not_tried_yet(client: TestClient) -> None:
    who = student()
    first = next_item(client, who)
    answer(client, who, first, right=True)
    assert next_item(client, who)["item_id"] != first["item_id"]


def test_option_order_is_stable_for_a_learner_and_right_option_matches(client: TestClient) -> None:
    who = student()
    item = next_item(client, who)
    assert next_item(client, who)["options"] == item["options"]
    body = answer(client, who, item, right=False)
    assert item["options"][body["right_option"]] == "r"


@pytest.mark.parametrize(
    ("path", "payload", "code"),
    [
        ("/answer", {"item_id": "pr-v1", "chosen_index": 7}, "bad_choice"),
        ("/answer", {"item_id": "pr-none", "chosen_index": 0}, "unknown_item"),
        ("/hint", {"item_id": "pr-l1"}, "no_hint"),
    ],
)
def test_bad_requests_are_refused(client: TestClient, path: str, payload: dict, code: str) -> None:
    response = client.post(f"{PREFIX}{path}", json=payload, headers=student())
    assert response.json()["error"]["code"] == code


def test_unknown_concepts_and_concepts_without_questions(client: TestClient) -> None:
    who = student()
    assert next_item(client, who, "prog.nothing")["error"]["code"] == "unknown_concept"
    assert next_item(client, who, "prog.arrays")["error"]["code"] == "no_practice_items"


def test_practice_exists_only_in_stub_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTEGRATION_MODE", "live")
    get_settings.cache_clear()
    try:
        client = TestClient(create_app(), raise_server_exceptions=False)
        response = client.get(f"{PREFIX}/next", params={"concept": "prog.loops"}, headers=student())
        assert response.status_code == 404
    finally:
        get_settings.cache_clear()
