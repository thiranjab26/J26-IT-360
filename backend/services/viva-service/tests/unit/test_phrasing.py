import httpx
import pytest

from app.api.v1.routes import sessions as api_main
from app.config import settings
from app.domain.seed import seed_questions
from app.integrations import llm as providers
from tests.conftest import answer, auth, start


def test_failover_to_fallback_provider(client, monkeypatch):
    cfg = settings()
    monkeypatch.setattr(
        cfg, "llm_base_url", "https://generativelanguage.googleapis.com/v1beta/openai"
    )
    monkeypatch.setattr(cfg, "allow_cloud_llm", True)
    monkeypatch.setattr(cfg, "fallback_llm_base_url", "https://api.groq.com/openai/v1")
    monkeypatch.setattr(cfg, "fallback_llm_model", "openai/gpt-oss-120b")
    monkeypatch.setattr(cfg, "fallback_llm_api_key", "groq-placeholder")
    calls = []

    async def post(self, url, **kwargs):
        calls.append((url, kwargs))
        if "googleapis" in url:
            return httpx.Response(
                503, json={"error": {"message": "high demand"}}, request=httpx.Request("POST", url)
            )
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"ok": true}'}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    assert providers.call_llm("openai", "Assess", {}, {"type": "object"}) == {"ok": True}
    assert len(calls) == 2 and "groq" in calls[1][0]
    assert calls[1][1]["headers"]["Authorization"] == "Bearer groq-placeholder"
    assert calls[1][1]["json"]["temperature"] == 0


def test_phrasing_rejects_leaked_answer_then_accepts(monkeypatch):
    bank = seed_questions()[0]  # LIFO
    target = bank["rubric_points"][1]  # example: B removed first
    drafts = iter(
        [
            {"question": "You said items stack up; so is b first when you pop?"},
            {
                "question": "You mentioned items stacking up. If A then B were pushed, what would two pops return?"
            },
        ]
    )
    monkeypatch.setattr(providers, "call_llm", lambda *a, **k: next(drafts))
    text, _ = providers.phrase_follow_up(
        bank,
        "PROBE_MISSING_RUBRIC",
        target,
        {"misconceptions": []},
        "Items stack up and the last one goes out first",
        [],
        set(),
    )
    assert text.startswith("You mentioned items stacking up")


def test_phrasing_gives_up_after_two_bad_drafts(monkeypatch):
    bank = seed_questions()[0]
    monkeypatch.setattr(
        providers,
        "call_llm",
        lambda *a, **k: {"question": "Tell me more about that. And why? And how?"},
    )
    with pytest.raises(ValueError):
        providers.phrase_follow_up(
            bank, "ASK_REASONING_OR_EXAMPLE", None, {"misconceptions": []}, "stack", [], set()
        )


def test_session_uses_llm_follow_up_and_plan_with_audit(client, monkeypatch):
    monkeypatch.setattr(settings(), "assessment_provider", "openai")
    monkeypatch.setattr(
        api_main, "assess", lambda q, p, t, prior, plans=None: providers.demo_assess(q, t, [])
    )
    asked = []

    def phrase(bank, action, target, assessment, transcript, history, seen):
        asked.append((action, transcript))
        return (
            f'You said "{transcript[:20]}". Can you walk me through that with an example?',
            "openai:test-model:json_schema",
        )

    monkeypatch.setattr(api_main, "phrase_follow_up", phrase)
    monkeypatch.setattr(
        api_main,
        "improvement_plan",
        lambda report, data: (
            {"summary": "Personal summary for you.", "steps": ["Step one.", "Step two."]},
            "openai:test-model:json_schema",
        ),
    )
    headers = auth(client)
    session = start(client, headers, max_depth=1)
    response = answer(client, headers, session, "It is last in first out")
    question = response.json()["session"]["current_question"]
    assert question["question"].startswith('You said "It is last in first')
    assert asked == [("PROBE_MISSING_RUBRIC", "It is last in first out")]
    finished = client.post(f"/api/v1/viva/sessions/{session['id']}/finish", headers=headers).json()
    assert finished["improvement_plan"] == ["Step one.", "Step two."] and finished[
        "plan_provider"
    ].startswith("openai")
    exported = client.get(f"/api/v1/viva/sessions/{session['id']}/export", headers=headers).json()
    turn = exported["session"]["turns"][0]
    assert (
        turn["follow_up_phrasing"]["source"].startswith("openai")
        and turn["follow_up_phrasing"]["stored_prompt"]
    )


def test_phrasing_failure_keeps_session_running(client, monkeypatch):
    monkeypatch.setattr(settings(), "assessment_provider", "openai")
    monkeypatch.setattr(
        api_main, "assess", lambda q, p, t, prior, plans=None: providers.demo_assess(q, t, [])
    )

    def down(*a):
        raise providers.ProviderUnavailable("all providers down")

    monkeypatch.setattr(api_main, "phrase_follow_up", down)
    headers = auth(client)
    session = start(client, headers)
    response = answer(client, headers, session, "It is last in first out")
    assert response.status_code == 200
    exported_turn = client.get(f"/api/v1/viva/sessions/{session['id']}", headers=headers).json()
    assert exported_turn["current_question"]["depth"] == 1


def test_rate_limited_endpoint_is_skipped_during_cooldown(client, monkeypatch):
    cfg = settings()
    monkeypatch.setattr(cfg, "fallback_llm_base_url", "http://localhost:9/v1")
    monkeypatch.setattr(cfg, "fallback_llm_model", "backup")
    calls = []

    async def post(self, url, **kwargs):
        calls.append(kwargs["json"]["model"])
        if kwargs["json"]["model"] == "test-model":
            return httpx.Response(
                429, headers={"Retry-After": "30"}, request=httpx.Request("POST", url)
            )
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"ok": true}'}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    providers.call_llm("openai", "A", {}, {"type": "object"})
    providers.call_llm("openai", "A", {}, {"type": "object"})
    assert calls == ["test-model", "backup", "backup"]


def test_combined_call_supplies_follow_up_without_second_call(client, monkeypatch):
    monkeypatch.setattr(settings(), "assessment_provider", "openai")

    def assess(q, p, t, prior, plans=None):
        result = providers.demo_assess(q, t, [])
        assert plans["by_state"]["partial"]["action"] == "PROBE_MISSING_RUBRIC"
        result["_draft"] = {
            "question": "You said last in first out. If you push A and then B, what do two pops return?",
            "target_rubric_id": "example",
        }
        return result

    monkeypatch.setattr(api_main, "assess", assess)
    monkeypatch.setattr(
        api_main, "phrase_follow_up", lambda *a: pytest.fail("second LLM call not needed")
    )
    headers = auth(client)
    session = start(client, headers)
    question = answer(client, headers, session, "It is last in first out").json()["session"][
        "current_question"
    ]
    assert question["question"].startswith("You said last in first out")


def test_clear_non_answers_are_deterministic():
    assert not providers.clear_non_answer("No.")  # can answer a yes/no probe
    for text in ("i dont know", "uhhh ummm sooo umm mmmm idk maybe i think", "", "Um, not sure"):
        assert providers.clear_non_answer(text), text
    assert not providers.clear_non_answer("a stack is last in first out")


def test_skip_moves_on_and_is_not_a_knowledge_gap(client):
    headers = auth(client)
    session = start(client, headers)
    response = answer(client, headers, session, "", skip=True)
    assert response.status_code == 200 and response.json()["action"] == "SKIPPED_NEXT_CONCEPT"
    assert response.json()["session"]["current_question"]["ordinal"] == 2
    report = client.post(f"/api/v1/viva/sessions/{session['id']}/finish", headers=headers).json()
    assert report["concepts"][0]["outcome"] == "MIXED_INSUFFICIENT_EVIDENCE"


def test_student_can_stop_by_saying_so(client):
    headers = auth(client)
    session = start(client, headers)
    response = answer(client, headers, session, "I don't want to answer, please stop the session")
    assert (
        response.json()["action"] == "STUDENT_ENDED_SESSION"
        and response.json()["session"]["status"] == "completed"
    )


def test_complete_but_hesitant_speech_is_communication_only_in_c():
    from app.domain.logic import differentiate, hesitation

    turn = {
        "assessment": {"state": "complete", "coverage": 100, "misconceptions": []},
        "input_mode": "speech",
        "hesitation": hesitation(
            "um uh I think maybe um it is last in first out",
            "speech",
            4500,
            {"total_pause_ms": 3000},
        ),
    }
    assert differentiate([turn], "C")[0] == "LIKELY_COMMUNICATION_DIFFICULTY"
    assert differentiate([turn], "B")[0] == "MIXED_INSUFFICIENT_EVIDENCE"
    turn["hesitation"] = hesitation("it is last in first out", "speech", 4500)  # one signal only
    assert differentiate([turn], "C")[0] == "MIXED_INSUFFICIENT_EVIDENCE"


def test_timing_alone_never_gives_communication_for_complete_answer():
    from app.domain.logic import differentiate, hesitation, signal_details

    # The 6 Oct false positive: complete answer, long wait before speaking, normal ~1.1 s pauses, one filler.
    turn = {
        "assessment": {"state": "complete", "coverage": 100, "misconceptions": []},
        "input_mode": "speech",
        "hesitation": hesitation(
            "we have, uh, non-volatile and volatile memory, sorry, once the power is off",
            "speech",
            110661,
            {
                "pause_count": 15,
                "total_pause_ms": 17600,
                "average_pause_ms": 1173,
                "long_pause_count": 1,
                "audio_duration_ms": 36840,
            },
        ),
    }
    assert differentiate([turn], "C")[0] == "MIXED_INSUFFICIENT_EVIDENCE"
    rows = {r["signal"].split(" ")[0]: r for r in signal_details(turn)}
    assert rows["Delay"]["counted"] and not rows["Pauses"]["counted"]
