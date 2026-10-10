"""The rules of a guided session, one behaviour per test."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.sessions.state_machine import (
    CHECKPOINT,
    HOOK,
    TEACH,
    Answer,
    AskAgain,
    AskCheckpoint,
    Continue,
    End,
    EndedByStudent,
    ExitReason,
    HighLoad,
    InvalidTransition,
    MasteryReached,
    Phase,
    Reteach,
    Rules,
    SessionState,
    ShowFeedback,
    ShowHook,
    ShowTeach,
    Step,
    Tick,
    can_resume,
    resume,
    start,
    step,
)

T0 = datetime(2026, 10, 10, 9, 0, tzinfo=UTC)


def minutes(n: float) -> datetime:
    return T0 + timedelta(minutes=n)


PLAN = (
    Step(HOOK, "hook"),
    Step(TEACH, "teach-1"),
    Step(CHECKPOINT, "pulse-1", gating=False),
    Step(TEACH, "teach-2"),
    Step(CHECKPOINT, "gate-1", gating=True),
    Step(CHECKPOINT, "gate-2", gating=True),
)


def begin(steps=PLAN, rules: Rules | None = None) -> SessionState:
    return start(
        session_id="s1", user_id="u1", concept_id="prog.loops", steps=steps, now=T0, rules=rules
    ).state


def run(state: SessionState, *events, at: float = 1.0):
    """Feed events in order, one minute apart, and return the final transition."""
    transition = None
    for n, event in enumerate(events):
        transition = step(state, event, minutes(at + n))
        state = transition.state
    return transition


def to_first_gate() -> SessionState:
    """Hook, teach, pulse (right), teach, then standing at the first gating checkpoint."""
    return run(begin(), Continue(), Continue(), Answer("correct"), Continue(), Continue()).state


# ------------------------------------------------------------------------ starting
def test_a_session_opens_on_its_hook() -> None:
    opened = start(session_id="s", user_id="u", concept_id="c", steps=PLAN, now=T0)

    assert opened.state.phase is Phase.HOOK
    assert opened.directives == (ShowHook("hook"),)


def test_a_session_with_no_steps_is_refused() -> None:
    with pytest.raises(ValueError):
        start(session_id="s", user_id="u", concept_id="c", steps=(), now=T0)


# ----------------------------------------------------------------- the happy path
def test_a_full_run_ends_completed() -> None:
    final = run(
        begin(),
        Continue(),  # hook
        Continue(),  # teach 1
        Answer("correct"),  # pulse
        Continue(),  # pulse feedback
        Continue(),  # teach 2
        Answer("correct"),  # gate 1
        Continue(),
        Answer("correct"),  # gate 2
        Continue(),
    )

    assert final.state.exit is ExitReason.COMPLETED
    assert final.directives == (End(ExitReason.COMPLETED),)
    assert final.state.passed_gating == ("gate-1", "gate-2")


def test_each_step_presents_the_right_thing() -> None:
    state = begin()
    seen = []
    for event in (Continue(), Continue(), Answer("correct"), Continue(), Continue()):
        transition = step(state, event, minutes(1))
        state = transition.state
        seen.extend(transition.directives)

    assert ShowTeach("teach-1") in seen
    assert AskCheckpoint("pulse-1", gating=False, attempt=1, hint=False) in seen
    assert AskCheckpoint("gate-1", gating=True, attempt=1, hint=False) in seen


# ----------------------------------------------------------------- pulse checks
def test_a_wrong_pulse_check_never_blocks_the_session() -> None:
    state = run(begin(), Continue(), Continue(), Answer("wrong")).state

    assert state.phase is Phase.FEEDBACK
    after = step(state, Continue(), minutes(9))
    assert after.state.current.ref == "teach-2"  # moved on, no retry


def test_a_pulse_check_never_counts_as_gating_progress() -> None:
    state = run(begin(), Continue(), Continue(), Answer("correct")).state

    assert "pulse-1" in state.passed
    assert "pulse-1" not in state.passed_gating
    assert state.gating_done == 0


# -------------------------------------------------------- misses on a gating check
def test_the_first_miss_gives_a_hint_and_another_try() -> None:
    gate = to_first_gate()
    missed = step(gate, Answer("wrong"), minutes(20))

    assert missed.state.phase is Phase.FEEDBACK
    assert missed.state.attempts == 1
    assert missed.directives == (ShowFeedback("gate-1", "wrong", 1, True),)

    retry = step(missed.state, Continue(), minutes(21))
    assert retry.state.phase is Phase.CHECKPOINT
    assert retry.directives == (AskCheckpoint("gate-1", gating=True, attempt=2, hint=True),)


def test_the_second_miss_re_teaches_before_the_next_try() -> None:
    gate = to_first_gate()
    first = step(gate, Answer("wrong"), minutes(20)).state
    retry = step(first, Continue(), minutes(21)).state
    second = step(retry, Answer("wrong"), minutes(22))

    assert second.state.phase is Phase.RETEACH
    assert Reteach("gate-1") in second.directives

    again = step(second.state, Continue(), minutes(23))
    assert again.state.phase is Phase.CHECKPOINT
    assert again.directives[0].attempt == 3


def test_the_third_miss_ends_the_session_as_struggling() -> None:
    final = run(
        to_first_gate(),
        Answer("wrong"),
        Continue(),
        Answer("wrong"),
        Continue(),  # re-teach
        Answer("wrong"),
        at=20,
    )

    assert final.state.exit is ExitReason.STRUGGLING
    assert final.directives == (End(ExitReason.STRUGGLING),)


def test_passing_after_a_miss_still_advances() -> None:
    final = run(to_first_gate(), Answer("wrong"), Continue(), Answer("correct"), Continue(), at=20)

    assert final.state.current.ref == "gate-2"
    assert final.state.attempts == 0, "attempts reset for the next checkpoint"
    assert "gate-1" in final.state.passed_gating


def test_an_unreadable_answer_uses_no_attempt() -> None:
    gate = to_first_gate()
    for _ in range(5):
        gate = step(gate, Answer("unreadable"), minutes(20)).state

    assert gate.attempts == 0 and gate.phase is Phase.CHECKPOINT
    assert step(gate, Answer("unreadable"), minutes(21)).directives == (AskAgain("gate-1"),)


def test_attempts_are_counted_per_checkpoint_not_per_session() -> None:
    after_first_gate = run(
        to_first_gate(), Answer("wrong"), Continue(), Answer("correct"), Continue(), at=20
    ).state
    miss = step(after_first_gate, Answer("wrong"), minutes(30))

    assert miss.state.attempts == 1, "gate-2 starts fresh; gate-1's miss does not carry over"


# ------------------------------------------------------------------------ exits
def test_the_student_can_end_at_any_time() -> None:
    for state in (begin(), to_first_gate()):
        ended = step(state, EndedByStudent(), minutes(30))
        assert ended.state.exit is ExitReason.STUDENT_ENDED


def test_sustained_high_load_ends_the_session() -> None:
    ended = step(to_first_gate(), HighLoad(), minutes(30))

    assert ended.state.exit is ExitReason.LOAD_EXIT and ended.state.phase is Phase.ENDED


def test_silence_beyond_the_timeout_ends_the_session() -> None:
    state = begin(rules=Rules(timeout=timedelta(minutes=30)))

    assert step(state, Tick(), minutes(29)).state.exit is None
    assert step(state, Tick(), minutes(31)).state.exit is ExitReason.TIMEOUT


def test_activity_resets_the_silence_clock() -> None:
    state = step(begin(), Continue(), minutes(25)).state

    assert step(state, Tick(), minutes(50)).state.exit is None  # 25 min since last activity


def test_an_idle_tick_is_not_activity() -> None:
    state = begin()
    ticked = step(state, Tick(), minutes(10)).state

    assert ticked.last_activity_at == state.last_activity_at


def test_mastery_ends_the_session_early_once_something_was_demonstrated() -> None:
    state = run(to_first_gate(), Answer("correct"), Continue(), at=20).state  # gate-1 passed
    mastered = step(state, MasteryReached(), minutes(25))

    assert mastered.state.exit is ExitReason.MASTERY_SATISFIED


def test_mastery_before_any_gating_checkpoint_does_not_skip_the_session() -> None:
    assert step(to_first_gate(), MasteryReached(), minutes(25)).state.exit is None


def test_mastery_with_nothing_left_to_skip_changes_nothing() -> None:
    state = run(to_first_gate(), Answer("correct"), Continue(), Answer("correct"), at=20).state

    assert step(state, MasteryReached(), minutes(30)).state.exit is None


def test_an_ended_session_accepts_nothing_more() -> None:
    ended = step(begin(), EndedByStudent(), minutes(5)).state

    with pytest.raises(InvalidTransition, match="already ended"):
        step(ended, Continue(), minutes(6))


def test_every_exit_is_one_of_the_six_typed_reasons() -> None:
    assert {r.value for r in ExitReason} == {
        "completed",
        "mastery_satisfied",
        "struggling",
        "load_exit",
        "student_ended",
        "timeout",
    }


# ------------------------------------------------------------- phase discipline
def test_an_answer_with_no_question_open_is_refused() -> None:
    with pytest.raises(InvalidTransition, match="no question is open"):
        step(begin(), Answer("correct"), minutes(1))


def test_continuing_from_an_open_question_is_refused() -> None:
    with pytest.raises(InvalidTransition, match="nothing to continue"):
        step(to_first_gate(), Continue(), minutes(20))


def test_an_unknown_outcome_is_refused() -> None:
    with pytest.raises(InvalidTransition, match="unknown outcome"):
        step(to_first_gate(), Answer("maybe"), minutes(20))


def test_states_are_immutable_so_a_transition_cannot_corrupt_the_old_one() -> None:
    before = begin()
    step(before, Continue(), minutes(1))

    assert before.index == 0 and before.phase is Phase.HOOK


# ----------------------------------------------------------------------- resume
def stopped_after_gate_1(reason=EndedByStudent) -> SessionState:
    state = run(to_first_gate(), Answer("correct"), Continue(), at=20).state  # now at gate-2
    return step(state, reason(), minutes(30)).state


@pytest.mark.parametrize("reason", [EndedByStudent, HighLoad])
def test_a_resumable_exit_resumes_just_after_the_last_checkpoint_passed(reason) -> None:
    stopped = stopped_after_gate_1(reason)

    assert can_resume(stopped, minutes(60))
    resumed = resume(stopped, minutes(60))
    assert resumed.state.current.ref == "gate-2"
    assert resumed.state.exit is None and resumed.state.phase is Phase.CHECKPOINT
    assert resumed.state.passed_gating == ("gate-1",), "earlier progress is kept"


def test_a_timeout_is_resumable_too() -> None:
    state = begin()
    stopped = step(state, Tick(), minutes(45)).state

    assert stopped.exit is ExitReason.TIMEOUT and can_resume(stopped, minutes(60))


def test_resuming_restarts_the_attempts() -> None:
    state = run(to_first_gate(), Answer("wrong"), at=20).state
    stopped = step(state, EndedByStudent(), minutes(30)).state

    assert resume(stopped, minutes(31)).state.attempts == 0


def test_resuming_before_anything_was_passed_starts_from_the_top() -> None:
    stopped = step(begin(), EndedByStudent(), minutes(5)).state

    assert resume(stopped, minutes(6)).state.current.ref == "hook"


@pytest.mark.parametrize(
    "terminal",
    [ExitReason.COMPLETED, ExitReason.STRUGGLING, ExitReason.MASTERY_SATISFIED],
)
def test_finished_sessions_cannot_be_resumed(terminal) -> None:
    state = begin()
    from dataclasses import replace

    over = replace(state, phase=Phase.ENDED, exit=terminal, ended_at=minutes(5))

    assert not can_resume(over, minutes(6))
    with pytest.raises(InvalidTransition, match="cannot resume"):
        resume(over, minutes(6))


def test_the_resume_window_closes() -> None:
    stopped = stopped_after_gate_1()

    assert can_resume(stopped, minutes(30) + timedelta(hours=47))
    assert not can_resume(stopped, minutes(30) + timedelta(hours=49))


def test_a_running_session_cannot_be_resumed() -> None:
    with pytest.raises(InvalidTransition, match="still running"):
        resume(begin(), minutes(1))


def test_the_resume_window_is_configurable() -> None:
    rules = Rules(resume_window=timedelta(hours=24))
    state = run(to_first_gate(), Answer("correct"), at=20).state
    stopped = step(state, EndedByStudent(), minutes(30)).state
    from dataclasses import replace

    stopped = replace(stopped, rules=rules)

    assert not can_resume(stopped, minutes(30) + timedelta(hours=30))
