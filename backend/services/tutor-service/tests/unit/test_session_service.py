"""The session service, run on the real course content with an in-memory repository.

These check what a student would notice: the flow of a session, that an answer is never
given away early, that a student has one session at a time, that locked concepts stay
locked, and that silence ends a session without losing it.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.gamification.rules import Policy
from app.models.sessions import SessionOut
from app.sessions.catalog import UnknownModule, load_course
from app.sessions.repository import AttemptRecord
from app.sessions.service import SessionProblem, SessionService, results_from_attempts
from tests.unit.session_support import Clock, InMemorySessionRepository

CONTENT = Path(__file__).resolve().parents[2] / "content"
STUDENT = str(uuid.uuid4())
OTHER = str(uuid.uuid4())
LOOPS = "prog.loops"


@pytest.fixture(scope="module")
def course():
    return load_course(CONTENT, "prog")


def make(course, *, enforce: bool = False, policy: Policy = Policy.MASTERY_GATED):
    clock = Clock()
    repo = InMemorySessionRepository()

    def courses(module_id: str):
        if module_id != "prog":
            raise UnknownModule(module_id)
        return course

    service = SessionService(repo, courses, clock=clock, enforce_unlocks=enforce, policy=policy)
    return service, repo, clock


def right_answer(course, view: SessionOut) -> str:
    entry = course.bank[view.question.question_id]
    _, key = SessionService._presented(view.session_id, entry)
    return key.correct_option or key.expected_output or ""


def play(service, course, user: str, view: SessionOut, *, misses: int = 0) -> SessionOut:
    """Walk a session to its end. `misses` wrong tries on each gating question first."""
    while view.phase != "ended":
        if view.phase == "checkpoint":
            q = view.question
            if q.gating and q.attempt <= misses:
                view = service.answer(user, view.session_id, "definitely not it")
            else:
                view = service.answer(user, view.session_id, right_answer(course, view))
        else:
            view = service.cont(user, view.session_id)
    return view


# ---------------------------------------------------------------------- the flow
def test_a_perfect_session_completes_with_full_xp(course) -> None:
    service, _, _ = make(course)
    view = service.start(STUDENT, LOOPS)

    assert view.phase == "hook" and view.text

    ended = play(service, course, STUDENT, view)

    assert ended.summary.exit_reason == "completed"
    assert ended.summary.xp_earned == 2 * 10 + 2 * 120
    assert ended.summary.mastery == 1.0
    assert (ended.summary.gating_done, ended.summary.gating_total) == (2, 2)


def test_one_miss_gives_a_hint_on_the_retry_and_costs_xp(course) -> None:
    service, _, _ = make(course)
    perfect = play(service, course, STUDENT, service.start(STUDENT, LOOPS))
    service2, _, _ = make(course)
    view = service2.start(STUDENT, LOOPS)

    # up to the first gating question
    while not (view.phase == "checkpoint" and view.question.gating):
        view = (
            service2.answer(STUDENT, view.session_id, right_answer(course, view))
            if view.phase == "checkpoint"
            else service2.cont(STUDENT, view.session_id)
        )
    assert view.question.hint is None

    missed = service2.answer(STUDENT, view.session_id, "definitely not it")
    assert missed.phase == "feedback"
    assert missed.feedback.outcome == "wrong" and missed.feedback.tries_left == 2

    retry = service2.cont(STUDENT, view.session_id)
    assert retry.phase == "checkpoint"
    assert retry.question.attempt == 2 and retry.question.hint

    ended = play(service2, course, STUDENT, retry)
    assert ended.summary.exit_reason == "completed"
    assert ended.summary.xp_earned < perfect.summary.xp_earned


def test_two_misses_reteach_and_three_end_the_session_as_struggling(course) -> None:
    service, _, _ = make(course)
    ended = play(service, course, STUDENT, service.start(STUDENT, LOOPS), misses=3)

    assert ended.summary.exit_reason == "struggling"
    assert ended.summary.gating_done == 0
    assert ended.summary.can_resume is False

    service, _, _ = make(course)
    view = service.start(STUDENT, LOOPS)
    seen = set()
    while view.phase != "ended":
        seen.add(view.phase)
        if view.phase == "checkpoint":
            tries = view.question.attempt
            wrong = view.question.gating and tries <= 2
            view = service.answer(
                STUDENT,
                view.session_id,
                "definitely not it" if wrong else right_answer(course, view),
            )
        else:
            view = service.cont(STUDENT, view.session_id)
    assert "reteach" in seen


def test_an_unreadable_answer_is_asked_for_again_and_uses_no_try(course) -> None:
    service, _, _ = make(course)
    view = service.start(STUDENT, LOOPS)
    while not (view.phase == "checkpoint" and view.question.options):
        view = service.cont(STUDENT, view.session_id)

    again = service.answer(STUDENT, view.session_id, "E")

    assert again.phase == "checkpoint"
    assert again.feedback.outcome == "unreadable"
    assert again.question.attempt == 1
    assert again.xp_earned == 0


# --------------------------------------------------------------- nothing leaks
def test_the_answer_never_reaches_the_student_before_they_answer(course) -> None:
    service, _, _ = make(course)
    view = service.start(STUDENT, LOOPS)
    while view.phase != "ended":
        if view.phase == "checkpoint":
            q = view.question
            entry = course.bank[q.question_id]
            blob = view.model_dump_json()
            if entry.key.explanation:
                assert entry.key.explanation[:60] not in blob
            if entry.key.expected_output:
                # A short output like "26" is a substring of anything, so compare whole lines.
                shown = [*q.stem.splitlines(), *(o.text for o in q.options)]
                assert entry.key.expected_output not in [line.strip() for line in shown]
            assert view.feedback is None
            view = service.answer(STUDENT, view.session_id, right_answer(course, view))
        else:
            view = service.cont(STUDENT, view.session_id)


def test_a_wrong_gating_answer_does_not_explain_but_a_wrong_pulse_does(course) -> None:
    service, _, _ = make(course)
    view = service.start(STUDENT, LOOPS)
    while view.phase != "checkpoint":
        view = service.cont(STUDENT, view.session_id)
    assert not view.question.gating

    pulse = service.answer(STUDENT, view.session_id, _wrong_option(course, view))
    assert pulse.feedback.outcome == "wrong"
    assert pulse.feedback.correct_option
    view = pulse

    while not (view.phase == "checkpoint" and view.question.gating):
        view = (
            service.answer(STUDENT, view.session_id, right_answer(course, view))
            if view.phase == "checkpoint"
            else service.cont(STUDENT, view.session_id)
        )
    gate = service.answer(STUDENT, view.session_id, "definitely not it")
    assert gate.feedback.explanation is None and gate.feedback.correct_option is None


def _wrong_option(course, view: SessionOut) -> str:
    right = right_answer(course, view)
    return next(o.letter for o in view.question.options if o.letter != right)


def test_the_same_options_are_shown_every_time_a_question_is_rebuilt(course) -> None:
    service, _, _ = make(course)
    view = service.start(STUDENT, LOOPS)
    while view.phase != "checkpoint":
        view = service.cont(STUDENT, view.session_id)

    again = service.view(STUDENT, view.session_id)

    assert again.question == view.question


# ------------------------------------------------------- one session at a time
def test_starting_the_same_concept_twice_returns_the_session_in_progress(course) -> None:
    service, repo, _ = make(course)
    first = service.start(STUDENT, LOOPS)
    service.cont(STUDENT, first.session_id)

    second = service.start(STUDENT, LOOPS)

    assert second.session_id == first.session_id
    assert second.position.step_number == 2
    assert len(repo.sessions) == 1


def test_starting_another_concept_puts_the_first_down_resumably(course) -> None:
    service, repo, _ = make(course)
    first = service.start(STUDENT, LOOPS)
    other = next(c for c in course.order if c != LOOPS)

    second = service.start(STUDENT, other)

    assert second.session_id != first.session_id
    old = repo.sessions[first.session_id].state
    assert old.is_over and old.exit.value == "student_ended"
    assert service.view(STUDENT, first.session_id).summary.can_resume is True


def test_another_student_cannot_see_or_act_on_a_session(course) -> None:
    service, _, _ = make(course)
    view = service.start(STUDENT, LOOPS)

    for call in (
        lambda: service.view(OTHER, view.session_id),
        lambda: service.cont(OTHER, view.session_id),
        lambda: service.answer(OTHER, view.session_id, "A"),
        lambda: service.end(OTHER, view.session_id),
    ):
        with pytest.raises(SessionProblem) as caught:
            call()
        assert caught.value.code == "session_not_found"


def test_unknown_ids_are_not_found(course) -> None:
    service, _, _ = make(course)

    with pytest.raises(SessionProblem) as caught:
        service.start(STUDENT, "prog.nonsense")
    assert caught.value.code == "concept_not_found"
    with pytest.raises(SessionProblem) as caught:
        service.start(STUDENT, "dsa.arrays")
    assert caught.value.code == "concept_not_found"
    with pytest.raises(SessionProblem) as caught:
        service.view(STUDENT, "not-a-uuid")
    assert caught.value.code == "session_not_found"


def test_actions_on_an_ended_session_are_refused_except_ending_again(course) -> None:
    service, _, _ = make(course)
    view = service.start(STUDENT, LOOPS)
    service.end(STUDENT, view.session_id)

    assert service.end(STUDENT, view.session_id).phase == "ended"
    for call in (
        lambda: service.cont(STUDENT, view.session_id),
        lambda: service.answer(STUDENT, view.session_id, "A"),
    ):
        with pytest.raises(SessionProblem) as caught:
            call()
        assert caught.value.code == "session_ended"


def test_answering_when_no_question_is_open_is_refused(course) -> None:
    service, _, _ = make(course)
    view = service.start(STUDENT, LOOPS)

    with pytest.raises(SessionProblem) as caught:
        service.answer(STUDENT, view.session_id, "A")

    assert caught.value.code == "not_awaiting_answer"


# --------------------------------------------------------------------- unlocking
def test_a_concept_with_unmastered_prerequisites_is_locked_and_says_why(course) -> None:
    service, _, _ = make(course, enforce=True)
    assert course.prerequisites[LOOPS], "this test needs a concept that has prerequisites"

    with pytest.raises(SessionProblem) as caught:
        service.start(STUDENT, LOOPS)

    assert caught.value.kind == "forbidden" and caught.value.code == "concept_locked"
    unmet = caught.value.details["unmet"]
    assert {u["concept_id"] for u in unmet} == set(course.prerequisites[LOOPS])
    assert all(u["current"] is None and u["required"] == 0.7 for u in unmet)


def test_mastering_a_concept_opens_what_depends_on_it(course) -> None:
    service, _, _ = make(course, enforce=True)
    root = course.order[0]
    assert not course.prerequisites[root]

    before = {c.concept_id: c.unlocked for c in service.progress(STUDENT, "prog").concepts}
    assert before[root] is True
    dependants = [c for c, ps in course.prerequisites.items() if ps == (root,)]
    assert dependants and not any(before[d] for d in dependants)

    play(service, course, STUDENT, service.start(STUDENT, root))

    after = service.progress(STUDENT, "prog")
    status = {c.concept_id: c for c in after.concepts}
    assert status[root].mastery == 1.0
    assert all(status[d].unlocked for d in dependants)
    assert after.total_xp > 0
    assert after.next_concept_id != root


def test_points_only_opens_concepts_by_xp_not_mastery(course) -> None:
    service, _, _ = make(course, enforce=True, policy=Policy.POINTS_ONLY)
    root = course.order[0]
    dependant = next(c for c, ps in course.prerequisites.items() if ps == (root,))

    with pytest.raises(SessionProblem):
        service.start(STUDENT, dependant)

    # Earn XP on the root. Nothing about mastery matters now, only the points.
    play(service, course, STUDENT, service.start(STUDENT, root))

    assert service.start(STUDENT, dependant).concept_id == dependant


def test_unknown_module_progress_is_not_found(course) -> None:
    service, _, _ = make(course)

    with pytest.raises(SessionProblem) as caught:
        service.progress(STUDENT, "dsa")

    assert caught.value.code == "module_not_found"


# -------------------------------------------------------------- silence and resume
def test_silence_ends_the_session_as_a_timeout_and_it_can_be_resumed(course) -> None:
    service, _, clock = make(course)
    view = service.start(STUDENT, LOOPS)
    clock.advance(minutes=31)

    gone = service.view(STUDENT, view.session_id)
    assert gone.phase == "ended" and gone.summary.exit_reason == "timeout"
    assert gone.summary.can_resume is True

    back = service.resume(STUDENT, view.session_id)
    assert back.phase != "ended"


def test_resume_picks_up_just_after_the_last_checkpoint_passed(course) -> None:
    service, _, _ = make(course)
    view = service.start(STUDENT, LOOPS)
    while view.phase != "checkpoint":
        view = service.cont(STUDENT, view.session_id)
    first_check = view.question.question_id
    after_check = service.answer(STUDENT, view.session_id, right_answer(course, view))
    service.end(STUDENT, view.session_id)

    back = service.resume(STUDENT, view.session_id)

    assert back.phase == "teach"
    assert back.position.step_number == after_check.position.step_number + 1
    assert first_check not in back.model_dump_json()


def test_resuming_while_another_session_is_active_puts_that_one_down(course) -> None:
    service, repo, _ = make(course)
    first = service.start(STUDENT, LOOPS)
    service.end(STUDENT, first.session_id)
    other = next(c for c in course.order if c != LOOPS)
    second = service.start(STUDENT, other)

    service.resume(STUDENT, first.session_id)

    assert repo.sessions[second.session_id].state.exit.value == "student_ended"
    assert not repo.sessions[first.session_id].state.is_over


def test_a_struggling_session_cannot_be_resumed(course) -> None:
    service, _, _ = make(course)
    ended = play(service, course, STUDENT, service.start(STUDENT, LOOPS), misses=3)

    with pytest.raises(SessionProblem) as caught:
        service.resume(STUDENT, ended.session_id)

    assert caught.value.code == "cannot_resume"


def test_a_second_session_brings_questions_the_student_has_not_met(course) -> None:
    service, repo, _ = make(course)
    first = play(service, course, STUDENT, service.start(STUDENT, LOOPS))
    met = {a.question_id for a in repo.attempts(first.session_id)}

    second = service.start(STUDENT, LOOPS)
    planned = {
        s.ref for s in repo.sessions[second.session_id].state.steps if s.kind == "checkpoint"
    }

    available = {
        q for q, e in course.bank.items() if e.question.concept_id == LOOPS and q not in met
    }
    assert planned & available, "the second session should include questions not yet seen"


# ------------------------------------------------------------ results from attempts
def attempt(question: str, outcome: str, no: int, minute: int, concept: str = "c") -> AttemptRecord:
    from datetime import UTC, datetime

    return AttemptRecord(
        session_id="s",
        question_id=question,
        concept_id=concept,
        kind="predict_output",
        gating=True,
        attempt_no=no,
        answer="x",
        outcome=outcome,
        reason="",
        xp=0,
        hints_used=0,
        created_at=datetime(2026, 1, 1, 9, minute, tzinfo=UTC),
    )


def test_results_are_one_per_question_with_the_try_that_passed() -> None:
    rows = [
        ("s", attempt("q1", "wrong", 1, 1)),
        ("s", attempt("q1", "correct", 2, 2)),
        ("s", attempt("q2", "correct", 1, 3)),
    ]

    results = results_from_attempts(rows, max_attempts=3)

    assert [(r.passed, r.attempts_used) for r in results["c"]] == [(True, 2), (True, 1)]


def test_a_question_failed_three_times_is_a_failure_and_one_abandoned_is_nothing() -> None:
    failed = [("s", attempt("q1", "wrong", n, n)) for n in (1, 2, 3)]
    abandoned = [("s", attempt("q2", "wrong", 1, 4))]

    results = results_from_attempts([*failed, *abandoned], max_attempts=3)

    assert [(r.passed, r.attempts_used) for r in results["c"]] == [(False, 3)]


def test_results_are_ordered_by_when_each_question_was_finished() -> None:
    rows = [
        ("s", attempt("q1", "wrong", 1, 1)),
        ("s", attempt("q2", "correct", 1, 2)),
        ("s", attempt("q1", "correct", 2, 3)),
    ]

    results = results_from_attempts(rows, max_attempts=3)

    assert [r.attempts_used for r in results["c"]] == [1, 2]
