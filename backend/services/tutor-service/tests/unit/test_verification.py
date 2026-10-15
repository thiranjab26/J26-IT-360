"""The faithfulness gate: claim splitting, the decision rule, and how it is used.

The NLI model is replaced by a scripted one so these tests are about the gate's own logic
(what counts as a claim, what blocks, what is logged, what a student is shown), not about
a neural network. How well the real model separates supported from unsupported claims is
measured on a labelled set in research/c3-RAG tutor, not asserted here.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from pathlib import Path

import pytest

from app.llm.providers import Generation, LLMError
from app.sessions.catalog import UnknownModule, load_course
from app.sessions.service import SessionProblem, SessionService
from app.sessions.writer import EXPLAIN, HINT, RETEACH, TutorWriter
from app.verification.claims import (
    LLMDecomposer,
    SentenceDecomposer,
    split_parts,
    split_sentences,
    unsupported_code_lines,
)
from app.verification.gate import WHOLE_RESPONSE, FaithfulnessGate
from app.verification.nli import Entailment
from tests.unit.session_support import Clock, InMemorySessionRepository

CONTENT = Path(__file__).resolve().parents[2] / "content"
STUDENT = str(uuid.uuid4())


class ScriptedNLI:
    """P(entailment) by claim: a claim containing a key word gets its listed score."""

    name = "scripted-nli"

    def __init__(self, scores: dict[str, float] | None = None, default: float = 0.99) -> None:
        self.scores = scores or {}
        self.default = default
        self.seen: list[tuple[str, str]] = []

    def score(self, pairs: Sequence[tuple[str, str]]) -> list[Entailment]:
        self.seen.extend(pairs)
        out = []
        for _, claim in pairs:
            p = next((v for k, v in self.scores.items() if k in claim), self.default)
            rest = (1 - p) / 2
            out.append(Entailment(p, rest, rest))
        return out


# --------------------------------------------------------------- claim splitting
def test_prose_is_split_into_sentences_keeping_inline_code_whole() -> None:
    prose = (
        "A `for` loop repeats code. It checks `i < 10.5` before each pass! "
        "Why does this matter? Because the body might run zero times, e.g. when the test is "
        "false at the start."
    )

    sentences = split_sentences(prose)

    assert sentences == [
        "A `for` loop repeats code.",
        "Because the body might run zero times, e.g. when the test is false at the start.",
    ]


def test_headings_list_markers_questions_and_lead_ins_are_not_claims() -> None:
    prose = (
        "## Loops\n\n- Each pass is called an iteration.\n- Ok.\n\n"
        "Here is the code:\n\n1. The update runs last."
    )

    assert split_sentences(prose) == [
        "Each pass is called an iteration.",
        "The update runs last.",
    ]


def test_code_blocks_are_separated_from_prose() -> None:
    text = "Look at this:\n\n```java\nint x = 1;\n```\n\nIt sets x."

    parts = split_parts(text)

    assert parts.code_blocks == ("int x = 1;",)
    assert "int x" not in parts.prose
    assert split_sentences(parts.prose) == ["It sets x."]


def test_generated_code_must_come_from_the_passage() -> None:
    passage = (
        "Example:\n\n```java\nfor (int i = 0; i < 3; i++) {\n    System.out.println(i);\n}\n```"
        "\n\nUse `i++` to count."
    )

    ok = ("for (int i = 0; i < 3; i++) {\n  System.out.println(i);\n}",)
    invented = ("while (true) {\n    System.out.println(i);\n}",)

    assert unsupported_code_lines(ok, passage) == []
    assert unsupported_code_lines(invented, passage) == ["while (true) {"]


# --------------------------------------------------------------- llm decomposer
class Replies:
    def __init__(self, *replies: str | Exception) -> None:
        self.replies = list(replies)
        self.name, self.model = "fake", "fake-model"
        self.prompts: list[str] = []

    def generate(
        self, *, system: str, prompt: str, max_tokens: int = 700, temperature: float = 0.3
    ):
        self.prompts.append(prompt)
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        if isinstance(reply, Exception):
            raise reply
        return Generation(reply, "fake", "fake-model", 1)


def test_the_llm_decomposer_reads_a_json_array_even_inside_a_code_fence() -> None:
    reply = '```json\n["A loop repeats code.", "The update runs last.", "no"]\n```'

    result = LLMDecomposer(Replies(reply)).decompose("prose")

    assert result.method == "llm"
    assert result.claims == ("A loop repeats code.", "The update runs last.")


@pytest.mark.parametrize("reply", ["not json", '{"a": 1}', "[1, 2]", "[]", LLMError("down")])
def test_the_llm_decomposer_falls_back_to_sentences_and_says_so(reply) -> None:
    result = LLMDecomposer(Replies(reply)).decompose("A loop repeats code. It ends.")

    assert result.method == "llm->sentences"
    assert result.claims == ("A loop repeats code.",)


# --------------------------------------------------------------------------- gate
def gate(nli, **kwargs) -> FaithfulnessGate:
    return FaithfulnessGate(nli, threshold=0.3, **kwargs)


TEXT = "A loop repeats code. The body always runs once. The update runs last."


def test_a_response_passes_only_if_every_claim_is_supported() -> None:
    nli = ScriptedNLI({"always runs once": 0.05})

    result = gate(nli).check(TEXT, "passage")

    assert result.passed is False
    assert [v.text for v in result.unsupported] == ["The body always runs once."]
    assert len(result.verdicts) == 3

    assert gate(ScriptedNLI()).check(TEXT, "passage").passed is True


def test_the_threshold_is_inclusive_and_applies_to_entailment_not_the_top_label() -> None:
    # Entailment 0.3 is neutral's runner-up here, yet it meets a threshold of 0.3.
    at = ScriptedNLI({"update": 0.3})
    just_below = ScriptedNLI({"update": 0.299})

    assert gate(at).check(TEXT, "p").passed is True
    assert gate(just_below).check(TEXT, "p").passed is False


def test_every_claim_is_judged_against_the_passage_it_came_from() -> None:
    nli = ScriptedNLI()

    gate(nli).check(TEXT, "THE PASSAGE")

    assert {premise for premise, _ in nli.seen} == {"THE PASSAGE"}


def test_invented_code_blocks_the_response_even_if_the_prose_is_fine() -> None:
    text = "A loop repeats code.\n\n```java\nwhile (true) { }\n```"

    result = gate(ScriptedNLI()).check(text, "A loop repeats code.")

    assert result.passed is False
    assert [v.kind for v in result.unsupported] == ["code"]
    assert result.unsupported[0].p_entailment is None


def test_whole_response_granularity_judges_the_prose_as_one_hypothesis() -> None:
    nli = ScriptedNLI({"always runs once": 0.05})

    result = gate(nli, granularity=WHOLE_RESPONSE).check(TEXT, "passage")

    assert len(result.verdicts) == 1 and result.verdicts[0].kind == "response"
    # The baseline can reject, but it cannot say WHICH statement is wrong.
    assert result.passed is False
    assert result.unsupported[0].text == TEXT
    assert nli.seen[0][1] == TEXT


def test_a_response_with_nothing_to_check_passes_vacuously() -> None:
    result = gate(ScriptedNLI()).check("Why does it matter?", "passage")

    assert result.passed is True and result.verdicts == () and result.decomposition == "none"


def test_bad_gate_settings_are_refused() -> None:
    with pytest.raises(ValueError):
        FaithfulnessGate(ScriptedNLI(), threshold=0.0)
    with pytest.raises(ValueError):
        FaithfulnessGate(ScriptedNLI(), threshold=1.0)
    with pytest.raises(ValueError):
        FaithfulnessGate(ScriptedNLI(), threshold=0.5, granularity="paragraph")


# ------------------------------------------------------------------ gate + writer
def writer(model, nli, **kwargs) -> TutorWriter:
    return TutorWriter(
        model, FaithfulnessGate(nli, threshold=0.3, decomposer=SentenceDecomposer()), **kwargs
    )


GOOD = "A loop repeats code. The update runs last."
BAD = "A loop repeats code. The body always runs once."


def test_a_text_the_gate_passes_is_returned_verified() -> None:
    result = writer(Replies(GOOD), ScriptedNLI({"always": 0.0})).write(
        EXPLAIN, concept="Loops", passage="p"
    )

    assert result.generated.text == GOOD and result.generated.verified is True
    assert len(result.audits) == 1 and result.audits[0].result.passed


def test_a_blocked_text_is_regenerated_once_and_told_what_was_unsupported() -> None:
    model = Replies(BAD, GOOD)

    result = writer(model, ScriptedNLI({"always": 0.0})).write(
        EXPLAIN, concept="Loops", passage="p"
    )

    assert result.generated.text == GOOD and result.generated.verified is True
    assert [a.attempt for a in result.audits] == [1, 2]
    assert [a.result.passed for a in result.audits] == [False, True]
    assert "The body always runs once." in model.prompts[1]
    assert "NOT supported by the passage" in model.prompts[1]
    assert "NOT supported by the passage" not in model.prompts[0]


def test_two_blocked_texts_show_nothing_generated() -> None:
    result = writer(Replies(BAD, BAD), ScriptedNLI({"always": 0.0})).write(
        EXPLAIN, concept="Loops", passage="p"
    )

    assert result.generated is None and result.blocked is True
    assert len(result.audits) == 2


def test_the_number_of_regenerations_is_a_setting() -> None:
    result = writer(Replies(BAD), ScriptedNLI({"always": 0.0}), max_regenerations=0).write(
        EXPLAIN, concept="Loops", passage="p"
    )

    assert result.blocked and len(result.audits) == 1


def test_a_gate_that_crashes_fails_closed() -> None:
    class Broken:
        name = "broken"

        def score(self, pairs):
            raise RuntimeError("model file missing")

    result = writer(Replies(GOOD), Broken()).write(EXPLAIN, concept="Loops", passage="p")

    assert result.generated is None and result.blocked is True


def test_kinds_the_gate_does_not_cover_are_returned_unchecked() -> None:
    result = writer(Replies(BAD), ScriptedNLI({"always": 0.0}), gated_kinds={EXPLAIN}).write(
        HINT, concept="Loops", passage="p", question="q"
    )

    assert result.generated.text == BAD and result.generated.verified is None
    assert result.audits == ()


def test_without_a_gate_text_is_unchecked_and_without_a_model_there_is_none() -> None:
    plain = TutorWriter(Replies(GOOD)).write(RETEACH, concept="Loops", passage="p")
    assert plain.generated.verified is None

    assert TutorWriter(None).write(EXPLAIN, concept="Loops", passage="p").generated is None
    failing = TutorWriter(Replies(LLMError("down"))).write(EXPLAIN, concept="Loops", passage="p")
    assert failing.generated is None and failing.blocked is False


# --------------------------------------------------------- inside the session service
@pytest.fixture(scope="module")
def course():
    return load_course(CONTENT, "prog")


def make_service(course, model, nli):
    repo = InMemorySessionRepository()

    def courses(module_id: str):
        if module_id != "prog":
            raise UnknownModule(module_id)
        return course

    service = SessionService(
        repo, courses, clock=Clock(), enforce_unlocks=False, writer=writer(model, nli)
    )
    return service, repo


def first_teach(service):
    view = service.start(STUDENT, "prog.loops")
    return service.cont(STUDENT, view.session_id)


def test_a_verified_text_is_shown_marked_verified_and_its_claims_are_logged(course) -> None:
    service, repo = make_service(course, Replies(GOOD), ScriptedNLI())

    teach = first_teach(service)

    assert (
        teach.text == GOOD and teach.text_source == "generated" and teach.text_check == "verified"
    )
    assert len(repo.gate_events) == 2
    event = repo.gate_events[0]
    assert event.decision == "pass" and event.nli_model == "scripted-nli" and event.attempt == 1
    assert event.passage_id.startswith("prog.loops#theory")
    stored = next(iter(repo.texts.values()))
    assert stored.verified is True and stored.output_id == event.output_id


def test_a_text_the_gate_blocks_twice_is_replaced_by_the_course_text_and_says_so(course) -> None:
    service, repo = make_service(course, Replies(BAD, BAD), ScriptedNLI({"always": 0.0}))

    teach = first_teach(service)

    ref = repo.get(teach.session_id).state.current.ref
    assert teach.text == course.chunk_text[ref]
    assert teach.text_source == "authored" and teach.text_check == "blocked"
    assert teach.source_text is None
    decisions = [(e.attempt, e.decision) for e in repo.gate_events]
    assert (1, "block") in decisions and (2, "block") in decisions, "blocked attempts are logged"
    assert next(iter(repo.texts.values())).verified is False


def test_a_regenerated_text_that_passes_is_what_the_student_sees(course) -> None:
    service, repo = make_service(course, Replies(BAD, GOOD), ScriptedNLI({"always": 0.0}))

    teach = first_teach(service)

    assert teach.text == GOOD and teach.text_check == "verified"
    assert {e.attempt for e in repo.gate_events} == {1, 2}


def test_a_blocked_text_is_not_regenerated_on_every_refresh(course) -> None:
    model = Replies(BAD, BAD)
    service, _ = make_service(course, model, ScriptedNLI({"always": 0.0}))

    teach = first_teach(service)
    service.view(STUDENT, teach.session_id)
    service.view(STUDENT, teach.session_id)

    assert len(model.prompts) == 2, "one original and one regeneration, then it is saved"


def test_without_a_gate_generated_text_is_labelled_unchecked(course) -> None:
    repo = InMemorySessionRepository()
    service = SessionService(
        repo,
        lambda _: course,
        clock=Clock(),
        enforce_unlocks=False,
        writer=TutorWriter(Replies(GOOD)),
    )

    teach = first_teach(service)

    assert teach.text_source == "generated" and teach.text_check == "unchecked"
    assert repo.gate_events == []


def test_authored_text_with_no_model_has_no_check_label(course) -> None:
    service = SessionService(
        InMemorySessionRepository(),
        lambda _: course,
        clock=Clock(),
        enforce_unlocks=False,
        writer=TutorWriter(None),
    )

    teach = first_teach(service)

    assert teach.text_source == "authored" and teach.text_check is None


# ----------------------------------------------------- the shared verified explanations
def test_a_verified_explanation_is_reused_by_later_sessions_without_a_model_call(course) -> None:
    model = Replies(GOOD)
    service, repo = make_service(course, model, ScriptedNLI())
    first = first_teach(service)
    events_after_first = len(repo.gate_events)
    calls_after_first = len(model.prompts)

    # Same student starting over, and a different student: both read the shared text.
    service.end(STUDENT, first.session_id)
    again = service.cont(STUDENT, service.start(STUDENT, "prog.loops").session_id)
    other = str(uuid.uuid4())
    elsewhere = service.cont(other, service.start(other, "prog.loops").session_id)

    assert again.text == elsewhere.text == first.text == GOOD
    assert again.text_check == elsewhere.text_check == "verified"
    assert len(model.prompts) == calls_after_first, "no further model calls"
    assert len(repo.gate_events) == events_after_first, "nothing was re-checked"


def test_only_explanations_that_passed_are_shared(course) -> None:
    service, repo = make_service(course, Replies(BAD, BAD), ScriptedNLI({"always": 0.0}))

    first_teach(service)

    assert repo.verified == {}


def test_without_a_gate_nothing_is_shared(course) -> None:
    repo = InMemorySessionRepository()
    service = SessionService(
        repo,
        lambda _: course,
        clock=Clock(),
        enforce_unlocks=False,
        writer=TutorWriter(Replies(GOOD)),
    )

    first_teach(service)

    assert repo.verified == {}


def test_hints_are_never_shared_and_a_changed_setting_changes_the_key() -> None:
    model = Replies(GOOD)
    base = TutorWriter(model, FaithfulnessGate(ScriptedNLI(), threshold=0.3))
    stricter = TutorWriter(model, FaithfulnessGate(ScriptedNLI(), threshold=0.5))
    whole = TutorWriter(
        model, FaithfulnessGate(ScriptedNLI(), threshold=0.3, granularity=WHOLE_RESPONSE)
    )

    assert base.cache_fingerprint(HINT) is None, "a hint depends on the question"
    assert base.cache_fingerprint(RETEACH) is not None, "a re-teach depends on the passage only"
    assert base.cache_fingerprint(RETEACH) != base.cache_fingerprint(EXPLAIN)
    assert TutorWriter(model).cache_fingerprint(EXPLAIN) is None
    assert TutorWriter(None).cache_fingerprint(EXPLAIN) is None
    keys = {w.cache_fingerprint(EXPLAIN) for w in (base, stricter, whole)}
    assert len(keys) == 3 and None not in keys


# ------------------------------------------------------------------ passage windows
def test_windows_are_short_stretches_of_the_passage_and_never_cut_a_code_example() -> None:
    from app.verification.claims import passage_windows

    passage = (
        "### Heading\n\n"
        "The condition is checked before every pass, so the body may never run at all.\n\n"
        "```java\nint i = 0;\n\nwhile (i < 3) {\n    i++;\n}\n```\n\n"
        "The loop ends when the condition becomes false."
    )

    windows = passage_windows(passage)

    assert "### Heading" not in windows, "a bare heading cannot support a claim"
    assert any("int i = 0;\n\nwhile" in w for w in windows), "the code example stays whole"
    assert all(w != passage.strip() for w in windows)
    assert len(windows) == len(set(windows))


def test_a_claim_is_judged_by_the_stretch_that_supports_it_best() -> None:
    class ByPremise:
        name = "by-premise"

        def score(self, pairs):
            # Supported only by a short premise that holds the key sentence.
            return [
                Entailment(0.9 if len(premise) < 60 and "KEY" in premise else 0.05, 0.9, 0.05)
                for premise, _ in pairs
            ]

    passage = (
        "KEY sentence here is short enough to count as a block.\n\n"
        "Some other long filler paragraph about something else entirely, which is unrelated."
    )
    claim = "The key sentence is true."

    assert FaithfulnessGate(ByPremise(), threshold=0.5).check(claim, passage).passed is False
    assert (
        FaithfulnessGate(ByPremise(), threshold=0.5, windows=True).check(claim, passage).passed
        is True
    )


# ------------------------------------------------------------------------ trimming
LONG = (
    "A loop repeats a block of code while a condition stays true. "
    "The condition is checked before every pass through the body. "
    "Each pass through the body is called one iteration of the loop. "
    "The update step usually changes the variable that the condition reads. "
    "The body always runs once whatever the condition says at the start. "
    "When the condition becomes false the loop ends and the program moves on."
)
BAD_SENTENCE = "The body always runs once whatever the condition says at the start."


def test_trimming_cuts_only_the_failing_sentence_and_keeps_code_and_structure() -> None:
    from app.verification.claims import trim_unsupported

    text = f"## Loops\n\n{LONG}\n\n```java\nwhile (x < 3) {{\n    x++;\n}}\n```\n\nThat is a loop."

    trimmed = trim_unsupported(text, [BAD_SENTENCE])

    assert trimmed is not None
    assert BAD_SENTENCE not in trimmed
    assert "## Loops" in trimmed and "while (x < 3) {\n    x++;\n}" in trimmed
    assert trimmed.endswith("That is a loop.")
    assert "iteration of the loop" in trimmed


def test_trimming_refuses_when_it_cannot_tell_what_to_remove() -> None:
    from app.verification.claims import trim_unsupported

    assert trim_unsupported(LONG, ["Something the text never says about compilers."]) is None
    assert trim_unsupported(LONG, []) is None


def test_trimming_refuses_when_too_much_would_go_or_too_little_would_stay() -> None:
    from app.verification.claims import trim_unsupported

    many = [s.strip() + "." for s in LONG.split(".") if s.strip()][:3]

    assert trim_unsupported(LONG, many) is None, "half the explanation is not a trim"
    short = "One short claim here. And another short one."
    assert trim_unsupported(short, ["One short claim here."]) is None, "too little would remain"


def test_a_failed_text_is_trimmed_before_any_rewrite_is_paid_for() -> None:
    model = Replies(LONG, LONG)

    result = writer(model, ScriptedNLI({"always": 0.0})).write(
        EXPLAIN, concept="Loops", passage="p"
    )

    assert result.generated is not None and result.generated.verified is True
    assert BAD_SENTENCE not in result.generated.text
    assert "iteration" in result.generated.text
    assert [a.attempt for a in result.audits] == [1, 2]
    assert [a.result.passed for a in result.audits] == [False, True]
    assert BAD_SENTENCE not in result.audits[1].text, "the second audit is the trimmed text"
    assert len(model.prompts) == 1, "no rewrite was requested"


def test_when_trimming_is_not_possible_the_text_is_rewritten_with_feedback() -> None:
    model = Replies(BAD, GOOD)

    result = writer(model, ScriptedNLI({"always": 0.0})).write(
        EXPLAIN, concept="Loops", passage="p"
    )

    assert result.generated.text == GOOD and len(model.prompts) == 2


def test_a_trimmed_text_that_still_fails_is_not_shown() -> None:
    nli = ScriptedNLI({"always": 0.0, "condition": 0.0})  # the rest is unsupported too

    result = writer(Replies(LONG, LONG), nli).write(EXPLAIN, concept="Loops", passage="p")

    assert result.generated is None and result.blocked is True


def test_invented_code_is_never_trimmed_away() -> None:
    text = LONG + "\n\n```java\nwhile (true) { }\n```"

    result = writer(Replies(text, text), ScriptedNLI()).write(
        EXPLAIN, concept="Loops", passage="A passage with no code."
    )

    assert result.generated is None and result.blocked is True


# ------------------------------------------------------------- waiting and prefetch
def test_the_filler_waits_for_a_job_and_runs_it_once_however_many_ask() -> None:
    import threading

    from app.verification.fill import Filler, Outcome

    runs: list[str] = []
    release = threading.Event()

    def work(kind: str, module: str, passage: str) -> Outcome:
        runs.append(passage)
        release.wait(5)
        return Outcome("built")

    filler = Filler(work)
    filler.prefetch("explain", "prog", "p1")
    filler.prefetch("explain", "prog", "p1")  # already running: joined, not started again
    release.set()

    assert filler.wait("explain", "prog", "p1", timeout=5) is True
    assert runs == ["p1"]


def test_a_passage_that_ended_blocked_is_not_retried_straight_away() -> None:
    from app.verification.fill import Filler, Outcome

    runs: list[int] = []

    def work(kind: str, module: str, passage: str) -> Outcome:
        runs.append(1)
        return Outcome("blocked", 2)

    filler = Filler(work)
    assert filler.wait("explain", "prog", "p1", timeout=5) is True
    assert filler.recently_failed("explain", "prog", "p1")

    assert filler.start("explain", "prog", "p1") is None
    assert filler.wait("explain", "prog", "p1", timeout=1) is False
    assert runs == [1], "no second job for a passage that just failed"
    assert not filler.recently_failed("explain", "prog", "other")


# ------------------------------------------------- the click waits for the checked text
def make_waiting_service(course, work_outcome: str):
    """A service whose explanations come from a background Filler, as in production."""
    from app.sessions.grounding import primary_only
    from app.sessions.repository import CachedExplanation
    from app.verification.fill import Filler, Outcome

    repo = InMemorySessionRepository()
    the_writer = writer(Replies("unused"), ScriptedNLI())
    started: list[tuple[str, str]] = []

    def work(kind: str, module: str, passage_id: str) -> Outcome:
        started.append((kind, passage_id))
        if work_outcome == "built":
            ground = primary_only(course, passage_id)
            repo.put_verified(
                passage_id,
                ground.digest,
                the_writer.cache_fingerprint(kind),
                CachedExplanation(
                    f"AI text for {passage_id}",
                    "gemini",
                    "m",
                    None,
                    [s.as_json() for s in ground.sources],
                ),
            )
        return Outcome(work_outcome, 1)

    def courses(module_id: str):
        if module_id != "prog":
            raise UnknownModule(module_id)
        return course

    service = SessionService(
        repo,
        courses,
        clock=Clock(),
        enforce_unlocks=False,
        writer=the_writer,
        filler=Filler(work),
        fill_wait=5,
    )
    return service, repo, started


def test_clicking_continue_returns_the_finished_checked_text_not_the_course_text(course) -> None:
    service, repo, started = make_waiting_service(course, "built")
    view = service.start(STUDENT, "prog.loops")

    teach = service.cont(STUDENT, view.session_id)

    assert teach.text.startswith("AI text for prog.loops#theory-")
    assert teach.text_source == "generated" and teach.text_check == "verified"
    assert teach.sources and teach.sources[0].kind == "main"
    assert repo.get_text(view.session_id, f"teach:{teach.sources[0].chunk_id}") is not None


def test_while_a_part_is_read_the_next_one_is_prepared_ahead(course) -> None:
    import time

    service, _, started = make_waiting_service(course, "built")

    service.start(STUDENT, "prog.loops")  # the hook screen: part one is prepared meanwhile

    for _ in range(50):
        if started:
            break
        time.sleep(0.05)
    assert started and started[0][0] == "explain"
    assert started[0][1].startswith("prog.loops#theory-01")


def test_a_part_the_checker_rejected_shows_the_course_text_and_says_so(course) -> None:
    service, repo, _ = make_waiting_service(course, "blocked")
    view = service.start(STUDENT, "prog.loops")

    teach = service.cont(STUDENT, view.session_id)

    assert teach.text_source == "authored" and teach.text_check == "blocked"
    again = service.view(STUDENT, view.session_id)
    assert again.text == teach.text, "what the student saw is kept; it never changes under them"


def test_the_history_lists_the_parts_already_read_in_order(course) -> None:
    service, _, _ = make_waiting_service(course, "built")
    view = service.start(STUDENT, "prog.loops")
    first = service.cont(STUDENT, view.session_id)
    service.cont(STUDENT, view.session_id)

    parts = service.history(STUDENT, view.session_id).parts

    assert [p.step_number for p in parts] == [1, 2]
    assert parts[0].heading == "What you will be able to do"
    assert parts[1].text == first.text and parts[1].text_check == "verified"


def test_the_history_belongs_to_the_student_who_read_it(course) -> None:
    service, _, _ = make_waiting_service(course, "built")
    view = service.start(STUDENT, "prog.loops")

    with pytest.raises(SessionProblem) as caught:
        service.history(str(uuid.uuid4()), view.session_id)

    assert caught.value.code == "session_not_found"
