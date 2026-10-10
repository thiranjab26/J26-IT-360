"""Model providers, the tutor's writer, and how a session uses them.

No real model is called: the providers run against httpx's mock transport and the
session tests use a scripted provider. What is checked is the behaviour a student and a
researcher depend on: a failing model never breaks a session, generated text is kept so
a refresh shows the same words, and no answer ever goes into a prompt.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.llm.providers import (
    FallbackChain,
    GeminiProvider,
    Generation,
    LLMError,
    OllamaProvider,
    build_provider,
)
from app.sessions.catalog import UnknownModule, load_course
from app.sessions.service import SessionService
from app.sessions.writer import HINT, TutorWriter, gives_away
from tests.unit.session_support import Clock, InMemorySessionRepository

CONTENT = Path(__file__).resolve().parents[2] / "content"
STUDENT = str(uuid.uuid4())
LOOPS = "prog.loops"


# ------------------------------------------------------------------- providers
def gemini(handler) -> GeminiProvider:
    return GeminiProvider(
        "secret-key", "test-model", client=httpx.Client(transport=httpx.MockTransport(handler))
    )


def test_gemini_sends_the_key_in_a_header_not_the_url_and_reads_the_text() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "Hello "}, {"text": "there"}]}}]},
        )

    result = gemini(handler).generate(system="be kind", prompt="hi")

    assert result.text == "Hello there" and result.provider == "gemini"
    assert seen["key"] == "secret-key" and "secret-key" not in seen["url"]
    assert seen["body"]["systemInstruction"]["parts"][0]["text"] == "be kind"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, text="boom secret-key"),
        httpx.Response(200, json={"candidates": []}),
        httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "  "}]}}]}),
        httpx.Response(200, text="not json"),
    ],
)
def test_gemini_failures_raise_llm_error_without_leaking_the_response(response) -> None:
    with pytest.raises(LLMError) as caught:
        gemini(lambda request: response).generate(system="s", prompt="p")

    assert "secret-key" not in str(caught.value)


def test_gemini_network_failure_is_an_llm_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow")

    with pytest.raises(LLMError, match="unreachable"):
        gemini(handler).generate(system="s", prompt="p")


def test_ollama_reads_the_chat_reply() -> None:
    provider = OllamaProvider(
        "http://localhost:11434/",
        "qwen",
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda r: httpx.Response(200, json={"message": {"content": " hi "}})
            )
        ),
    )

    assert provider.generate(system="s", prompt="p").text == "hi"


class Scripted:
    def __init__(self, name: str, *replies: str | Exception) -> None:
        self.name, self.model = name, f"{name}-model"
        self.replies = list(replies)
        self.prompts: list[str] = []

    def generate(
        self, *, system: str, prompt: str, max_tokens: int = 700, temperature: float = 0.3
    ):
        self.prompts.append(prompt)
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        if isinstance(reply, Exception):
            raise reply
        return Generation(reply, self.name, self.model, 5)


def test_the_chain_falls_back_and_skips_a_provider_that_just_failed() -> None:
    now = [0.0]
    first = Scripted("first", LLMError("down"))
    second = Scripted("second", "from second")
    chain = FallbackChain([first, second], cooldown=60, clock=lambda: now[0])

    assert chain.generate(system="s", prompt="p").text == "from second"
    assert chain.generate(system="s", prompt="p").text == "from second"
    assert len(first.prompts) == 1, "the failed provider is not retried during its cool-down"

    now[0] = 61
    chain.generate(system="s", prompt="p")
    assert len(first.prompts) == 2


def test_the_chain_raises_when_every_provider_fails() -> None:
    chain = FallbackChain([Scripted("a", LLMError("x")), Scripted("b", LLMError("y"))])

    with pytest.raises(LLMError):
        chain.generate(system="s", prompt="p")


def settings(**overrides) -> Settings:
    base = {"DATABASE_URL": "postgresql://x/y", "TUTOR_LLM_PROVIDER": "gemini"}
    return Settings(_env_file=None, **{**base, **overrides})


def test_no_key_means_no_model_and_a_key_means_a_gemini_chain() -> None:
    assert build_provider(settings()) is None

    provider = build_provider(settings(TUTOR_GEMINI_API_KEY="abc"))
    assert provider is not None and provider.name == "gemini"

    both = build_provider(
        settings(TUTOR_GEMINI_API_KEY="abc", TUTOR_LLM_FALLBACK_PROVIDER="ollama")
    )
    assert both.name == "gemini+ollama"


# ---------------------------------------------------------------------- writer
def test_the_writer_returns_none_without_a_model_and_when_the_model_fails() -> None:
    assert TutorWriter(None).write("explain", concept="Loops", passage="p") is None

    failing = TutorWriter(Scripted("g", LLMError("down")))
    assert failing.write("explain", concept="Loops", passage="p") is None


def test_the_prompt_holds_only_the_passage_and_the_question() -> None:
    model = Scripted("g", "an explanation")

    TutorWriter(model).write(HINT, concept="Loops", passage="PASSAGE TEXT", question="STEM TEXT")

    prompt = model.prompts[0]
    assert "PASSAGE TEXT" in prompt and "STEM TEXT" in prompt and "Loops" in prompt


def test_a_hint_that_states_the_output_is_recognised() -> None:
    assert gives_away("It prints 26 at the end.", "26")
    assert not gives_away("Count how often the loop runs.", "26")
    assert not gives_away("There are 126 steps.", "26")
    assert gives_away("The last line is Total: 49", "Count: 3\nTotal: 49")
    assert not gives_away("anything", None)


# ----------------------------------------------------- inside a session service
@pytest.fixture(scope="module")
def course():
    return load_course(CONTENT, "prog")


def make(course, model):
    repo = InMemorySessionRepository()

    def courses(module_id: str):
        if module_id != "prog":
            raise UnknownModule(module_id)
        return course

    service = SessionService(
        repo, courses, clock=Clock(), enforce_unlocks=False, writer=TutorWriter(model)
    )
    return service, repo


def to_teach(service):
    view = service.start(STUDENT, LOOPS)
    return service.cont(STUDENT, view.session_id)


def test_generated_text_is_shown_with_its_source_and_kept_across_views(course) -> None:
    model = Scripted("g", "First wording", "Second wording")
    service, _ = make(course, model)

    teach = to_teach(service)
    again = service.view(STUDENT, teach.session_id)

    assert teach.text == "First wording" and teach.text_source == "generated"
    ref = service.repo.get(teach.session_id).state.current.ref
    assert teach.source_text == course.chunk_text[ref]
    assert again.text == "First wording", "a refresh must not call the model again"
    assert len(model.prompts) == 1


def test_a_failing_model_falls_back_to_the_authored_text_and_stays_that_way(course) -> None:
    service, _ = make(course, Scripted("g", LLMError("down"), "late text"))

    teach = to_teach(service)
    again = service.view(STUDENT, teach.session_id)

    ref = service.repo.get(teach.session_id).state.current.ref
    assert teach.text == course.chunk_text[ref] and teach.text_source == "authored"
    assert teach.source_text is None
    assert again.text == teach.text


def test_without_a_model_a_session_still_works_and_says_authored(course) -> None:
    service, _ = make(course, None)

    teach = to_teach(service)

    assert teach.text_source == "authored"


def test_the_answer_key_never_reaches_a_prompt(course) -> None:
    model = Scripted("g", "words")
    service, _ = make(course, model)
    view = service.start(STUDENT, LOOPS)
    # play through with one miss on each gating question so hints and re-teaches happen
    while view.phase != "ended":
        if view.phase == "checkpoint":
            q = view.question
            entry = course.bank[q.question_id]
            _, key = SessionService._presented(view.session_id, entry)
            right = key.correct_option or key.expected_output or ""
            view = service.answer(
                STUDENT,
                view.session_id,
                "definitely not it" if q.gating and q.attempt <= 2 else right,
            )
        else:
            view = service.cont(STUDENT, view.session_id)

    assert model.prompts, "the model should have been used"
    keys = [e.key for e in course.bank.values() if e.question.concept_id == LOOPS]
    for prompt in model.prompts:
        for key in keys:
            if key.explanation:
                assert key.explanation not in prompt
            if key.reference_solution:
                assert key.reference_solution not in prompt


def test_a_hint_that_gives_the_answer_is_replaced_by_the_generic_one(course) -> None:
    service, _ = make(course, None)
    view = service.start(STUDENT, LOOPS)
    while not (view.phase == "checkpoint" and view.question.gating):
        view = (
            service.answer(
                STUDENT,
                view.session_id,
                SessionService._presented(view.session_id, course.bank[view.question.question_id])[
                    1
                ].correct_option,
            )
            if view.phase == "checkpoint"
            else service.cont(STUDENT, view.session_id)
        )
    expected = course.bank[view.question.question_id].key.expected_output
    leaky = Scripted("g", f"Just print {expected}")
    service.writer = TutorWriter(leaky)

    service.answer(STUDENT, view.session_id, "definitely not it")
    retry = service.cont(STUDENT, view.session_id)

    assert retry.question.hint_source == "authored"
    assert expected not in (retry.question.hint or "").split()
