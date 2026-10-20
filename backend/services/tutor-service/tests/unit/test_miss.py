"""What a student is shown after a wrong multiple-choice quick check.

The answer, in words, side by side with what they chose, plus a short note on why their choice
was wrong. The note is written for that student alone, by the model, and shown only if the gate
passed it. Model, checker and jobs are faked.
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path

import pytest

from app.sessions.catalog import UnknownModule, load_course
from app.sessions.repository import StoredText
from app.sessions.service import SessionService
from app.sessions.writer import MISS, SYSTEM, SYSTEM_MISS, RetryPolicy, TutorWriter
from app.verification.claims import SentenceDecomposer
from app.verification.fill import Filler, Outcome
from app.verification.gate import FaithfulnessGate
from tests.unit.session_support import Clock, InMemorySessionRepository
from tests.unit.test_verification import Replies, ScriptedNLI

CONTENT = Path(__file__).resolve().parents[2] / "content"
STUDENT = str(uuid.uuid4())
OTHER = str(uuid.uuid4())

NOTE = "Option B is not correct because the loop condition is checked before each pass."


@pytest.fixture(scope="module")
def course():
    return load_course(CONTENT, "prog")


def writer(*, gate: bool = True, kinds=(MISS,)) -> TutorWriter:
    checker = (
        FaithfulnessGate(ScriptedNLI(), threshold=0.3, decomposer=SentenceDecomposer())
        if gate
        else None
    )
    return TutorWriter(
        Replies(NOTE), checker, gated_kinds=kinds, policy=RetryPolicy(sleep=lambda _: None)
    )


def make(course, *, outcome: str = "built", filler: bool = True, the_writer=None):
    repo = InMemorySessionRepository()
    started: list[tuple] = []

    def work(kind, module, question_id, session_id=None, text_key=None) -> Outcome:
        started.append((kind, question_id, session_id, text_key))
        if outcome == "built":
            repo.put_text(
                session_id,
                text_key,
                StoredText(f"Note for {session_id[:6]}: {NOTE}", "generated", "g", "m", True),
            )
        return Outcome(outcome, 1)

    def courses(module_id: str):
        if module_id != "prog":
            raise UnknownModule(module_id)
        return course

    service = SessionService(
        repo,
        courses,
        clock=Clock(),
        enforce_unlocks=False,
        writer=the_writer or writer(),
        filler=Filler(work) if filler else None,
        fill_wait=5,
        live=True,
    )
    return service, repo, started


def to_quick_mcq(service, student=STUDENT):
    """Walk a session until a multiple-choice quick check is open."""
    view = service.start(student, "prog.loops")
    for _ in range(40):
        if view.phase == "checkpoint" and not view.question.gating and view.question.kind == "mcq":
            return view
        if view.phase == "checkpoint":
            raise AssertionError("this concept has no quick check before the first checkpoint")
        view = service.cont(student, view.session_id)
    raise AssertionError("no quick check found")


def wrong_letter(course, view) -> str:
    entry = course.bank[view.question.question_id]
    _, key = SessionService._presented(view.session_id, entry)
    return next(o.letter for o in view.question.options if o.letter != key.correct_option)


def right_letter(course, view) -> str:
    entry = course.bank[view.question.question_id]
    _, key = SessionService._presented(view.session_id, entry)
    return key.correct_option


# ------------------------------------------------------------------ the answer, in words
def test_a_wrong_quick_check_names_what_was_chosen_and_the_right_option_in_words(course) -> None:
    service, _, _ = make(course)
    view = to_quick_mcq(service)
    chosen = wrong_letter(course, view)
    right = right_letter(course, view)
    texts = {o.letter: o.text for o in view.question.options}

    shown = service.answer(STUDENT, view.session_id, chosen).feedback

    assert shown.outcome == "wrong" and shown.message.startswith("Not quite")
    assert (shown.chosen_option, shown.chosen_text) == (chosen, texts[chosen])
    assert (shown.correct_option, shown.correct_text) == (right, texts[right])


def test_the_letters_match_the_options_this_student_was_shown(course) -> None:
    service, _, _ = make(course)
    view = to_quick_mcq(service)
    entry = course.bank[view.question.question_id]
    _, key = SessionService._presented(view.session_id, entry)

    feedback = service.answer(STUDENT, view.session_id, wrong_letter(course, view)).feedback

    shown = {o.letter: o.text for o in view.question.options}
    assert shown[key.correct_option] == feedback.correct_text, "the shuffled letter is the same"


def test_a_right_answer_shows_no_chosen_or_correct_text(course) -> None:
    service, _, _ = make(course)
    view = to_quick_mcq(service)

    feedback = service.answer(STUDENT, view.session_id, right_letter(course, view)).feedback

    assert feedback.outcome == "correct"
    assert feedback.chosen_text is None and feedback.correct_text is None


def test_a_gating_question_still_hides_the_answer_after_a_wrong_try(course) -> None:
    service, _, _ = make(course)
    view = service.start(STUDENT, "prog.loops")
    while not (view.phase == "checkpoint" and view.question.gating):
        view = (
            service.answer(STUDENT, view.session_id, right_letter(course, view))
            if view.phase == "checkpoint"
            else service.cont(STUDENT, view.session_id)
        )

    feedback = service.answer(STUDENT, view.session_id, "definitely not it").feedback

    assert feedback.correct_option is None and feedback.correct_text is None
    assert feedback.chosen_text is None, "a retry means something only if nothing is given away"


# ------------------------------------------------------------------ the note on why
def test_the_note_starts_being_written_the_moment_a_wrong_answer_is_recorded(course) -> None:
    service, _, started = make(course)
    view = to_quick_mcq(service)

    service.answer(STUDENT, view.session_id, wrong_letter(course, view))
    for _ in range(50):
        if any(job[0] == MISS for job in started):
            break
        time.sleep(0.05)

    job = next(job for job in started if job[0] == MISS)
    assert job[1] == view.question.question_id, "keyed to the question"
    assert job[2] == view.session_id and job[3] == f"miss:{view.question.question_id}"


def test_a_right_answer_starts_no_note(course) -> None:
    service, _, started = make(course)
    view = to_quick_mcq(service)

    service.answer(STUDENT, view.session_id, right_letter(course, view))
    time.sleep(0.2)

    assert not any(job[0] == MISS for job in started)


def test_the_note_is_returned_once_written_and_belongs_to_that_student(course) -> None:
    service, _, _ = make(course)
    view = to_quick_mcq(service)
    service.answer(STUDENT, view.session_id, wrong_letter(course, view))

    note = None
    for _ in range(50):
        note = service.miss(STUDENT, view.session_id)
        if note.status == "ready":
            break
        time.sleep(0.05)

    assert note.status == "ready" and note.text.startswith(f"Note for {view.session_id[:6]}")
    other_view = to_quick_mcq(service, OTHER)
    service.answer(OTHER, other_view.session_id, wrong_letter(course, other_view))
    for _ in range(50):
        theirs = service.miss(OTHER, other_view.session_id)
        if theirs.status == "ready":
            break
        time.sleep(0.05)
    assert theirs.text != note.text, "written for each student, never shared"


def test_nothing_is_offered_when_there_is_nothing_to_explain(course) -> None:
    service, _, _ = make(course)
    view = to_quick_mcq(service)

    assert service.miss(STUDENT, view.session_id).status == "none", "nothing answered yet"
    service.answer(STUDENT, view.session_id, right_letter(course, view))
    assert service.miss(STUDENT, view.session_id).status == "none", "a right answer"


def test_a_note_the_checker_would_not_pass_is_reported_as_unavailable_not_shown(course) -> None:
    service, _, _ = make(course, outcome="blocked")
    view = to_quick_mcq(service)
    service.answer(STUDENT, view.session_id, wrong_letter(course, view))

    status = "pending"
    for _ in range(50):
        status = service.miss(STUDENT, view.session_id).status
        if status != "pending":
            break
        time.sleep(0.05)

    assert status == "unavailable"


def test_without_a_model_or_a_checker_there_is_no_note_and_no_error(course) -> None:
    for the_writer in (writer(gate=False), TutorWriter(None)):
        service, _, started = make(course, the_writer=the_writer)
        view = to_quick_mcq(service)

        feedback = service.answer(STUDENT, view.session_id, wrong_letter(course, view)).feedback

        assert feedback.correct_text, "the answer is still shown, in words"
        assert service.miss(STUDENT, view.session_id).status == "unavailable"
        assert not started


def test_no_background_worker_means_no_note_but_the_answer_still_shows(course) -> None:
    service, _, _ = make(course, filler=False)
    view = to_quick_mcq(service)

    feedback = service.answer(STUDENT, view.session_id, wrong_letter(course, view)).feedback

    assert feedback.correct_text
    assert service.miss(STUDENT, view.session_id).status == "unavailable"


def test_another_student_cannot_read_the_note(course) -> None:
    from app.sessions.service import SessionProblem

    service, _, _ = make(course)
    view = to_quick_mcq(service)
    service.answer(STUDENT, view.session_id, wrong_letter(course, view))

    with pytest.raises(SessionProblem) as caught:
        service.miss(OTHER, view.session_id)

    assert caught.value.code == "session_not_found"


# ------------------------------------------------------------------ the writer's rules
def test_a_note_is_always_checked_whatever_the_gate_settings_say() -> None:
    from app.config import Settings
    from app.sessions.factory import build_writer

    settings = Settings(
        DATABASE_URL="postgresql://u:p@localhost/db",
        _env_file=None,
        TUTOR_GEMINI_API_KEY="k",
        TUTOR_GATE_KINDS="explain",  # a setting that leaves out everything else
    )

    the_writer, _ = build_writer(settings)

    assert the_writer.checks(MISS) and not the_writer.checks("hint")


def test_only_the_note_may_be_told_the_answer() -> None:
    assert "Never state the answer" in SYSTEM
    assert "Never state the answer" not in SYSTEM_MISS
    assert "answer key" in SYSTEM_MISS


def test_the_note_prompt_gives_the_model_the_question_and_what_the_student_chose() -> None:
    model = Replies(NOTE)
    the_writer = TutorWriter(
        model,
        FaithfulnessGate(ScriptedNLI(), threshold=0.3, decomposer=SentenceDecomposer()),
        gated_kinds=(MISS,),
        policy=RetryPolicy(sleep=lambda _: None),
    )

    result = the_writer.write(
        MISS,
        concept="Loops",
        passage="A loop repeats code.",
        question="Which repeats?\nA. a loop\nB. a variable\n\nThe student chose option B.",
        support=(("The answer key", "The correct answer is option A."),),
    )

    assert result.generated.verified is True
    prompt = model.prompts[0]
    assert "The student chose option B." in prompt and "The correct answer is option A." in prompt
    assert "at most two short sentences" in prompt
