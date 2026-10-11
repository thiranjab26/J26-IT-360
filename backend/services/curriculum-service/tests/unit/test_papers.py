"""Question editor: draft -> published -> locked, versions, retire, publish checks."""

from __future__ import annotations

import itertools
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db.graph_wiring import GraphRuntime
from app.domain.assessment import check_bank, item_root
from app.domain.graph_loader import GraphCache, GraphLoader
from app.domain.papers import Papers, PaperVersion
from app.main import create_app
from tests.unit.fakes import FakePaperRepository
from tests.unit.test_assessment import make_paper
from tests.unit.test_graph_api import Source
from tests.unit.test_recommend import graph

PREFIX = "/api/v1/curriculum"
LECTURER = {"X-User-Id": str(uuid.uuid4()), "X-User-Role": "lecturer"}
STUDENT = {"X-User-Id": str(uuid.uuid4()), "X-User-Role": "student"}
MAIN = 6  # make_paper: 3 concepts x 2 questions


class Setup:
    def __init__(self) -> None:
        self.repo = FakePaperRepository(
            tuple(PaperVersion(make_paper("prog", form), 1, "published") for form in ("A", "B"))
        )
        tokens = (f"n{n}" for n in itertools.count(1))
        app = create_app()
        app.state.graph_runtime = GraphRuntime(GraphCache(GraphLoader([Source("core", graph())])))
        app.state.papers = Papers(self.repo, main_items=MAIN, new_token=lambda: next(tokens))
        self.client = TestClient(app, raise_server_exceptions=False)

    def get(self, path: str, **kwargs):  # noqa: ANN003, ANN201
        return self.client.get(f"{PREFIX}/papers{path}", headers=LECTURER, **kwargs)

    def post(self, path: str, **kwargs):  # noqa: ANN003, ANN201
        return self.client.post(f"{PREFIX}/papers{path}", headers=LECTURER, **kwargs)

    def put(self, path: str, **kwargs):  # noqa: ANN003, ANN201
        return self.client.put(f"{PREFIX}/papers{path}", headers=LECTURER, **kwargs)

    def delete(self, path: str):  # noqa: ANN201
        return self.client.delete(f"{PREFIX}/papers{path}", headers=LECTURER)

    def publish(self, module: str = "prog"):  # noqa: ANN201
        return self.post("/publish", params={"module": module})

    def summary(self, paper_id: str) -> dict:
        rows = self.get("", params={"module": "prog"}).json()
        return next(r for r in rows if r["paper_id"] == paper_id)


def question(**overrides) -> dict:  # noqa: ANN003
    body = {
        "concept_id": "prog.loops",
        "section": "main",
        "stem": "How many times does the loop run?",
        "options": ["1", "2", "3", "4"],
        "answer_index": 2,
    }
    return body | overrides


def code(response) -> str:  # noqa: ANN001
    return response.json()["error"]["code"]


@pytest.fixture
def s() -> Setup:
    return Setup()


# --- access -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/papers?module=prog"),
        ("get", "/papers/prog-A"),
        ("post", "/papers/prog-A/revise"),
        ("post", "/papers/publish?module=prog"),
        ("delete", "/papers/prog-A/items/prog-A-01"),
    ],
)
def test_only_staff_reach_the_editor(s: Setup, method: str, path: str) -> None:
    call = getattr(s.client, method)
    assert call(f"{PREFIX}{path}").status_code == 401
    assert call(f"{PREFIX}{path}", headers=STUDENT).status_code == 403


# --- reading ------------------------------------------------------------------


def test_the_list_shows_versions_status_and_the_current_paper(s: Setup) -> None:
    rows = s.get("", params={"module": "prog"}).json()
    assert [(r["paper_id"], r["version"], r["status"], r["current"]) for r in rows] == [
        ("prog-A", 1, "published", True),
        ("prog-B", 1, "published", True),
    ]
    assert rows[0]["main_items"] == MAIN
    assert s.get("", params={"module": "physics"}).json()["error"]["code"] == "unknown_module"


def test_staff_see_the_answers(s: Setup) -> None:
    item = s.get("/prog-A").json()["items"][0]
    assert item["answer_index"] == 1
    assert item["twin_item_id"] == "prog-B-01"
    assert code(s.get("/nothing")) == "no_paper"


# --- lifecycle ----------------------------------------------------------------


def test_published_and_locked_papers_never_change(s: Setup) -> None:
    assert code(s.put("/prog-A/items/prog-A-01", json=question())) == "not_draft"
    assert code(s.delete("/prog-A/items/prog-A-01")) == "not_draft"
    assert code(s.delete("/prog-A")) == "not_draft"
    s.repo.lock("prog-A")
    response = s.client.patch(f"{PREFIX}/papers/prog-A", json={"title": "x"}, headers=LECTURER)
    assert (response.status_code, code(response)) == (409, "not_draft")
    assert s.summary("prog-A")["status"] == "locked"


def test_revise_copies_the_current_paper_into_a_new_draft_version(s: Setup) -> None:
    s.repo.lock("prog-A")  # a learner has started it
    response = s.post("/prog-A/revise")
    assert response.status_code == 201
    draft = response.json()
    assert (draft["paper_id"], draft["version"], draft["status"]) == ("prog-A-v2", 2, "draft")
    assert draft["current"] is False  # learners still get version 1
    assert draft["items"][0]["item_id"] == "prog-A-01:v2"
    assert draft["items"][0]["twin_item_id"] == "prog-B-01"
    assert s.summary("prog-A")["status"] == "locked"  # the old version is untouched

    assert code(s.post("/prog-A/revise")) == "draft_exists"
    assert code(s.post("/prog-A-v2/revise")) == "already_draft"


def test_editing_a_draft_then_publishing_makes_it_current(s: Setup) -> None:
    s.post("/prog-A/revise")
    # PUT replaces the whole question, so the twin is sent again.
    new = question(concept_id="prog.variables", twin_item_id="prog-B-01")
    changed = s.put("/prog-A-v2/items/prog-A-01:v2", json=new)
    assert changed.json()["stem"] == "How many times does the loop run?"

    assert s.publish().json() == {"module_id": "prog", "published": ["prog-A-v2"]}
    assert s.summary("prog-A-v2")["current"] is True
    assert s.summary("prog-A")["current"] is False
    # Only the newest version can be revised again.
    assert code(s.post("/prog-A/revise")) == "not_current"
    assert code(s.publish()) == "nothing_to_publish"


def test_publish_checks_both_forms_and_lists_every_problem(s: Setup) -> None:
    s.post("/prog-A/revise")
    s.post("/prog-A-v2/items", json=question())  # a 7th main question without a twin
    s.put("/prog-A-v2/items/prog-A-02:v2", json=question(twin_item_id="prog-B-05"))
    response = s.publish()
    assert response.status_code == 422
    assert code(response) == "publish_failed"
    problems = response.json()["error"]["details"]["problems"]
    assert "prog-A-v2: 7 main items, expected 6" in problems
    assert "prog: forms A and B cover concepts differently" in problems
    assert any("twin is missing from form B" in p for p in problems)
    assert any("prog-A-02:v2: twin does not point back" in p for p in problems)
    assert s.summary("prog-A-v2")["status"] == "draft"  # nothing was published


def test_retiring_a_question_and_adding_its_replacement_to_both_forms(s: Setup) -> None:
    for paper in ("prog-A", "prog-B"):
        s.post(f"/{paper}/revise")
    # Retire twin pair 01 (prog.variables) and write a new pair for the same concept.
    assert s.delete("/prog-A-v2/items/prog-A-01:v2").status_code == 204
    assert s.delete("/prog-B-v2/items/prog-B-01:v2").status_code == 204
    new = question(concept_id="prog.variables", twin_item_id="prog-B-n2")
    assert s.post("/prog-A-v2/items", json=new).json()["item_id"] == "prog-A-n1"
    s.post("/prog-B-v2/items", json=new | {"twin_item_id": "prog-A-n1"})

    assert s.publish().json()["published"] == ["prog-A-v2", "prog-B-v2"]
    items = [i["item_id"] for i in s.get("/prog-A-v2").json()["items"]]
    assert "prog-A-01:v2" not in items and items[-1] == "prog-A-n1"
    assert [i["position"] for i in s.get("/prog-A-v2").json()["items"]] == list(range(1, 7))
    # Version 1 keeps the retired question for the learners who sat it.
    assert s.get("/prog-A").json()["items"][0]["item_id"] == "prog-A-01"


def test_questions_can_be_moved(s: Setup) -> None:
    s.post("/prog-A/revise")
    s.put("/prog-A-v2/items/prog-A-06:v2", json=question(concept_id="prog.arrays", position=1))
    items = s.get("/prog-A-v2").json()["items"]
    assert [i["item_id"] for i in items[:2]] == ["prog-A-06:v2", "prog-A-01:v2"]
    assert [i["position"] for i in items] == list(range(1, 7))


def test_a_new_form_starts_as_an_empty_draft(s: Setup) -> None:
    assert code(s.post("", params={"module": "prog"}, json={"form": "A", "title": "x"})) == (
        "paper_exists"
    )
    response = s.post("", params={"module": "dsa"}, json={"form": "A", "title": "DSA form A"})
    assert response.status_code == 201
    assert (response.json()["paper_id"], response.json()["status"]) == ("dsa-A", "draft")
    problems = s.publish("dsa").json()["error"]["details"]["problems"]
    assert "dsa: needs exactly forms A and B, has ['A']" in problems


def test_a_draft_can_be_discarded(s: Setup) -> None:
    s.post("/prog-A/revise")
    assert s.delete("/prog-A-v2").status_code == 204
    assert code(s.get("/prog-A-v2")) == "no_paper"
    assert s.post("/prog-A/revise").status_code == 201  # and revised again


@pytest.mark.parametrize(
    ("body", "status", "error"),
    [
        (question(answer_index=4), 422, "bad_item"),
        (question(options=["1", "1", "2"]), 422, "bad_item"),
        (question(options=["1", "  "]), 422, "bad_item"),
        (question(stem="   "), 422, "bad_item"),
        (question(section="prereq", twin_item_id="prog-B-01"), 422, "bad_item"),
        (question(concept_id="prog.nothing"), 422, "unknown_concept"),
        (question(concept_id="Prog.loops"), 422, "validation_error"),
        (question(options=["1"]), 422, "validation_error"),
    ],
)
def test_bad_questions_are_refused(s: Setup, body: dict, status: int, error: str) -> None:
    s.post("/prog-A/revise")
    response = s.post("/prog-A-v2/items", json=body)
    assert (response.status_code, code(response)) == (status, error)


def test_unknown_items_are_404(s: Setup) -> None:
    s.post("/prog-A/revise")
    assert code(s.put("/prog-A-v2/items/prog-A-99", json=question())) == "no_item"
    assert s.delete("/prog-A-v2/items/prog-A-99").status_code == 404


def test_every_write_records_who_made_it(s: Setup) -> None:
    s.post("/prog-A/revise")
    assert s.repo.writers == [uuid.UUID(LECTURER["X-User-Id"])]


# --- twins across versions ------------------------------------------------------


def test_twins_match_by_root_across_versions() -> None:
    assert item_root("prog-A-03:v12") == "prog-A-03"
    assert item_root("prog-A-03") == "prog-A-03"
    a, b = make_paper("prog", "A"), make_paper("prog", "B")
    revised = Papers(FakePaperRepository((PaperVersion(a, 1, "published"),)))
    v2 = revised.revise("prog-A", uuid.uuid4()).paper
    known = {c.concept_id for c in graph().concepts}
    assert check_bank([v2, b], known, MAIN) == []
