"""Generating draft practicals: reading the model's reply, the checks that follow, and planning.

The model, the Java runner and the NLI model are all faked. What is tested is the logic around
them: the sample output comes from running the solution and never from the model, unsafe or
broken drafts are stopped before they reach a lecturer as approvable, and a model that keeps
replying badly fails loudly instead of saving rubbish.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from app.llm.providers import Generation, LLMError
from app.practicals.authoring import AuthoringService
from app.practicals.generation import DraftGenerator
from app.practicals.generator import (
    ProposalError,
    assemble_statement,
    build_prompt,
    material_for,
    parse_proposal,
    prerequisite_closure,
)
from app.practicals.scope import (
    constructs_check,
    duplicate_check,
    overlap,
    taught_premises,
    taught_scope,
)
from app.practicals.tests_builder import parse_samples
from app.sessions.catalog import load_course
from app.sessions.service import SessionProblem
from app.verification.nli import Entailment
from tests.unit.practical_support import (
    FakeRunner,
    InMemoryAssessmentStore,
    InMemoryPracticalRepository,
)

CONTENT = Path(__file__).resolve().parents[2] / "content"
LECTURER = str(uuid.uuid4())
LOOPS = "prog.loops"

ECHO = "public class Main { public static void main(String[] a) { /* echo */ } }"


def reply(**kw) -> str:
    body = {
        "title": "Echo a word",
        "description": "Read one word and print it back on a line by itself.",
        "sample_input": "hi\n",
        "reference_solution": ECHO,
        "skills": [
            "A while loop repeats a block while its condition is true.",
            "A Scanner reads values from standard input.",
            "The println method prints a line of text.",
        ],
    } | kw
    return json.dumps(body)


class ScriptedProvider:
    """Answers from a queue, so a test decides exactly what the model says each time."""

    name = "fake"
    model = "fake-model"

    def __init__(self, *replies: str) -> None:
        self.replies = list(replies)
        self.prompts: list[str] = []

    def generate(self, *, system, prompt, max_tokens=700, temperature=0.3) -> Generation:
        self.prompts.append(prompt)
        if not self.replies:
            raise LLMError("quota")
        return Generation(self.replies.pop(0), self.name, self.model, 1)


class FakeNLI:
    """Scores a claim by a number written in it: 'p=0.9' is supported at 0.9."""

    name = "fake-nli"

    def __init__(self, default: float = 0.95) -> None:
        self.default = default

    def score(self, pairs):
        out = []
        for _, claim in pairs:
            p = float(claim.split("p=")[1].split()[0]) if "p=" in claim else self.default
            out.append(Entailment(p, 1 - p, 0.0))
        return out


@pytest.fixture(scope="module")
def course():
    return load_course(CONTENT, "prog")


# --------------------------------------------------------------------------- reading a reply
def test_a_good_reply_is_read() -> None:
    proposal = parse_proposal(reply())

    assert proposal.title == "Echo a word" and proposal.sample_input == "hi\n"
    assert len(proposal.skills) == 3 and "public class Main" in proposal.reference_solution


def test_json_in_a_code_fence_or_surrounded_by_prose_is_still_read() -> None:
    fenced = "```json\n" + reply() + "\n```"
    chatty = "Here is the practical you asked for:\n" + reply() + "\nHope it helps!"

    assert parse_proposal(fenced).title == parse_proposal(chatty).title == "Echo a word"


def test_a_sample_the_model_put_in_the_description_is_cut_off() -> None:
    proposal = parse_proposal(
        reply(description="Print the word.\n\nSample input:\nhi\nSample output:\nhi")
    )

    assert proposal.description == "Print the word."


@pytest.mark.parametrize(
    "bad",
    ["not json at all", "[1, 2]", reply(description=""), reply(skills="no"), '{"title": "x"}'],
)
def test_a_reply_that_cannot_be_used_is_refused(bad) -> None:
    with pytest.raises(ProposalError):
        parse_proposal(bad)


def test_the_statement_has_the_same_shape_the_authored_ones_have() -> None:
    statement = assemble_statement("Print the sum.", ("2\n3\n", "5\n"))

    assert parse_samples(statement) == [("2\n3\n", "5")]
    assert statement.startswith("Print the sum.\n\nSample input:")


def test_the_prompt_carries_the_course_material_and_what_already_exists(course) -> None:
    prompt = build_prompt(
        course, LOOPS, 4, ["Print the even numbers."], "use a do-while", ["avoid me"]
    )

    assert "Loops" in prompt and "Level 4" in prompt
    assert (
        "Print the even numbers." in prompt and "avoid me" in prompt and "use a do-while" in prompt
    )
    assert material_for(course, LOOPS)[0][:30] in prompt


def test_prerequisites_are_followed_all_the_way_back(course) -> None:
    closure = prerequisite_closure(course, "prog.nested_loops")

    assert LOOPS in closure and "prog.java_intro" in closure
    assert closure == [c for c in course.order if c in closure], "in teaching order"


# ------------------------------------------------------------------------------- the checks
def test_skills_the_course_supports_pass() -> None:
    check, rows = taught_scope(FakeNLI(), ["a p=0.9 b", "c p=0.95 d"], ["premise"], 0.77)

    assert check["status"] == "pass" and all(r.supported for r in rows)


def test_one_unsupported_skill_is_a_warning_that_names_it() -> None:
    check, _ = taught_scope(
        FakeNLI(), ["fine p=0.95", "odd p=0.2", "fine p=0.9", "fine p=0.9"], ["premise"], 0.77
    )

    assert check["status"] == "warn" and "odd p=0.2 (0.20)" in check["detail"]


def test_a_task_whose_skills_are_nearly_all_missing_fails() -> None:
    skills = ["a p=0.1", "b p=0.2", "c p=0.1", "d p=0.9"]

    check, _ = taught_scope(FakeNLI(), skills, ["premise"], 0.77)

    assert check["status"] == "fail" and "not found in the course" in check["detail"]


def test_a_draft_with_no_skills_is_warned_not_waved_through() -> None:
    check, rows = taught_scope(FakeNLI(), [], ["premise"], 0.77)

    assert check["status"] == "warn" and rows == []


def test_the_premises_are_this_concept_and_what_it_builds_on(course) -> None:
    premises = taught_premises(course, LOOPS)

    assert len(premises) > len(material_for(course, LOOPS))


def test_a_feature_the_course_has_not_reached_is_flagged(course) -> None:
    early = (
        "import java.util.*; public class Main { void f() { List<Integer> x = null; x.stream(); } }"
    )

    check = constructs_check(course, "prog.java_intro", early)

    assert check["status"] == "warn" and "streams" in check["detail"]


def test_plain_code_the_course_has_taught_is_not_flagged(course) -> None:
    plain = "import java.util.Scanner; public class Main { public static void main(String[] a) { "
    plain += "Scanner sc = new Scanner(System.in); for (int i = 0; i < 3; i++) { } } }"

    assert constructs_check(course, LOOPS, plain)["status"] == "pass"


def test_a_near_copy_of_an_existing_practical_is_caught() -> None:
    existing = [("a~1", "Read n and print the sum of the even numbers from 1 to n.")]

    copy = duplicate_check("Read n and print the sum of the even numbers from 1 to n!", existing)
    different = duplicate_check("Reverse the characters of a word.", existing)
    similar = duplicate_check("Read n and print the sum of the odd numbers from 1 to n.", existing)

    assert copy["status"] == "fail" and "a~1" in copy["detail"]
    assert different["status"] == "pass"
    assert similar["status"] in ("warn", "fail")
    assert overlap("a b c", "a b c") == 1.0 and overlap("", "a") == 0.0


def test_the_sample_block_does_not_count_towards_similarity() -> None:
    one = "Print the word.\n\nSample input:\n```\nxxxx yyyy zzzz\n```"
    two = "Print the word.\n\nSample input:\n```\n1111 2222 3333\n```"

    assert overlap(one, two) == 1.0


# ------------------------------------------------------------------------------- one draft
def generator(course, provider, nli=None, runner=None) -> DraftGenerator:
    return DraftGenerator(
        course, runner or FakeRunner(lambda stdin: stdin), provider, nli, threshold=0.77
    )


def test_the_sample_output_comes_from_running_the_solution_not_from_the_model(course) -> None:
    provider = ScriptedProvider(reply(), "[]")
    g = generator(course, provider, FakeNLI(), FakeRunner(lambda stdin: "ran: " + stdin))

    draft = g.generate(LOOPS, 4, [])

    assert parse_samples(draft.statement) == [("hi\n", "ran: hi")]
    assert draft.tests[0].expected == "ran: hi"
    assert {c["name"] for c in draft.checks} >= {"compiles", "samples", "taught_scope", "duplicate"}
    assert draft.generation["model_calls"] == 2 and draft.generation["prompt_version"]
    assert len(draft.generation["skills"]) == 3


def test_a_reply_that_is_not_json_is_asked_for_again_once(course) -> None:
    provider = ScriptedProvider("sorry, here you go", reply(), "[]")

    draft = generator(course, provider, FakeNLI()).generate(LOOPS, 4, [])

    assert draft.generation["model_calls"] == 3
    assert "could not be used" in provider.prompts[1]


def test_a_model_that_keeps_replying_badly_raises_instead_of_saving_rubbish(course) -> None:
    provider = ScriptedProvider("nope", "still nope")

    with pytest.raises(ProposalError):
        generator(course, provider, FakeNLI()).generate(LOOPS, 4, [])


def test_a_model_that_is_down_raises_so_the_caller_can_stop(course) -> None:
    with pytest.raises(LLMError):
        generator(course, ScriptedProvider(), FakeNLI()).generate(LOOPS, 4, [])


def test_an_unsafe_solution_is_never_run_and_skips_the_scope_checks(course) -> None:
    runner = FakeRunner(lambda stdin: stdin)
    provider = ScriptedProvider(reply(reference_solution=ECHO + " // new ProcessBuilder()"), "[]")

    draft = generator(course, provider, FakeNLI(), runner).generate(LOOPS, 4, [])

    status = {c["name"]: c["status"] for c in draft.checks}
    assert status["safe_code"] == "fail" and "taught_scope" not in status
    assert runner.calls == 0 and draft.tests == []
    assert parse_samples(draft.statement) == []


def test_a_solution_that_does_not_compile_is_reported_and_has_no_tests(course) -> None:
    provider = ScriptedProvider(reply(reference_solution=ECHO + " COMPILE_ERROR"), "[]")

    draft = generator(course, provider, FakeNLI()).generate(LOOPS, 4, [])

    assert {c["name"]: c["status"] for c in draft.checks}["compiles"] == "fail"
    assert draft.tests == []


def test_without_the_claim_checker_the_scope_check_says_so(course) -> None:
    draft = generator(course, ScriptedProvider(reply(), "[]"), nli=None).generate(LOOPS, 4, [])

    scope = next(c for c in draft.checks if c["name"] == "taught_scope")
    assert scope["status"] == "warn" and "switched off" in scope["detail"]


def test_a_draft_that_repeats_an_existing_practical_is_flagged(course) -> None:
    same = "Read one word and print it back on a line by itself."
    draft = generator(course, ScriptedProvider(reply(), "[]"), FakeNLI()).generate(
        LOOPS, 4, [("loops~1", same)]
    )

    assert next(c for c in draft.checks if c["name"] == "duplicate")["status"] == "fail"


# --------------------------------------------------------------------------------- planning
def author(course, runner=None) -> AuthoringService:
    return AuthoringService(
        InMemoryAssessmentStore(),
        InMemoryPracticalRepository(),
        course,
        runner or FakeRunner(lambda stdin: stdin),
    )


def test_drafts_are_aimed_at_the_concepts_practicals_in_order_and_wrap_around(course) -> None:
    service = author(course)
    places = [
        e.question.question_id.replace("#", "~")
        for e in service.catalog().entries()
        if e.question.concept_id == LOOPS
    ]

    assert service.plan_targets(LOOPS, 2) == places[:2]
    assert service.plan_targets(LOOPS, 5) == (places * 2)[:5]


def test_named_targets_are_used_as_given_and_must_belong_to_the_concept(course) -> None:
    service = author(course)
    one = next(e for e in service.catalog().entries() if e.question.concept_id == LOOPS)
    pid = one.question.question_id.replace("#", "~")
    other = next(e for e in service.catalog().entries() if e.question.concept_id != LOOPS)

    assert service.plan_targets(LOOPS, 1, [pid]) == [pid]
    with pytest.raises(SessionProblem) as caught:
        service.plan_targets(LOOPS, 1, [other.question.question_id.replace("#", "~")])
    assert caught.value.code == "bad_target"


@pytest.mark.parametrize("count", [0, 7])
def test_a_batch_is_between_one_and_six(course, count) -> None:
    with pytest.raises(SessionProblem) as caught:
        author(course).plan_targets(LOOPS, count)

    assert caught.value.code == "bad_count"


def test_a_generated_draft_is_saved_for_review_aimed_at_its_target(course) -> None:
    service = author(course)
    target = service.plan_targets(LOOPS, 1)[0]
    g = generator(course, ScriptedProvider(reply(), "[]"), FakeNLI())

    out = service.generate_one(LECTURER, g, LOOPS, target, "easy one", [], job_id="job-1")

    assert out.origin == "generated" and out.status == "draft" and out.can_approve
    assert out.slot_id == target and out.tests_total == 1
    saved = service.store.get(out.practical_id.replace("~", "#"))
    assert saved.generation["job_id"] == "job-1" and saved.generation["hint"] == "easy one"
    assert saved.created_by == LECTURER

    approved = service.approve(LECTURER, out.practical_id, None)
    assert approved.replaces == target, "approving replaces the practical it was aimed at"
