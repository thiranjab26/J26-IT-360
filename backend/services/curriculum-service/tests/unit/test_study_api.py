"""Pre/post tests, the study window, gain and snapshot validation through the API."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.db.graph_wiring import GraphRuntime
from app.domain.assessment import Enrolment
from app.domain.graph_loader import GraphCache, GraphLoader
from app.domain.learner import Learner
from app.domain.study import Study
from app.main import create_app
from tests.unit.fakes import FakeAssessmentRepository
from tests.unit.test_assessment import make_paper
from tests.unit.test_graph_api import Source
from tests.unit.test_mastery_api import FakeRepository
from tests.unit.test_recommend import graph

PREFIX = "/api/v1/curriculum"
LECTURER = {"X-User-Id": str(uuid.uuid4()), "X-User-Role": "lecturer"}


def student() -> dict[str, str]:
    return {"X-User-Id": str(uuid.uuid4()), "X-User-Role": "student"}


class Setup:
    def __init__(self) -> None:
        self.mastery = FakeRepository()
        self.tests = FakeAssessmentRepository(
            (
                make_paper("prog", "A"),
                make_paper("prog", "B"),
                make_paper("dsa", "A", ("dsa.stack", "dsa.search"), prereq=("prog.arrays",)),
                make_paper("dsa", "B", ("dsa.stack", "dsa.search"), prereq=("prog.arrays",)),
            )
        )
        self.next_cell = Enrolment("adaptive", "AB")
        app = create_app()
        app.state.graph_runtime = GraphRuntime(GraphCache(GraphLoader([Source("core", graph())])))
        app.state.learner = Learner(self.mastery)
        app.state.study = Study(
            self.tests,
            app.state.learner,
            # Like choose_cell: an existing group wins, the test picks the rest.
            lambda _counts, group: Enrolment(
                group or self.next_cell.group, self.next_cell.form_order
            ),
        )
        self.client = TestClient(app, raise_server_exceptions=False)

    def window(self, module: str, phase: str):  # noqa: ANN201
        return self.client.put(
            f"{PREFIX}/study/{module}/window", json={"phase": phase}, headers=LECTURER
        )

    def start(self, who: dict, kind: str, module: str = "prog"):  # noqa: ANN201
        return self.client.post(
            f"{PREFIX}/me/tests/{kind}/start", params={"module": module}, headers=who
        )

    def submit(self, who: dict, kind: str, answers: dict, module: str = "prog"):  # noqa: ANN201
        return self.client.post(
            f"{PREFIX}/me/tests/{kind}/submit",
            params={"module": module},
            json={"answers": [{"item_id": k, "chosen_index": v} for k, v in answers.items()]},
            headers=who,
        )

    def sit(self, who: dict, kind: str, right: int, module: str = "prog") -> dict:
        """Start and submit: the first `right` main items and every prerequisite item right."""
        items = self.start(who, kind, module).json()["items"]
        answers = {
            item["item_id"]: pick(item, right=n < right or item["section"] == "prereq")
            for n, item in enumerate(items)
        }
        return self.submit(who, kind, answers, module).json()


def pick(item: dict, right: bool) -> int:
    """Position of the right option ("r" in make_paper) as shown, or of a wrong one."""
    shown = item["options"]
    return shown.index("r") if right else next(i for i, o in enumerate(shown) if o != "r")


@pytest.fixture
def s() -> Setup:
    return Setup()


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/me/tests?module=prog"),
        ("post", "/me/tests/pretest/start?module=prog"),
        ("post", "/me/tests/pretest/submit?module=prog"),
        ("get", "/me/gain?module=prog"),
        ("get", "/study/prog/window"),
    ],
)
def test_every_route_needs_a_signed_in_caller(s: Setup, method: str, path: str) -> None:
    assert getattr(s.client, method)(f"{PREFIX}{path}").status_code == 401


@pytest.mark.parametrize(
    "path", ["/study/prog/window", "/study/prog/gain", "/study/prog/snapshot-validation"]
)
def test_students_cannot_use_staff_routes(s: Setup, path: str) -> None:
    assert s.client.get(f"{PREFIX}{path}", headers=student()).status_code == 403
    put = s.client.put(f"{PREFIX}/study/prog/window", json={"phase": "pretest"}, headers=student())
    assert put.status_code == 403


def test_the_lecturer_controls_the_window(s: Setup) -> None:
    assert s.client.get(f"{PREFIX}/study/prog/window", headers=LECTURER).json()["phase"] == "closed"
    assert s.window("prog", "pretest").json() == {"module_id": "prog", "phase": "pretest"}
    assert s.window("prog", "open").status_code == 422
    assert s.window("physics", "pretest").json()["error"]["code"] == "unknown_module"


def test_a_closed_test_cannot_be_started(s: Setup) -> None:
    response = s.start(student(), "pretest")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "test_closed"


def test_the_paper_reaches_the_browser_without_answers_or_group(s: Setup) -> None:
    s.window("prog", "pretest")
    who = student()
    response = s.start(who, "pretest")
    assert response.status_code == 200
    assert len(response.json()["items"]) == 6
    for secret in ("answer_index", "twin_item_id", "concept_id", "adaptive", "group"):
        assert secret not in response.text
    status = s.client.get(f"{PREFIX}/me/tests", params={"module": "prog"}, headers=who)
    assert status.json()["open_test"] == "pretest"
    assert "adaptive" not in status.text and "group" not in status.text


def test_start_resumes_the_same_attempt(s: Setup) -> None:
    s.window("prog", "pretest")
    who = student()
    first = s.start(who, "pretest").json()
    again = s.start(who, "pretest").json()
    assert first == again


def test_submit_scores_on_the_server_once(s: Setup) -> None:
    s.window("prog", "pretest")
    who = student()
    body = s.sit(who, "pretest", right=3)
    assert body["repeat"] is False
    assert body["attempt"]["score_pct"] == 50.0
    assert (body["attempt"]["main_correct"], body["attempt"]["main_total"]) == (3, 6)

    # Resubmitting different answers changes nothing.
    again = s.submit(who, "pretest", {f"prog-A-0{n}": 1 for n in range(1, 7)}).json()
    assert again["repeat"] is True
    assert again["attempt"]["score_pct"] == 50.0
    assert s.start(who, "pretest").json()["error"]["code"] == "already_submitted"


def test_pretest_answers_set_starting_mastery_without_a_learning_step(s: Setup) -> None:
    s.window("prog", "pretest")
    who = student()
    s.sit(who, "pretest", right=2)  # both variables items right, the rest wrong
    user = uuid.UUID(who["X-User-Id"])
    sources = {obs.source for _, obs in s.mastery.evidence}
    assert sources == {"pretest"}
    records = s.mastery.records[user]
    assert records["prog.variables"].score > 0.5 > records["prog.loops"].score
    assert records["prog.variables"].evidence_count == 2


def test_blank_answers_are_wrong_but_not_evidence(s: Setup) -> None:
    s.window("prog", "pretest")
    who = student()
    first = s.start(who, "pretest").json()["items"][0]
    body = s.submit(who, "pretest", {first["item_id"]: pick(first, right=True)}).json()
    assert body["attempt"]["main_correct"] == 1
    assert len(s.mastery.evidence) == 1


def test_options_are_shuffled_per_attempt_and_scored_by_the_original_option(s: Setup) -> None:
    s.window("prog", "pretest")
    one, two = student(), student()
    first = [i["options"] for i in s.start(one, "pretest").json()["items"]]
    second = [i["options"] for i in s.start(two, "pretest").json()["items"]]
    assert all(sorted(o) == ["r", "w", "x", "y"] for o in first)
    assert first != second  # two attempts, two orders (chance of equal: 1 in 24^6)

    body = s.sit(one, "pretest", right=6)
    assert body["attempt"]["score_pct"] == 100.0
    attempt_id = s.tests.attempts[(uuid.UUID(one["X-User-Id"]), "prog", "pretest")].attempt_id
    assert {r.chosen_index for r in s.tests.answers[attempt_id]} == {1}  # stored as original


def test_a_learner_keeps_one_group_across_modules(s: Setup) -> None:
    s.window("prog", "pretest")
    s.window("dsa", "pretest")
    who = student()
    user = uuid.UUID(who["X-User-Id"])
    s.next_cell = Enrolment("comparison", "AB")
    s.start(who, "pretest", "prog")
    s.next_cell = Enrolment("adaptive", "BA")
    s.start(who, "pretest", "dsa")
    assert s.tests.enrolments[(user, "prog")] == Enrolment("comparison", "AB")
    assert s.tests.enrolments[(user, "dsa")] == Enrolment("comparison", "BA")


@pytest.mark.parametrize(
    ("answers", "status", "code"),
    [
        ([{"item_id": "prog-A-01", "chosen_index": 1}] * 2, 422, "duplicate_answer"),
        ([{"item_id": "prog-B-01", "chosen_index": 1}], 422, "unknown_item"),
        ([{"item_id": "prog-A-01", "chosen_index": 5}], 422, "bad_choice"),
    ],
)
def test_bad_submissions_are_rejected(s: Setup, answers: list, status: int, code: str) -> None:
    s.window("prog", "pretest")
    who = student()
    s.start(who, "pretest")
    response = s.client.post(
        f"{PREFIX}/me/tests/pretest/submit",
        params={"module": "prog"},
        json={"answers": answers},
        headers=who,
    )
    assert (response.status_code, response.json()["error"]["code"]) == (status, code)


def test_submit_after_the_window_closes_is_refused(s: Setup) -> None:
    s.window("prog", "pretest")
    who = student()
    s.start(who, "pretest")
    s.window("prog", "learning")
    assert s.submit(who, "pretest", {}).json()["error"]["code"] == "test_closed"


def test_the_posttest_needs_a_submitted_pretest(s: Setup) -> None:
    s.window("prog", "posttest")
    assert s.start(student(), "posttest").json()["error"]["code"] == "pretest_required"


def test_counterbalanced_forms(s: Setup) -> None:
    s.window("prog", "pretest")
    ab, ba = student(), student()
    s.next_cell = Enrolment("adaptive", "AB")
    assert s.start(ab, "pretest").json()["items"][0]["item_id"] == "prog-A-01"
    s.next_cell = Enrolment("comparison", "BA")
    assert s.start(ba, "pretest").json()["items"][0]["item_id"] == "prog-B-01"
    for who in (ab, ba):
        s.sit(who, "pretest", right=2)
    s.window("prog", "posttest")
    assert s.start(ab, "posttest").json()["items"][0]["item_id"] == "prog-B-01"
    assert s.start(ba, "posttest").json()["items"][0]["item_id"] == "prog-A-01"


def test_the_dsa_prerequisite_section_is_pretest_only_and_not_scored(s: Setup) -> None:
    s.window("dsa", "pretest")
    who = student()
    items = s.start(who, "pretest", "dsa").json()["items"]
    assert [i["section"] for i in items].count("prereq") == 1
    body = s.sit(who, "pretest", right=4, module="dsa")
    assert body["attempt"]["main_total"] == 4
    user = uuid.UUID(who["X-User-Id"])
    assert s.mastery.records[user]["prog.arrays"].evidence_count == 1

    s.window("dsa", "posttest")
    post = s.start(who, "posttest", "dsa").json()["items"]
    assert all(i["section"] == "main" for i in post)


def test_comparison_learners_get_the_fixed_order(s: Setup) -> None:
    s.window("prog", "pretest")
    who = student()
    s.next_cell = Enrolment("comparison", "AB")
    s.sit(who, "pretest", right=0)
    rec = s.client.get(
        f"{PREFIX}/me/recommendation", params={"module": "prog"}, headers=who
    ).json()["recommendation"]
    assert rec["reason"] == "fixed_order"
    assert rec["explanation"] is None


def test_full_journey_with_snapshot_gain_and_validation(s: Setup) -> None:
    s.window("prog", "pretest")
    who = student()
    user = uuid.UUID(who["X-User-Id"])
    s.sit(who, "pretest", right=0)

    s.window("prog", "learning")
    for n in range(5):
        s.client.post(
            f"{PREFIX}/dev/attempts",
            json={"concept_id": "prog.variables", "item_id": f"p{n}", "correct": True},
            headers=who,
        )
    practised = s.mastery.records[user]["prog.variables"].score

    s.window("prog", "posttest")
    post_items = s.start(who, "posttest").json()["items"]
    attempt_id = s.tests.attempts[(user, "prog", "posttest")].attempt_id
    snapshot = {row.concept_id: row.p_mastery for row in s.tests.snapshots[attempt_id]}
    assert snapshot["prog.variables"] == pytest.approx(practised)
    assert set(snapshot) == {"prog.variables", "prog.loops", "prog.arrays"}

    s.submit(
        who, "posttest", {i["item_id"]: pick(i, right=n < 3) for n, i in enumerate(post_items)}
    )
    assert {obs.source for _, obs in s.mastery.evidence} == {"pretest", "practice", "posttest"}

    gain = s.client.get(f"{PREFIX}/me/gain", params={"module": "prog"}, headers=who).json()
    assert gain["overall"] == {"pre_pct": 0.0, "post_pct": 50.0, "gain": 0.5}
    assert gain["by_concept"]["prog.variables"]["gain"] == 1.0
    assert gain["by_topic"]["prog.arrays"]["post_pct"] == 0.0

    cohort = s.client.get(f"{PREFIX}/study/prog/gain", headers=LECTURER).json()
    assert (cohort["enrolled"], cohort["pretest_done"], cohort["posttest_done"]) == (1, 1, 1)
    assert cohort["groups"]["adaptive"]["mean_gain"] == 0.5
    assert cohort["groups"]["comparison"]["learners"] == 0
    assert cohort["learners"][0]["group"] == "adaptive"

    check = s.client.get(f"{PREFIX}/study/prog/snapshot-validation", headers=LECTURER).json()
    assert check["answers"] == 6
    assert check["auc"] is not None


def test_gain_needs_both_tests(s: Setup) -> None:
    response = s.client.get(f"{PREFIX}/me/gain", params={"module": "prog"}, headers=student())
    assert response.json()["error"]["code"] == "no_gain_yet"
