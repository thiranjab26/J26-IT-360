"""Practicals: building their tests, marking a submission, and the rewards for passing.

The Java itself is faked here (see practical_support.py); that the real runner behaves is
checked in test_practical_runner.py and the integration tests.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from app.gamification.progression import BONUSES
from app.llm.providers import Generation, LLMError
from app.practicals.service import PracticalService, practical_id
from app.practicals.tests_builder import (
    TestCase,
    build_tests,
    parse_samples,
    same_output,
)
from app.sessions.catalog import load_course
from app.sessions.service import SessionProblem
from tests.unit.practical_support import FakeRunner, InMemoryPracticalRepository
from tests.unit.session_support import InMemorySessionRepository

CONTENT = Path(__file__).resolve().parents[2] / "content"
STUDENT = str(uuid.uuid4())


@pytest.fixture(scope="module")
def course():
    return load_course(CONTENT, "prog")


def code_entries(course):
    return [e for e in course.bank.values() if e.question.kind == "code"]


# ----------------------------------------------------------------- the authored questions
# Statements that describe their input in words instead of showing a sample block. Their first
# generated test is shown as the example. A new question without a sample must be added here on
# purpose, not slip in unnoticed.
NO_SAMPLE_BLOCK = {
    "prog.java_intro#exercise-q10",
    "prog.java_intro#exercise-q11",
    "prog.code_tracing#exercise-q11",
}


def test_every_code_question_is_a_runnable_program_and_nearly_all_show_a_sample(course) -> None:
    entries = code_entries(course)

    assert len(entries) == 39
    without = set()
    for entry in entries:
        q = entry.question
        if not parse_samples(q.stem):
            without.add(q.question_id)
        reference = entry.key.reference_solution or ""
        assert "public class Main" in reference and "static void main" in reference, q.question_id
    assert without == NO_SAMPLE_BLOCK


# ------------------------------------------------------------------------- comparing output
@pytest.mark.parametrize(
    ("actual", "expected", "same"),
    [
        ("3\n", "3", True),
        ("3   \n\n\n", "\n3", True),
        ("a\r\nb\r\n", "a\nb", True),
        ("a \nb", "a\nb", True),
        ("3.0", "3", False),
        ("a\nb", "a\n\nb", False),
        ("A", "a", False),
        ("", "x", False),
    ],
)
def test_output_is_compared_line_by_line_ignoring_trailing_space(actual, expected, same) -> None:
    assert same_output(actual, expected) is same


def test_a_statement_with_no_sample_shows_its_first_generated_test_as_the_example() -> None:
    plain = "Read n and print its double."

    proposals = json.dumps(["4\n", "5\n", "6\n"])

    built = build_tests(plain, "ref", FakeRunner(doubler), Proposes(proposals))

    assert [t.visible for t in built.tests] == [True, False, False]
    assert built.tests[0].source == "generated"


def test_a_fix_the_bugs_question_starts_from_the_broken_program() -> None:
    from app.practicals.tests_builder import starter_code, starter_for

    broken = "The program below is wrong.\n\n```java\nclass Main { int bug; }\n```\n\nFix it."
    sample_only = "```java\nclass Main {}\n```\n\nSee the sample."

    assert starter_for(broken) == "class Main { int bug; }\n"
    assert starter_for("Read n and print it.") == starter_code()
    assert starter_for(sample_only) == starter_code()


def test_the_samples_in_a_statement_are_found() -> None:
    statement = (
        "Read n.\n\nSample input:\n\n```text\n4\n-3 8 5 2\n```\n\n"
        "Sample output:\n\n```text\nMin: -3\nMax: 8\n```\n"
    )

    assert parse_samples(statement) == [("4\n-3 8 5 2\n", "Min: -3\nMax: 8")]


# ------------------------------------------------------------------------ building tests
STATEMENT = "Double it.\n\nSample input:\n\n```text\n2\n```\n\nSample output:\n\n```text\n4\n```\n"


def doubler(stdin: str) -> str:
    n = int(stdin.strip())
    return f"{n * 2}\n"


class Proposes:
    name, model = "fake", "fake"

    def __init__(self, reply: str | Exception) -> None:
        self.reply = reply

    def generate(
        self, *, system: str, prompt: str, max_tokens: int = 700, temperature: float = 0.3
    ):
        if isinstance(self.reply, Exception):
            raise self.reply
        return Generation(self.reply, "fake", "fake", 1)


def test_hidden_tests_take_their_expected_output_from_the_reference_solution() -> None:
    proposals = json.dumps(["0\n", "-5\n", "100"])

    built = build_tests(STATEMENT, "ref", FakeRunner(doubler), Proposes(proposals))

    assert built.notes == []
    visible = [t for t in built.tests if t.visible]
    hidden = [t for t in built.tests if not t.visible]
    assert [(t.stdin, t.expected) for t in visible] == [("2\n", "4")]
    assert [(t.stdin, t.expected) for t in hidden] == [
        ("0\n", "0"),
        ("-5\n", "-10"),
        ("100\n", "200"),
    ]
    assert {t.source for t in hidden} == {"generated"}


def test_an_input_the_reference_solution_cannot_handle_is_dropped() -> None:
    def picky(stdin: str) -> str:
        if "x" in stdin:
            raise ValueError
        return doubler(stdin)

    class Crashy(FakeRunner):
        def run_batch(self, source, stdins):
            from app.practicals.runner import Batch, RunResult

            runs = []
            for s in stdins:
                try:
                    runs.append(RunResult("ok", picky(s), "", 0, 1))
                except ValueError:
                    runs.append(RunResult("runtime_error", "", "boom", 1, 1))
            return Batch(True, "", tuple(runs))

    built = build_tests(STATEMENT, "ref", Crashy(), Proposes(json.dumps(["x\n", "7\n"])))

    assert [t.stdin for t in built.tests if not t.visible] == ["7\n"]


def test_proposals_that_repeat_the_sample_or_each_other_are_not_kept_twice() -> None:
    built = build_tests(
        STATEMENT, "ref", FakeRunner(doubler), Proposes(json.dumps(["2\n", "3\n", "3"]))
    )

    assert [t.stdin for t in built.tests] == ["2\n", "3\n"]


def test_no_more_than_the_limit_of_hidden_tests_is_kept() -> None:
    many = json.dumps([f"{n}\n" for n in range(20)])

    built = build_tests(STATEMENT, "ref", FakeRunner(doubler), Proposes(many), max_hidden=4)

    assert sum(not t.visible for t in built.tests) == 4


def test_a_reference_solution_that_disagrees_with_the_statement_is_reported() -> None:
    built = build_tests(STATEMENT, "ref", FakeRunner(lambda s: "5\n"), None)

    assert any("does not print the output shown" in note for note in built.notes)


def test_a_reference_solution_that_does_not_compile_makes_no_tests() -> None:
    built = build_tests(STATEMENT, "COMPILE_ERROR", FakeRunner(doubler), None)

    assert not built.usable and "does not compile" in built.notes[0]


def test_without_a_model_the_sample_is_still_a_test() -> None:
    built = build_tests(STATEMENT, "ref", FakeRunner(doubler), None)

    assert [t.visible for t in built.tests] == [True]


@pytest.mark.parametrize("reply", ["not json", LLMError("down"), '{"a": 1}'])
def test_a_model_that_fails_leaves_the_samples_and_says_so(reply) -> None:
    built = build_tests(STATEMENT, "ref", FakeRunner(doubler), Proposes(reply))

    assert [t.visible for t in built.tests] == [True]
    assert any("samples only" in note for note in built.notes)


# ------------------------------------------------------------------------------ the service
def make(course, *, ready: bool = True, runner=None, locked: set[str] | None = None):
    repo = InMemoryPracticalRepository()
    game = InMemorySessionRepository()
    game.clock = lambda: __import__("datetime").datetime.now(__import__("datetime").UTC)
    entries = code_entries(course)
    if ready:
        for entry in entries:
            repo.replace_tests(
                entry.question.question_id,
                [
                    TestCase("2\n", "2\n", True, "sample"),
                    TestCase("3\n", "3\n", False, "generated"),
                    TestCase("9\n", "9\n", False, "generated"),
                ],
            )
    open_concepts = {e.question.concept_id for e in entries} - (locked or set())
    service = PracticalService(
        repo,
        game,
        course,
        FakeRunner(lambda stdin: stdin) if runner is None else runner,
        unlocked=lambda user: open_concepts,
    )
    return service, repo, game, entries


def a_level(entries, level):
    return next(e for e in entries if e.question.level == level)


def test_the_list_has_every_practical_with_its_standing(course) -> None:
    service, _, _, entries = make(course)
    first = entries[0]

    items = service.listing(STUDENT).practicals

    assert len(items) == 39 and all(i.ready and i.unlocked and not i.passed for i in items)
    assert {i.practical_id for i in items} >= {practical_id(first.question.question_id)}
    assert [i.concept_id for i in items] == sorted(
        (i.concept_id for i in items), key=course.order.index
    )


def test_a_practical_with_no_tests_is_listed_but_not_ready(course) -> None:
    service, _, _, _ = make(course, ready=False)

    assert not any(i.ready for i in service.listing(STUDENT).practicals)


def test_the_detail_shows_the_statement_and_only_the_visible_tests(course) -> None:
    service, _, _, entries = make(course)
    entry = entries[0]

    detail = service.detail(STUDENT, practical_id(entry.question.question_id))

    assert detail.statement == entry.question.stem
    assert [t.stdin for t in detail.visible_tests] == ["2\n"]
    assert detail.tests_total == 3
    assert "public class Main" in detail.starter_code
    assert entry.key.reference_solution not in detail.model_dump_json()


def test_unknown_and_non_program_questions_are_not_practicals(course) -> None:
    service, _, _, _ = make(course)
    mcq = next(q for q, e in course.bank.items() if e.question.kind == "mcq")

    for bad in ("prog.nothing~exercise-q1", practical_id(mcq)):
        with pytest.raises(SessionProblem) as caught:
            service.detail(STUDENT, bad)
        assert caught.value.code == "practical_not_found"


def test_a_locked_concept_cannot_be_opened_run_or_submitted(course) -> None:
    probe, _, _, entries = make(course)
    entry = entries[0]
    service, *_ = make(course, locked={entry.question.concept_id})
    pid = practical_id(entry.question.question_id)

    for call in (
        lambda: service.detail(STUDENT, pid),
        lambda: service.run(STUDENT, pid, "x", ""),
        lambda: service.submit(STUDENT, pid, "x"),
    ):
        with pytest.raises(SessionProblem) as caught:
            call()
        assert caught.value.code == "concept_locked"
    listed = next(i for i in service.listing(STUDENT).practicals if i.practical_id == pid)
    assert listed.unlocked is False


def test_run_shows_what_the_program_printed_and_scores_nothing(course) -> None:
    service, repo, game, entries = make(course)
    pid = practical_id(entries[0].question.question_id)

    out = service.run(STUDENT, pid, "source", "hello\n")

    assert out.compiled and out.status == "ok" and out.stdout == "hello\n"
    assert repo.attempts == [] and game.total_xp(STUDENT) == 0


def test_run_reports_a_compile_error(course) -> None:
    service, _, _, entries = make(course)

    out = service.run(STUDENT, practical_id(entries[0].question.question_id), "COMPILE_ERROR", "")

    assert not out.compiled and out.status == "not_compiled" and "expected" in out.compile_output


# ---- marking
def test_passing_every_test_passes_the_practical_and_pays_the_bonus_once(course) -> None:
    service, repo, game, entries = make(course)
    entry = a_level(entries, 4)
    pid = practical_id(entry.question.question_id)

    first = service.submit(STUDENT, pid, "source")

    assert first.passed and (first.tests_passed, first.tests_total) == (3, 3)
    assert first.rewards.xp_gained == BONUSES.practical
    assert [b.kind for b in first.rewards.bonuses] == ["practical"]
    assert "first_build" in [b.id for b in first.rewards.badges]
    assert game.total_xp(STUDENT) == BONUSES.practical

    again = service.submit(STUDENT, pid, "source")

    assert again.passed and again.rewards is None, "the bonus is for the first pass only"
    assert game.total_xp(STUDENT) == BONUSES.practical
    assert len(repo.attempts) == 2


def test_a_level_five_practical_pays_more(course) -> None:
    service, _, game, entries = make(course)

    result = service.submit(
        STUDENT, practical_id(a_level(entries, 5).question.question_id), "source"
    )

    assert result.rewards.xp_gained == BONUSES.practical_hard == 250
    assert game.total_xp(STUDENT) == 250


def test_the_first_build_badge_is_earned_once(course) -> None:
    service, _, game, entries = make(course)

    one = service.submit(STUDENT, practical_id(entries[0].question.question_id), "source")
    two = service.submit(STUDENT, practical_id(entries[1].question.question_id), "source")

    assert "first_build" in [b.id for b in one.rewards.badges]
    assert "first_build" not in [b.id for b in two.rewards.badges]
    assert set(game.badges(STUDENT)) >= {"first_build"}


def test_a_failing_program_gets_no_reward_and_hidden_tests_reveal_nothing(course) -> None:
    service, repo, game, entries = make(course, runner=FakeRunner(lambda stdin: "wrong\n"))
    pid = practical_id(entries[0].question.question_id)

    result = service.submit(STUDENT, pid, "source")

    assert not result.passed and result.rewards is None
    assert (result.tests_passed, result.tests_total) == (0, 3)
    visible, *hidden = result.results
    assert visible.stdin == "2\n" and visible.expected == "2\n" and visible.actual == "wrong\n"
    for test in hidden:
        assert (test.stdin, test.expected, test.actual) == (None, None, None)
    assert game.total_xp(STUDENT) == 0
    assert repo.standings(STUDENT)[entries[0].question.question_id].best_passed == 0


def test_a_program_that_passes_some_tests_is_not_a_pass(course) -> None:
    service, _, _, entries = make(course, runner=FakeRunner(lambda s: s if "9" not in s else "no"))

    result = service.submit(STUDENT, practical_id(entries[0].question.question_id), "source")

    assert not result.passed and (result.tests_passed, result.tests_total) == (2, 3)
    assert [r.passed for r in result.results] == [True, True, False]


def test_a_compile_error_is_recorded_and_runs_no_test(course) -> None:
    service, repo, _, entries = make(course)

    result = service.submit(STUDENT, practical_id(entries[0].question.question_id), "COMPILE_ERROR")

    assert not result.compiled and not result.passed and result.results == []
    assert repo.attempts[-1][3:] == (False, False, 0, 3)


@pytest.mark.parametrize(("marker", "status"), [("CRASH", "runtime_error"), ("LOOP", "timeout")])
def test_a_crash_or_a_timeout_fails_the_test_and_says_why(course, marker, status) -> None:
    service, _, _, entries = make(course)

    result = service.submit(STUDENT, practical_id(entries[0].question.question_id), marker)

    assert not result.passed and {r.status for r in result.results} == {status}


def test_a_practical_without_tests_cannot_be_submitted(course) -> None:
    service, _, _, entries = make(course, ready=False)

    with pytest.raises(SessionProblem) as caught:
        service.submit(STUDENT, practical_id(entries[0].question.question_id), "source")

    assert caught.value.code == "practical_not_ready"


def test_with_the_runner_switched_off_nothing_can_run(course) -> None:
    repo = InMemoryPracticalRepository()
    service = PracticalService(repo, InMemorySessionRepository(), course, None)
    pid = practical_id(code_entries(course)[0].question.question_id)

    with pytest.raises(SessionProblem) as caught:
        service.run(STUDENT, pid, "x", "")

    assert caught.value.kind == "unavailable" and caught.value.code == "runner_unavailable"


def test_the_standing_and_last_code_come_back_on_the_next_visit(course) -> None:
    service, _, _, entries = make(course, runner=FakeRunner(lambda s: "no\n"))
    pid = practical_id(entries[0].question.question_id)
    service.submit(STUDENT, pid, "my first attempt")

    detail = service.detail(STUDENT, pid)
    listed = next(i for i in service.listing(STUDENT).practicals if i.practical_id == pid)

    assert detail.last_source == "my first attempt" and not detail.passed
    assert listed.best == "0 of 3" and not listed.passed


def test_a_practical_passed_by_one_student_is_not_passed_for_another(course) -> None:
    service, _, _, entries = make(course)
    pid = practical_id(entries[0].question.question_id)
    service.submit(STUDENT, pid, "source")

    other = str(uuid.uuid4())

    assert service.detail(other, pid).passed is False
    assert service.submit(other, pid, "source").rewards is not None
