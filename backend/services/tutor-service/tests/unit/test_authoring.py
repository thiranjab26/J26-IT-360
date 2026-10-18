"""Lecturer-made practicals: checking a draft, replacing a practical, and what students keep.

Java is faked (see practical_support.py). The point here is the rules: what is allowed to be
approved, what a student sees before and after, and that nobody loses credit or is paid twice.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.practicals.authoring import AuthoringService, validate
from app.practicals.catalog import AssessmentCatalog
from app.practicals.service import PracticalService, practical_id
from app.sessions.catalog import load_course
from app.sessions.service import SessionProblem
from tests.unit.practical_support import (
    FakeRunner,
    InMemoryAssessmentStore,
    InMemoryPracticalRepository,
)
from tests.unit.session_support import InMemorySessionRepository

CONTENT = Path(__file__).resolve().parents[2] / "content"
LECTURER = str(uuid.uuid4())
OTHER_LECTURER = str(uuid.uuid4())

STATEMENT = (
    "Read one word and print it back exactly as it was typed, on a line by itself.\n\n"
    "Sample input:\n```\nhi\n```\nSample output:\n```\nhi\n```\n"
)
SOLUTION = "public class Main { public static void main(String[] a) { /* echo */ } }"


@pytest.fixture(scope="module")
def course():
    return load_course(CONTENT, "prog")


def authored(course):
    """The authored practicals in the order students see them."""
    entries = [e for e in course.bank.values() if e.question.kind == "code"]
    return sorted(
        entries, key=lambda e: (course.order.index(e.question.concept_id), e.question.number)
    )


class World:
    """One lecturer-facing service and one student-facing service over the same data."""

    def __init__(self, course, runner=None) -> None:
        self.course = course
        self.store = InMemoryAssessmentStore()
        self.tests = InMemoryPracticalRepository()
        self.game = InMemorySessionRepository()
        self.runner = runner or FakeRunner(lambda stdin: stdin)
        self.author = AuthoringService(self.store, self.tests, course, self.runner)
        self.everything = {e.question.concept_id for e in authored(course)}

    @property
    def students(self) -> PracticalService:
        """A new service each time, as in production where one is built per request."""
        return PracticalService(
            self.tests,
            self.game,
            self.course,
            self.runner,
            unlocked=lambda user: self.everything,
            items=self.store,
        )

    def listing(self, student: str):
        return {p.practical_id: p for p in self.students.listing(student).practicals}

    def draft(self, target_entry, statement=STATEMENT, solution=SOLUTION, level=4, **kw):
        q = target_entry.question if target_entry is not None else None
        return self.author.create_draft(
            LECTURER,
            q.concept_id if q else kw.pop("concept_id"),
            statement,
            solution,
            level,
            practical_id(q.question_id) if q else None,
            suggest_tests=False,
        )


@pytest.fixture
def world(course):
    return World(course)


# --------------------------------------------------------------------------------- validation
def checks(result) -> dict[str, str]:
    return {c["name"]: c["status"] for c in result.checks}


def test_a_good_draft_passes_every_check_and_gets_its_tests() -> None:
    result = validate(STATEMENT, SOLUTION, FakeRunner(lambda stdin: stdin))

    assert checks(result) == {
        "format": "pass",
        "safe_code": "pass",
        "compiles": "pass",
        "samples": "pass",
        "hidden": "warn",  # no model was asked for extra inputs
        "stable": "pass",
    }
    assert not result.failed and [(t.stdin, t.expected) for t in result.tests] == [("hi\n", "hi")]


@pytest.mark.parametrize(
    "danger",
    ["ProcessBuilder", "Runtime.getRuntime()", "new FileReader(x)", "java.net.URL", "Files"],
)
def test_code_that_touches_files_the_network_or_processes_is_never_run(danger) -> None:
    runner = FakeRunner()

    result = validate(STATEMENT, SOLUTION + f" // {danger}", runner)

    assert checks(result)["safe_code"] == "fail" and result.failed
    assert runner.calls == 0, "dangerous code must not reach the runner"


def test_a_solution_that_is_not_a_program_fails_the_format_check() -> None:
    result = validate(STATEMENT, "int x = 1;", FakeRunner())

    assert checks(result)["format"] == "fail"


def test_a_solution_that_does_not_compile_fails() -> None:
    result = validate(STATEMENT, SOLUTION + " COMPILE_ERROR", FakeRunner())

    assert checks(result)["compiles"] == "fail" and result.tests == []


def test_a_solution_that_prints_something_else_than_the_sample_fails_and_makes_no_tests() -> None:
    result = validate(STATEMENT, SOLUTION, FakeRunner(lambda stdin: "not that"))

    assert checks(result)["samples"] == "fail" and result.tests == []


def test_a_solution_whose_answers_change_between_runs_fails() -> None:
    calls = {"n": 0}

    def drifting(stdin: str) -> str:
        calls["n"] += 1
        return stdin if calls["n"] == 1 else "different"

    result = validate(STATEMENT, SOLUTION, FakeRunner(drifting))

    assert checks(result)["stable"] == "fail" and result.tests == []


# --------------------------------------------------------------------- nothing changes by default
def test_with_no_lecturer_changes_the_catalog_is_exactly_the_authored_practicals(course) -> None:
    catalog = AssessmentCatalog(course, [])

    assert [e.question.question_id for e in catalog.entries()] == [
        e.question.question_id
        for e in sorted(
            authored(course),
            key=lambda e: (course.order.index(e.question.concept_id), e.question.number),
        )
    ]
    assert len(catalog.entries()) == 39


def test_a_draft_is_invisible_to_students_until_it_is_approved(world, course) -> None:
    target = authored(course)[0]
    before = world.listing("s")

    world.draft(target)

    assert world.listing("s").keys() == before.keys()
    assert world.students.detail("s", practical_id(target.question.question_id)).statement == (
        target.question.stem
    )


# ------------------------------------------------------------------------------- replacing
def test_approving_replaces_the_old_practical_for_every_student(world, course) -> None:
    target = authored(course)[0]
    old_id = practical_id(target.question.question_id)
    draft = world.draft(target)
    assert draft.can_approve and draft.status == "draft"

    approved = world.author.approve(LECTURER, draft.practical_id, "looks right")

    assert approved.status == "approved" and approved.replaces == old_id
    listing = world.listing("anyone")
    assert old_id not in listing and approved.practical_id in listing
    assert len(listing) == 39, "replaced, not added"
    new = world.students.detail("anyone", approved.practical_id)
    assert new.statement == STATEMENT
    with pytest.raises(SessionProblem) as gone:
        world.students.detail("anyone", old_id)
    assert gone.value.code == "practical_not_found"


def test_the_replaced_authored_practical_is_kept_in_full(world, course) -> None:
    target = authored(course)[0]
    q = target.question
    draft = world.draft(target)

    world.author.approve(LECTURER, draft.practical_id, None)

    saved = world.store.get(q.question_id)
    assert saved is not None
    assert (saved.origin, saved.status) == ("authored", "retired")
    assert saved.statement == q.stem and saved.reference_solution == target.key.reference_solution
    assert saved.replaced_by_question_id == draft.practical_id.replace("~", "#")
    assert saved.retired_by == LECTURER
    history = world.author.overview(q.concept_id).history
    assert [h.practical_id for h in history] == [practical_id(q.question_id)]


def test_the_new_practical_takes_the_place_and_number_of_the_old_one(world, course) -> None:
    target = authored(course)[2]
    draft = world.draft(target)
    world.author.approve(LECTURER, draft.practical_id, None)

    ids = list(world.listing("s"))

    assert ids.index(draft.practical_id) == 2
    assert world.students.detail("s", draft.practical_id).title.endswith(
        f"practical {target.question.number}"
    )


def test_any_lecturer_can_approve_a_draft_another_lecturer_made(world, course) -> None:
    draft = world.draft(authored(course)[0])

    approved = world.author.approve(OTHER_LECTURER, draft.practical_id, None)

    assert approved.reviewed_by == OTHER_LECTURER and approved.created_by == LECTURER


def test_a_draft_with_a_failed_check_cannot_be_approved(world, course) -> None:
    draft = world.draft(authored(course)[0], solution=SOLUTION + " COMPILE_ERROR")
    assert not draft.can_approve

    with pytest.raises(SessionProblem) as caught:
        world.author.approve(LECTURER, draft.practical_id, None)

    assert caught.value.code == "checks_failed"
    assert authored(course)[0].question.question_id.replace("#", "~") in world.listing("s")


def test_fixing_a_failed_draft_lets_it_be_approved(world, course) -> None:
    draft = world.draft(authored(course)[0], solution=SOLUTION + " COMPILE_ERROR")

    fixed = world.author.edit_draft(draft.practical_id, None, SOLUTION, None, suggest_tests=False)

    assert fixed.can_approve and fixed.tests_total == 1
    world.author.approve(LECTURER, draft.practical_id, None)


def test_a_rejected_draft_changes_nothing_and_cannot_be_approved_later(world, course) -> None:
    draft = world.draft(authored(course)[0])
    before = world.listing("s").keys()

    rejected = world.author.reject(LECTURER, draft.practical_id, "too easy")

    assert rejected.status == "rejected" and rejected.review_note == "too easy"
    assert world.listing("s").keys() == before
    with pytest.raises(SessionProblem) as caught:
        world.author.approve(LECTURER, draft.practical_id, None)
    assert caught.value.code == "not_a_draft"


def test_two_drafts_for_one_place_the_second_approval_replaces_the_first(world, course) -> None:
    target = authored(course)[0]
    first, second = world.draft(target), world.draft(target)
    world.author.approve(LECTURER, first.practical_id, None)

    world.author.approve(LECTURER, second.practical_id, None)

    listing = world.listing("s")
    assert second.practical_id in listing and first.practical_id not in listing
    assert world.store.get(first.practical_id.replace("~", "#")).status == "retired"
    assert len(listing) == 39


def test_restore_brings_back_the_original_and_retires_its_replacement(world, course) -> None:
    target = authored(course)[0]
    old_id = practical_id(target.question.question_id)
    draft = world.draft(target)
    world.author.approve(LECTURER, draft.practical_id, None)

    world.author.restore(LECTURER, old_id)

    listing = world.listing("s")
    assert old_id in listing and draft.practical_id not in listing
    assert world.store.get(draft.practical_id.replace("~", "#")).status == "retired"


def test_a_new_practical_can_be_added_in_a_place_of_its_own(world, course) -> None:
    concept = authored(course)[0].question.concept_id
    draft = world.draft(None, concept_id=concept)

    world.author.approve(LECTURER, draft.practical_id, None)

    listing = world.listing("s")
    assert len(listing) == 40 and draft.practical_id in listing
    last = max(e.question.number for e in authored(course) if e.question.concept_id == concept)
    assert world.students.detail("s", draft.practical_id).title.endswith(f"practical {last + 1}")


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"concept_id": "prog.nope", "replaces": None}, "unknown_concept"),
        ({"level": 2}, "bad_level"),
        ({"replaces": "prog.loops~no-such"}, "bad_target"),
    ],
)
def test_a_draft_with_a_bad_concept_level_or_target_is_refused(world, course, change, code) -> None:
    target = authored(course)[0].question
    args = {
        "concept_id": target.concept_id,
        "level": 4,
        "replaces": practical_id(target.question_id),
    } | change

    with pytest.raises(SessionProblem) as caught:
        world.author.create_draft(
            LECTURER,
            args["concept_id"],
            STATEMENT,
            SOLUTION,
            args["level"],
            args["replaces"],
            False,
        )

    assert caught.value.kind == "invalid" and caught.value.code == code


# ----------------------------------------------------------------- students keep what they earned
def test_a_student_who_cleared_the_old_practical_keeps_credit_and_is_not_paid_twice(
    world, course
) -> None:
    target = authored(course)[0]
    old_id = practical_id(target.question.question_id)
    world.tests.replace_tests(target.question.question_id, [])  # authored tests are not needed here
    from app.practicals.tests_builder import TestCase

    world.tests.replace_tests(target.question.question_id, [TestCase("hi\n", "hi", True, "sample")])
    first = world.students.submit("s1", old_id, "x")
    assert first.passed and first.rewards is not None
    paid = world.game.total_xp("s1")

    draft = world.draft(target)
    world.author.approve(LECTURER, draft.practical_id, None)

    assert world.listing("s1")[draft.practical_id].passed, "credit follows the place"
    assert not world.listing("s2")[draft.practical_id].passed
    again = world.students.submit("s1", draft.practical_id, "x")
    assert again.passed and again.rewards is None, "no second bonus"
    assert world.game.total_xp("s1") == paid


def test_a_student_who_had_not_cleared_it_is_paid_once_for_the_new_one(world, course) -> None:
    target = authored(course)[0]
    draft = world.draft(target)
    world.author.approve(LECTURER, draft.practical_id, None)

    first = world.students.submit("s2", draft.practical_id, "x")
    second = world.students.submit("s2", draft.practical_id, "x")

    assert first.passed and first.rewards is not None and first.rewards.xp_gained > 0
    assert second.passed and second.rewards is None


def test_two_cleared_places_count_as_two_for_badges_not_one_per_version(world, course) -> None:
    from app.practicals.tests_builder import TestCase

    a, b = authored(course)[0], authored(course)[1]
    for entry in (a, b):
        world.tests.replace_tests(entry.question.question_id, [TestCase("hi\n", "hi", True, "x")])
        world.students.submit("s3", practical_id(entry.question.question_id), "x")
    draft = world.draft(a)
    world.author.approve(LECTURER, draft.practical_id, None)
    world.students.submit("s3", draft.practical_id, "x")

    slots = {
        world.students.catalog.slot_of(q)
        for q, s in world.tests.standings("s3").items()
        if s.passed
    }

    assert len(slots) == 2


def test_the_overview_lists_current_drafts_and_history_separately(world, course) -> None:
    target = authored(course)[0]
    pending = world.draft(target)
    approved = world.draft(target)
    world.author.approve(LECTURER, approved.practical_id, None)

    view = world.author.overview(target.question.concept_id)

    assert pending.practical_id in [d.practical_id for d in view.drafts]
    assert approved.practical_id in [c.practical_id for c in view.current]
    assert [h.practical_id for h in view.history] == [practical_id(target.question.question_id)]
    detail = world.author.detail(approved.practical_id)
    assert detail.reference_solution == SOLUTION and [t.expected for t in detail.tests] == ["hi"]
    assert [h.practical_id for h in detail.slot_history] == [
        practical_id(target.question.question_id)
    ]


# ------------------------------------------------------------------------------- who may do this
def test_only_lecturers_may_manage_practicals() -> None:
    from app.api.v1.routes.author import lecturer
    from app.core.deps import CurrentUser
    from app.core.errors import ApiError

    assert lecturer(CurrentUser(uuid.uuid4(), "lecturer")).role == "lecturer"
    for role in ("student", "admin"):
        with pytest.raises(ApiError) as caught:
            lecturer(CurrentUser(uuid.uuid4(), role))
        assert caught.value.code == "lecturers_only"
