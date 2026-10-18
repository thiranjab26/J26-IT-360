"""Live explanations: written for each student when wanted, never shared, with limits on trying.

Covers the retry rules (give up after 3 blocked texts or 5 model failures, at once if the day's
quota is gone), the providers' part in it, the settings, and what a student is shown when the
writer gives up. The model, the checker and the clock are all faked.
"""

from __future__ import annotations

import threading
import time
import uuid
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.llm.providers import (
    FallbackChain,
    GeminiProvider,
    Generation,
    LLMError,
    LLMQuotaError,
    build_provider,
)
from app.sessions.catalog import UnknownModule, load_course
from app.sessions.grounding import primary_only
from app.sessions.repository import CachedExplanation, StoredText
from app.sessions.service import SessionService
from app.sessions.writer import EXPLAIN, HINT, RetryPolicy, TutorWriter
from app.verification.claims import SentenceDecomposer
from app.verification.fill import Filler, Outcome
from app.verification.gate import FaithfulnessGate
from tests.unit.session_support import Clock, InMemorySessionRepository
from tests.unit.test_verification import Replies, ScriptedNLI

CONTENT = Path(__file__).resolve().parents[2] / "content"
DB = "postgresql://user:pw@localhost/db"

GOOD = "A loop repeats code. The update runs last."
# Both sentences unsupported, so the step that cuts them has nothing left to keep.
ALL_BAD = "The body always runs once. A loop never ends."
# Long enough that cutting one sentence still leaves a real explanation (the cutting step
# refuses to leave fewer than 40 words), with one sentence the checker will reject.
SUPPORTED = (
    "A loop repeats a block of code many times. Each pass through the body is called an "
    "iteration. The condition is checked before every single pass. When the condition becomes "
    "false the loop stops and the program carries on. The update step usually changes the "
    "counter variable at the end of each pass. A for loop keeps its start, test and update on "
    "one line. A while loop keeps only the test in its header. Careful loops always make sure "
    "the test can eventually become false."
)
HALF_BAD = SUPPORTED + " The body always runs once."
UNSUPPORTED = {"always": 0.0, "never": 0.0}


@pytest.fixture(scope="module")
def course():
    return load_course(CONTENT, "prog")


def live_writer(model, nli=None, *, sleeps=None, blocks=3, failures=5, kinds=(EXPLAIN, HINT)):
    policy = RetryPolicy(
        max_blocks=blocks,
        max_failures=failures,
        backoff=1.0,
        sleep=(sleeps.append if sleeps is not None else (lambda _: None)),
    )
    gate = FaithfulnessGate(
        nli or ScriptedNLI(UNSUPPORTED), threshold=0.3, decomposer=SentenceDecomposer()
    )
    return TutorWriter(model, gate, gated_kinds=kinds, policy=policy)


def write(model, **kwargs):
    return live_writer(model, **kwargs).write(EXPLAIN, concept="Loops", passage="p")


# ------------------------------------------------------------------- blocked texts
def test_a_text_that_passes_first_time_costs_one_call() -> None:
    model = Replies(GOOD)

    result = write(model)

    assert result.generated.text == GOOD and result.generated.verified is True
    assert len(model.prompts) == 1 and result.reason == ""


def test_the_writer_keeps_trying_until_a_text_passes_within_three_blocks() -> None:
    model = Replies(ALL_BAD, ALL_BAD, GOOD)

    result = write(model)

    assert result.generated.text == GOOD
    assert len(model.prompts) == 3 and len(result.audits) == 3
    assert "NOT supported" in model.prompts[1] and "NOT supported" in model.prompts[2]


def test_after_three_blocked_texts_it_gives_up_and_says_the_gate_was_why() -> None:
    model = Replies(ALL_BAD)  # the last reply repeats

    result = write(model)

    assert result.generated is None and result.blocked is True and result.reason == "blocked"
    assert len(model.prompts) == 3 and len(result.audits) == 3


def test_the_limit_on_blocked_texts_can_be_changed() -> None:
    model = Replies(ALL_BAD)

    result = write(model, blocks=5)

    assert len(model.prompts) == 5 and result.reason == "blocked"


def test_cutting_the_failing_sentence_is_part_of_the_round_and_can_save_it() -> None:
    model = Replies(HALF_BAD)

    result = write(model)

    assert "always runs once" not in result.generated.text
    assert result.generated.text.startswith("A loop repeats a block") and result.generated.verified
    assert len(model.prompts) == 1, "no second model call was needed"
    assert len(result.audits) == 2, "the original and the cut text were both checked and logged"


def test_a_round_that_is_cut_and_still_fails_counts_as_one_block_not_two() -> None:
    nli = ScriptedNLI({"update": 0.0, "always": 0.0})  # what is left after cutting also fails
    model = Replies(HALF_BAD)

    result = write(model, nli=nli)

    assert len(model.prompts) == 3, "three rounds, each with its own cut-and-recheck"
    assert result.reason == "blocked"


# ------------------------------------------------------------------- model failures
def test_a_failing_model_is_retried_with_a_growing_pause_then_succeeds() -> None:
    sleeps: list[float] = []
    model = Replies(LLMError("a"), LLMError("b"), LLMError("c"), LLMError("d"), GOOD)

    result = write(model, sleeps=sleeps)

    assert result.generated.text == GOOD and len(model.prompts) == 5
    assert sleeps == [1.0, 2.0, 4.0, 8.0]


def test_five_failures_stop_it_without_blaming_the_gate() -> None:
    sleeps: list[float] = []
    model = Replies(LLMError("down"))

    result = write(model, sleeps=sleeps)

    assert result.generated is None and result.blocked is False and result.reason == "failures"
    assert len(model.prompts) == 5
    assert sleeps == [1.0, 2.0, 4.0, 8.0], "no pause after the last try"


def test_an_empty_or_over_long_reply_counts_as_a_failure() -> None:
    model = Replies("", "x" * 5000, GOOD)

    result = write(model)

    assert result.generated.text == GOOD and len(model.prompts) == 3


def test_blocks_and_failures_are_counted_separately() -> None:
    model = Replies(ALL_BAD, LLMError("x"), ALL_BAD, LLMError("y"), LLMError("z"), GOOD)

    result = write(model)  # two blocks and three failures: both below their limits

    assert result.generated.text == GOOD and len(model.prompts) == 6


def test_a_used_up_daily_quota_stops_at_once_with_no_pause() -> None:
    sleeps: list[float] = []
    model = Replies(LLMQuotaError("quota"))

    result = write(model, sleeps=sleeps)

    assert result.generated is None and result.reason == "quota" and result.blocked is False
    assert len(model.prompts) == 1 and sleeps == []


def test_a_checker_that_breaks_fails_closed_without_asking_the_model_again() -> None:
    class Broken:
        name = "broken"

        def score(self, pairs):
            raise RuntimeError("boom")

    model = Replies(GOOD)

    result = write(model, nli=Broken())

    assert result.generated is None and result.blocked is True and result.reason == "gate_error"
    assert len(model.prompts) == 1


def test_text_the_gate_does_not_cover_is_returned_unchecked_but_still_retried() -> None:
    model = Replies(LLMError("x"), GOOD)
    result = live_writer(model, kinds=()).write(EXPLAIN, concept="Loops", passage="p")

    assert result.generated.text == GOOD and result.generated.verified is None
    assert len(model.prompts) == 2


def test_without_a_policy_the_writer_still_makes_one_try_and_one_rewrite() -> None:
    model = Replies(ALL_BAD)
    gate = FaithfulnessGate(
        ScriptedNLI(UNSUPPORTED), threshold=0.3, decomposer=SentenceDecomposer()
    )

    result = TutorWriter(model, gate).write(EXPLAIN, concept="Loops", passage="p")

    assert len(model.prompts) == 2 and result.blocked is True and result.reason == ""


# --------------------------------------------------------------------------- providers
def test_a_provider_that_is_out_of_quota_makes_the_chain_say_so() -> None:
    class OutOfQuota:
        name, model = "a", "m"

        def generate(self, **_):
            raise LLMQuotaError("used up")

    class Down:
        name, model = "b", "m"

        def generate(self, **_):
            raise LLMError("down")

    with pytest.raises(LLMQuotaError):
        FallbackChain([OutOfQuota()], cooldown=0).generate(system="s", prompt="p")
    with pytest.raises(LLMError) as mixed:
        FallbackChain([OutOfQuota(), Down()], cooldown=0).generate(system="s", prompt="p")
    assert not isinstance(mixed.value, LLMQuotaError), "one provider is merely down"


def test_with_a_provider_still_in_reserve_a_quota_error_is_not_final() -> None:
    class OutOfQuota:
        name, model = "a", "m"

        def generate(self, **_):
            raise LLMQuotaError("used up")

    class Works:
        name, model = "b", "m"

        def generate(self, **_):
            return Generation("fine", "b", "m", 1)

    assert FallbackChain([OutOfQuota(), Works()]).generate(system="s", prompt="p").text == "fine"


def gemini(status: int, body: str) -> GeminiProvider:
    transport = httpx.MockTransport(lambda request: httpx.Response(status, text=body))
    return GeminiProvider("key", "model", client=httpx.Client(transport=transport))


def test_only_a_daily_gemini_quota_is_treated_as_final() -> None:
    with pytest.raises(LLMQuotaError):
        gemini(429, '{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}').generate(
            system="s", prompt="p"
        )
    with pytest.raises(LLMError) as per_minute:
        gemini(429, '{"quotaId": "GenerateRequestsPerMinutePerProjectPerModel"}').generate(
            system="s", prompt="p"
        )
    assert not isinstance(per_minute.value, LLMQuotaError)
    with pytest.raises(LLMError) as busy:
        gemini(503, "overloaded").generate(system="s", prompt="p")
    assert not isinstance(busy.value, LLMQuotaError)


def test_the_error_message_never_repeats_what_the_service_sent_back() -> None:
    with pytest.raises(LLMQuotaError) as caught:
        gemini(429, "PerDay secret-detail-from-google").generate(system="s", prompt="p")

    assert "secret-detail" not in str(caught.value)


def test_live_mode_does_not_set_a_failed_provider_aside_but_cached_mode_still_does() -> None:
    def chain(**env):
        return build_provider(
            Settings(DATABASE_URL=DB, _env_file=None, TUTOR_GEMINI_API_KEY="k", **env)
        )

    assert chain()._cooldown == 0.0
    assert chain(TUTOR_EXPLANATION_MODE="live")._cooldown == 0.0
    assert chain(TUTOR_EXPLANATION_MODE="cached")._cooldown == 60.0


# ---------------------------------------------------------------------------- settings
def test_live_is_the_default_with_the_limits_the_client_asked_for() -> None:
    s = Settings(DATABASE_URL=DB, _env_file=None)

    assert s.explanation_mode == "live"
    assert (s.llm_max_failures, s.gate_max_blocks) == (5, 3)
    assert s.failure_memory_seconds == 1800 and s.fill_wait_seconds == 240


def test_the_switch_back_to_cached_is_one_line_and_forgives_case_and_spaces() -> None:
    assert (
        Settings(
            DATABASE_URL=DB, _env_file=None, TUTOR_EXPLANATION_MODE=" Cached "
        ).explanation_mode
        == "cached"
    )
    assert (
        Settings(DATABASE_URL=DB, _env_file=None, TUTOR_EXPLANATION_MODE="LIVE").explanation_mode
        == "live"
    )


@pytest.mark.parametrize("bad", ["prebuilt", "", "both"])
def test_an_unknown_mode_is_refused_instead_of_guessed(bad: str) -> None:
    with pytest.raises(ValidationError):
        Settings(DATABASE_URL=DB, _env_file=None, TUTOR_EXPLANATION_MODE=bad)


@pytest.mark.parametrize("name", ["TUTOR_LLM_MAX_FAILURES", "TUTOR_GATE_MAX_BLOCKS"])
def test_the_limits_must_allow_at_least_one_try(name: str) -> None:
    with pytest.raises(ValidationError):
        Settings(DATABASE_URL=DB, _env_file=None, **{name: "0"})


# ---------------------------------------------------------------------------- the filler
def test_live_jobs_are_per_session_so_two_students_never_share_one() -> None:
    seen: list[tuple] = []
    release = threading.Event()

    def work(*key) -> Outcome:
        seen.append(key)
        release.wait(5)
        return Outcome("built")

    filler = Filler(work)
    filler.prefetch("explain", "prog", "p1", ("s-ann", "teach:p1"))
    filler.prefetch("explain", "prog", "p1", ("s-ann", "teach:p1"))  # same session: joined
    filler.prefetch("explain", "prog", "p1", ("s-ben", "teach:p1"))  # another student: own job
    for _ in range(100):
        if len(seen) >= 2:
            break
        time.sleep(0.02)
    running = sorted(seen)  # looked at while both are still held, so none has been restarted
    release.set()

    assert filler.wait("explain", "prog", "p1", 5, ("s-ann", "teach:p1")) is True
    assert filler.wait("explain", "prog", "p1", 5, ("s-ben", "teach:p1")) is True
    assert running == [
        ("explain", "prog", "p1", "s-ann", "teach:p1"),
        ("explain", "prog", "p1", "s-ben", "teach:p1"),
    ]


def test_a_cached_job_still_gets_only_the_three_arguments_it_always_did() -> None:
    seen: list[tuple] = []
    filler = Filler(lambda *key: seen.append(key) or Outcome("built"))

    filler.wait("explain", "prog", "p1", 5)

    assert seen == [("explain", "prog", "p1")]


def test_a_passage_the_gate_rejected_is_left_alone_for_every_student() -> None:
    runs: list[tuple] = []

    def work(*key) -> Outcome:
        runs.append(key)
        return Outcome("blocked", 3)

    filler = Filler(work, blocked_memory=1000)
    filler.wait("explain", "prog", "p1", 5, ("s-ann", "k"))

    assert filler.failure_reason("explain", "prog", "p1") == "blocked"
    assert filler.start("explain", "prog", "p1", ("s-ben", "k")) is None
    assert len(runs) == 1, "Ben does not start the same three rounds again"
    assert filler.failure_reason("explain", "prog", "p2") is None


def test_how_long_a_failure_is_remembered_depends_on_why_it_failed() -> None:
    outcomes = iter(["blocked", "failed", "quota"])
    filler = Filler(
        lambda *key: Outcome(next(outcomes)),
        blocked_memory=1000,
        failed_memory=0,  # a model that was unreachable is tried again straight away
        quota_memory=500,
    )

    for passage in ("a", "b", "c"):
        filler.wait("explain", "prog", passage, 5)

    assert filler.failure_reason("explain", "prog", "a") == "blocked"
    assert filler.failure_reason("explain", "prog", "b") is None
    assert filler.failure_reason("explain", "prog", "c") == "quota"


def test_the_original_filler_remembers_every_failure_for_ten_minutes() -> None:
    filler = Filler(lambda *key: Outcome("failed"))

    filler.wait("explain", "prog", "p", 5)

    assert filler.failure_reason("explain", "prog", "p") == "failed"
    assert Filler.RETRY_AFTER == 600.0


# ---------------------------------------------------------------------------- the service
STUDENT = str(uuid.uuid4())
OTHER = str(uuid.uuid4())


def live_service(course, outcome: str = "built", *, writer=None, repo=None, filler=True):
    """A live-mode service whose background jobs are faked, as the real ones are in production:
    a job stores its text with the session it was started for."""
    repo = repo or InMemorySessionRepository()
    started: list[tuple] = []

    def work(kind, module, passage_id, session_id=None, text_key=None) -> Outcome:
        started.append((kind, passage_id, session_id, text_key))
        if outcome == "built" and session_id is not None:
            ground = primary_only(course, passage_id)
            repo.put_text(
                session_id,
                text_key,
                StoredText(
                    f"AI text for session {session_id[:6]} on {passage_id}",
                    "generated",
                    "gemini",
                    "m",
                    True,
                    None,
                    [s.as_json() for s in ground.sources],
                ),
            )
        return Outcome(outcome, 1)

    def courses(module_id: str):
        if module_id != "prog":
            raise UnknownModule(module_id)
        return course

    the_writer = writer or TutorWriter(
        Replies("unused"),
        FaithfulnessGate(ScriptedNLI(), threshold=0.3, decomposer=SentenceDecomposer()),
    )
    service = SessionService(
        repo,
        courses,
        clock=Clock(),
        enforce_unlocks=False,
        writer=the_writer,
        filler=Filler(work, blocked_memory=1000, failed_memory=1000) if filler else None,
        fill_wait=5,
        live=True,
    )
    return service, repo, started


def first_part(service, student=STUDENT):
    view = service.start(student, "prog.loops")
    return view, service.cont(student, view.session_id)


def test_a_live_click_shows_the_text_written_for_that_student(course) -> None:
    service, _, started = live_service(course)

    view, teach = first_part(service)

    assert teach.text.startswith(f"AI text for session {view.session_id[:6]}")
    assert teach.text_source == "generated" and teach.text_check == "verified"
    assert any(job[2] == view.session_id for job in started)


def test_live_mode_ignores_the_shared_prebuilt_cache(course) -> None:
    repo = InMemorySessionRepository()
    service, _, _ = live_service(course, repo=repo)
    probe = service.start(STUDENT, "prog.loops")
    passage = next(
        s.ref for s in service.repo.get(probe.session_id).state.steps if s.kind == "teach"
    )
    ground = primary_only(course, passage)
    fingerprint = service.writer.cache_fingerprint(EXPLAIN)
    repo.put_verified(
        passage, ground.digest, fingerprint, CachedExplanation("PREBUILT SHARED TEXT", "g", "m")
    )

    teach = service.cont(STUDENT, probe.session_id)

    assert "PREBUILT SHARED TEXT" not in teach.text
    assert teach.text.startswith("AI text for session")


def test_live_mode_never_writes_the_shared_cache(course) -> None:
    service, repo, _ = live_service(
        course, filler=False, writer=live_writer(Replies(GOOD), ScriptedNLI())
    )

    view = service.start(STUDENT, "prog.loops")
    teach = service.cont(STUDENT, view.session_id)

    assert teach.text_source == "generated" and teach.text_check == "verified"
    assert repo.verified == {}, "nothing is kept for another student to be given"


def test_two_students_on_the_same_part_each_get_their_own_text(course) -> None:
    service, repo, started = live_service(course)

    ann_view, ann = first_part(service, STUDENT)
    ben_view, ben = first_part(service, OTHER)

    assert ann.text != ben.text
    assert ann.text.startswith(f"AI text for session {ann_view.session_id[:6]}")
    assert ben.text.startswith(f"AI text for session {ben_view.session_id[:6]}")
    sessions = {job[2] for job in started}
    assert {ann_view.session_id, ben_view.session_id} <= sessions
    assert repo.verified == {}


def test_while_a_part_is_read_the_next_is_prepared_for_that_session_only(course) -> None:
    service, _, started = live_service(course)

    view = service.start(STUDENT, "prog.loops")  # the hook screen: part one is prepared meanwhile
    for _ in range(50):
        if started:
            break
        time.sleep(0.05)

    kind, passage, session_id, text_key = started[0]
    assert kind == "explain" and session_id == view.session_id
    assert text_key == f"teach:{passage}", "stored where the click will look"


def test_a_part_the_gate_kept_rejecting_shows_the_course_text_and_says_so(course) -> None:
    service, repo, _ = live_service(course, "blocked")
    view = service.start(STUDENT, "prog.loops")

    teach = service.cont(STUDENT, view.session_id)

    assert teach.text_source == "authored" and teach.text_check == "blocked"
    again = service.view(STUDENT, view.session_id)
    assert again.text == teach.text, "what the student saw never changes under them"


def test_the_next_student_at_a_rejected_part_gets_the_course_text_without_waiting(course) -> None:
    service, _, started = live_service(course, "blocked")
    _, first = first_part(service, STUDENT)
    rejected = "prog.loops#theory-01"

    _, second = first_part(service, OTHER)

    assert first.text_check == second.text_check == "blocked"
    jobs = [job for job in started if job[1] == rejected]
    assert len(jobs) == 1, "no second job for a passage that was just rejected"


def test_a_model_that_could_not_be_reached_is_not_blamed_on_the_text(course) -> None:
    service, _, _ = live_service(course, "failed")
    view = service.start(STUDENT, "prog.loops")

    teach = service.cont(STUDENT, view.session_id)

    assert teach.text_source == "authored"
    assert teach.text_check is None, "the course text, with no claim that the wording was rejected"


def test_a_used_up_quota_also_falls_back_to_the_course_text(course) -> None:
    service, _, _ = live_service(course, "quota")
    view = service.start(STUDENT, "prog.loops")

    teach = service.cont(STUDENT, view.session_id)

    assert teach.text_source == "authored" and teach.text_check is None


def test_hints_follow_the_same_retry_rules_in_live_mode(course) -> None:
    model = Replies(ALL_BAD)  # never passes
    service, _, _ = live_service(course, writer=live_writer(model, ScriptedNLI(UNSUPPORTED)))
    view = service.start(STUDENT, "prog.loops")

    result = service.writer.write(HINT, concept="Loops", passage="p", question="q")

    assert result.reason == "blocked" and len(model.prompts) == 3
    assert view.session_id
