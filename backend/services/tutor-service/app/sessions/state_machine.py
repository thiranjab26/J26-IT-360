"""The guided session, as a state machine. Pure logic: no database, no model, no clock.

A session teaches one concept as a plan of steps (hook, teach, checkpoint, ...). The
tutor leads: it presents a step, waits for the student to continue or answer, judges,
and branches. This module owns only the rules of that loop, so every one of them can be
tested without an LLM:

    A gating checkpoint (predict the output, explain, code) must be passed to finish.
    A pulse check (multiple choice) is a quick recall check. It never blocks anything
    and, by design, never counts towards finishing or towards mastery.

    First miss on a gating checkpoint    a hint, then another try
    Second miss                          the tutor re-teaches the part that went wrong
    Third miss                           the session ends as `struggling`

    An answer the tutor could not read ("E", an empty box) is asked for again and does
    not use up an attempt: the student made no mistake.

Every session ends in exactly one typed exit. Three of them are resumable.

The functions here take the current time as an argument and return new immutable
states, so nothing depends on when or where they run. `step` returns what the caller
should do next as `Directive`s; the caller (the session service) does the work of
generating text, verifying it and saving.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from enum import StrEnum


class Phase(StrEnum):
    HOOK = "hook"
    TEACH = "teach"
    CHECKPOINT = "checkpoint"  # waiting for the student's answer
    FEEDBACK = "feedback"  # answer judged, waiting for the student to continue
    RETEACH = "reteach"
    ENDED = "ended"


class ExitReason(StrEnum):
    COMPLETED = "completed"
    MASTERY_SATISFIED = "mastery_satisfied"
    STRUGGLING = "struggling"
    LOAD_EXIT = "load_exit"
    STUDENT_ENDED = "student_ended"
    TIMEOUT = "timeout"


RESUMABLE_EXITS = frozenset({ExitReason.LOAD_EXIT, ExitReason.STUDENT_ENDED, ExitReason.TIMEOUT})

HOOK = "hook"
TEACH = "teach"
CHECKPOINT = "checkpoint"


class InvalidTransition(Exception):
    """An event that makes no sense in the session's current phase."""


@dataclass(frozen=True)
class Rules:
    """The numbers that shape a session, in one place so a study can vary them."""

    max_attempts: int = 3  # the third miss on a gating checkpoint ends the session
    reteach_after: int = 2  # re-teach once this many misses have happened
    timeout: timedelta = timedelta(minutes=30)  # silence that ends a session
    resume_window: timedelta = timedelta(hours=48)  # how long a resumable exit stays resumable


@dataclass(frozen=True)
class Step:
    kind: str  # hook | teach | checkpoint
    ref: str  # what to present: a theory chunk id, or a question id
    gating: bool = False  # checkpoints only


# ---------------------------------------------------------------------- events
@dataclass(frozen=True)
class Continue:
    """The student read the hook, the explanation or the feedback and wants to go on."""


@dataclass(frozen=True)
class Answer:
    """An answer, already marked. `outcome` is correct, wrong or unreadable."""

    outcome: str


@dataclass(frozen=True)
class MasteryReached:
    """The mastery estimate for this concept crossed the threshold."""


@dataclass(frozen=True)
class EndedByStudent:
    pass


@dataclass(frozen=True)
class HighLoad:
    """Cognitive load has stayed high long enough that the tutor should stop."""


@dataclass(frozen=True)
class Tick:
    """Time passing with nothing happening, so silence can be noticed."""


Event = Continue | Answer | MasteryReached | EndedByStudent | HighLoad | Tick


# ------------------------------------------------------------------ directives
@dataclass(frozen=True)
class ShowHook:
    ref: str


@dataclass(frozen=True)
class ShowTeach:
    ref: str


@dataclass(frozen=True)
class AskCheckpoint:
    ref: str
    gating: bool
    attempt: int  # 1 for the first try
    hint: bool  # True when this try should come with a hint


@dataclass(frozen=True)
class Reteach:
    ref: str  # the checkpoint whose underlying idea needs another explanation


@dataclass(frozen=True)
class ShowFeedback:
    ref: str
    outcome: str
    attempt: int
    gating: bool


@dataclass(frozen=True)
class AskAgain:
    """The answer could not be read; ask for it again. No attempt was used."""

    ref: str


@dataclass(frozen=True)
class End:
    reason: ExitReason


Directive = ShowHook | ShowTeach | AskCheckpoint | Reteach | ShowFeedback | AskAgain | End


# ----------------------------------------------------------------------- state
@dataclass(frozen=True)
class SessionState:
    session_id: str
    user_id: str
    concept_id: str
    steps: tuple[Step, ...]
    index: int
    phase: Phase
    started_at: datetime
    last_activity_at: datetime
    attempts: int = 0  # misses on the current gating checkpoint
    last_outcome: str | None = None
    passed: tuple[str, ...] = ()  # every checkpoint answered correctly, gating or not
    passed_gating: tuple[str, ...] = ()
    exit: ExitReason | None = None
    ended_at: datetime | None = None
    rules: Rules = field(default_factory=Rules)

    @property
    def current(self) -> Step:
        return self.steps[self.index]

    @property
    def is_over(self) -> bool:
        return self.phase is Phase.ENDED

    @property
    def gating_total(self) -> int:
        return sum(1 for s in self.steps if s.kind == CHECKPOINT and s.gating)

    @property
    def gating_done(self) -> int:
        return len(self.passed_gating)


@dataclass(frozen=True)
class Transition:
    state: SessionState
    directives: tuple[Directive, ...]


# ----------------------------------------------------------------------- start
def start(
    *,
    session_id: str,
    user_id: str,
    concept_id: str,
    steps: tuple[Step, ...],
    now: datetime,
    rules: Rules | None = None,
) -> Transition:
    if not steps:
        raise ValueError("a session needs at least one step")
    state = SessionState(
        session_id=session_id,
        user_id=user_id,
        concept_id=concept_id,
        steps=steps,
        index=0,
        phase=_phase_for(steps[0]),
        started_at=now,
        last_activity_at=now,
        rules=rules or Rules(),
    )
    return Transition(state, (_present(state),))


# ------------------------------------------------------------------------ step
def step(state: SessionState, event: Event, now: datetime) -> Transition:
    """Apply one event. Returns the new state and what the caller should do."""
    if state.is_over:
        raise InvalidTransition(f"session already ended ({state.exit})")

    # Ending events work in every phase.
    if isinstance(event, EndedByStudent):
        return _end(state, ExitReason.STUDENT_ENDED, now)
    if isinstance(event, HighLoad):
        return _end(state, ExitReason.LOAD_EXIT, now)
    if isinstance(event, Tick):
        if now - state.last_activity_at > state.rules.timeout:
            return _end(state, ExitReason.TIMEOUT, now)
        return Transition(state, ())  # nothing happened, and time passing is not activity

    state = replace(state, last_activity_at=now)

    if isinstance(event, MasteryReached):
        return _mastery(state, now)
    if isinstance(event, Continue):
        return _continue(state, now)
    if isinstance(event, Answer):
        return _answer(state, event, now)
    raise InvalidTransition(f"unknown event {event!r}")


def _continue(state: SessionState, now: datetime) -> Transition:
    phase = state.phase

    if phase in (Phase.HOOK, Phase.TEACH):
        return _advance(state, now)

    if phase is Phase.RETEACH:
        # Back to the same checkpoint for another try.
        state = replace(state, phase=Phase.CHECKPOINT)
        return Transition(state, (_ask(state),))

    if phase is Phase.FEEDBACK:
        step_ = state.current
        missed_gating = step_.gating and state.last_outcome == "wrong"
        if missed_gating:
            state = replace(state, phase=Phase.CHECKPOINT)
            return Transition(state, (_ask(state),))
        return _advance(state, now)

    raise InvalidTransition(f"nothing to continue from in phase {phase}")


def _answer(state: SessionState, event: Answer, now: datetime) -> Transition:
    if state.phase is not Phase.CHECKPOINT:
        raise InvalidTransition(f"no question is open in phase {state.phase}")
    if event.outcome not in ("correct", "wrong", "unreadable"):
        raise InvalidTransition(f"unknown outcome {event.outcome!r}")

    current = state.current

    if event.outcome == "unreadable":
        return Transition(state, (AskAgain(current.ref),))

    if event.outcome == "correct":
        state = replace(
            state,
            phase=Phase.FEEDBACK,
            last_outcome="correct",
            passed=_add(state.passed, current.ref),
            passed_gating=_add(state.passed_gating, current.ref)
            if current.gating
            else state.passed_gating,
        )
        return Transition(
            state, (ShowFeedback(current.ref, "correct", state.attempts + 1, current.gating),)
        )

    # A wrong answer. A pulse check never blocks: show the feedback and move on.
    if not current.gating:
        state = replace(state, phase=Phase.FEEDBACK, last_outcome="wrong-pulse")
        return Transition(state, (ShowFeedback(current.ref, "wrong", 1, False),))

    attempts = state.attempts + 1
    if attempts >= state.rules.max_attempts:
        state = replace(state, attempts=attempts, last_outcome="wrong")
        return _end(state, ExitReason.STRUGGLING, now)

    if attempts >= state.rules.reteach_after:
        state = replace(state, attempts=attempts, phase=Phase.RETEACH, last_outcome="wrong")
        return Transition(
            state,
            (ShowFeedback(current.ref, "wrong", attempts, True), Reteach(current.ref)),
        )

    state = replace(state, attempts=attempts, phase=Phase.FEEDBACK, last_outcome="wrong")
    return Transition(state, (ShowFeedback(current.ref, "wrong", attempts, True),))


def _mastery(state: SessionState, now: datetime) -> Transition:
    """Enough is known: stop, skipping whatever is left, but only if something is left."""
    gating_left = any(
        s.kind == CHECKPOINT and s.gating and s.ref not in state.passed_gating for s in state.steps
    )
    if not state.passed_gating or not gating_left:
        return Transition(state, ())  # nothing demonstrated yet, or nothing left to skip
    return _end(state, ExitReason.MASTERY_SATISFIED, now)


def _advance(state: SessionState, now: datetime) -> Transition:
    if state.index + 1 >= len(state.steps):
        return _end(state, ExitReason.COMPLETED, now)
    state = replace(
        state,
        index=state.index + 1,
        phase=_phase_for(state.steps[state.index + 1]),
        attempts=0,
        last_outcome=None,
    )
    return Transition(state, (_present(state),))


def _end(state: SessionState, reason: ExitReason, now: datetime) -> Transition:
    ended = replace(state, phase=Phase.ENDED, exit=reason, ended_at=now)
    return Transition(ended, (End(reason),))


# ---------------------------------------------------------------------- resume
def can_resume(state: SessionState, now: datetime) -> bool:
    if not state.is_over or state.exit not in RESUMABLE_EXITS or state.ended_at is None:
        return False
    return now - state.ended_at <= state.rules.resume_window


def resume(state: SessionState, now: datetime) -> Transition:
    """Pick a stopped session up again, from just after the last checkpoint passed.

    The explanations between checkpoints are generated fresh, never replayed from a
    cache, so resuming costs nothing but moving the position. Attempts start over.
    """
    if not can_resume(state, now):
        raise InvalidTransition(
            f"cannot resume a session that ended as {state.exit}"
            if state.is_over
            else "the session is still running"
        )

    last_passed = max(
        (i for i, s in enumerate(state.steps) if s.kind == CHECKPOINT and s.ref in state.passed),
        default=-1,
    )
    index = last_passed + 1
    if index >= len(state.steps):  # everything was passed before it stopped
        index = len(state.steps) - 1

    resumed = replace(
        state,
        index=index,
        phase=_phase_for(state.steps[index]),
        attempts=0,
        last_outcome=None,
        last_activity_at=now,
        exit=None,
        ended_at=None,
    )
    return Transition(resumed, (_present(resumed),))


# --------------------------------------------------------------------- helpers
def _phase_for(step_: Step) -> Phase:
    return {HOOK: Phase.HOOK, TEACH: Phase.TEACH, CHECKPOINT: Phase.CHECKPOINT}[step_.kind]


def _present(state: SessionState) -> Directive:
    step_ = state.current
    if step_.kind == HOOK:
        return ShowHook(step_.ref)
    if step_.kind == TEACH:
        return ShowTeach(step_.ref)
    return _ask(state)


def _ask(state: SessionState) -> AskCheckpoint:
    step_ = state.current
    return AskCheckpoint(
        ref=step_.ref,
        gating=step_.gating,
        attempt=state.attempts + 1,
        hint=state.attempts >= 1,
    )


def _add(items: tuple[str, ...], ref: str) -> tuple[str, ...]:
    return items if ref in items else (*items, ref)
