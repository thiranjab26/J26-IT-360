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


def test_phrasing_rejects_tasks_a_student_cannot_answer_aloud(monkeypatch):
    bank = seed_questions()[0]
    drafts = iter(
        [
            {"question": "You said items stack up. Can you show me in a tiny table how pops work?"},
            {"question": "You said items stack up. If A then B are pushed, which pops first?"},
        ]
    )
    monkeypatch.setattr(providers, "call_llm", lambda *a, **k: next(drafts))
    text, _ = providers.phrase_follow_up(
        bank, "ASK_REASONING_OR_EXAMPLE", None, {"misconceptions": []}, "items stack up", [], set()
    )
    assert "table" not in text


def test_session_history_and_report_list_questions_and_answers(client):
    user = auth(client)
    session = start(client, user)
    answer(client, user, session, "Last in, first out: the newest item is removed first")
    item = client.get("/api/v1/viva/sessions", headers=user).json()["items"][0]
    assert item["answered_count"] == 1 and item["questions_asked"] == 2
    report = client.post(f"/api/v1/viva/sessions/{session['id']}/finish", headers=user).json()
    first = report["transcript"][0]
    assert first["answer"].startswith("Last in") and first["question"] and not first["skipped"]


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
    headers = auth(client)
    session = start(client, headers, max_depth=1)
    response = answer(client, headers, session, "It is last in first out")
    question = response.json()["session"]["current_question"]
    assert question["question"].startswith('You said "It is last in first')
    assert asked == [("PROBE_MISSING_RUBRIC", "It is last in first out")]
    finished = client.post(f"/api/v1/viva/sessions/{session['id']}/finish", headers=headers).json()
    # The plan is the rules' own wording, never reworded by the model.
    assert finished["plan_provider"] == "rule_based" and "plan_summary" not in finished
    assert finished["study_plan"][0]["step"] and finished["study_plan"][0]["reason"]
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


def test_rejected_key_is_skipped_on_later_calls(client, monkeypatch):
    cfg = settings()
    monkeypatch.setattr(cfg, "fallback_llm_base_url", "http://localhost:9/v1")
    monkeypatch.setattr(cfg, "fallback_llm_model", "backup")
    calls = []

    async def post(self, url, **kwargs):
        calls.append(kwargs["json"]["model"])
        status = 401 if kwargs["json"]["model"] == "test-model" else 200
        return httpx.Response(
            status,
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


def test_spoken_commands_only_count_when_said_on_their_own():
    from app.api.v1.routes.sessions import spoken_command

    assert spoken_command("Stop.") == "stop"
    assert spoken_command("End the viva") == "stop"
    assert spoken_command("I don't want to continue") == "stop"
    assert spoken_command("Skip this question") == "skip"
    assert spoken_command("Next question, please") == "skip"
    # An answer that mentions stopping is an answer, not a command.
    long = "The while loop keeps going and it will stop when this condition becomes false, like a counter reaching ten"
    assert spoken_command(long) is None
    assert spoken_command("A stack is last in first out") is None
    # Speech-to-text often mishears "viva".
    assert spoken_command("Stop the diva.") == "stop" and spoken_command("stop the river") == "stop"


def test_every_voice_clip_gets_the_same_median_pitch():
    import io
    import wave

    import numpy as np
    import parselmouth

    from app.integrations.speech import even_pitch

    def clip(hz):
        t = np.arange(0, 1.0, 1 / 16000)
        tone = (0.3 * np.sin(2 * np.pi * hz * t) + 0.1 * np.sin(4 * np.pi * hz * t)) * 32767
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(tone.astype("<i2").tobytes())
        return buffer.getvalue()

    def median(wav):
        with wave.open(io.BytesIO(wav)) as w:
            samples = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2") / 32768
        f0 = parselmouth.Sound(samples, 16000).to_pitch().selected_array["frequency"]
        return float(np.median(f0[f0 > 0]))

    for hz in (140, 190):
        assert abs(median(even_pitch(clip(hz), 160)) - 160) < 5
    assert even_pitch(b"not a wav", 160) == b"not a wav"
    assert even_pitch(clip(140), 0) == clip(140)


def test_gpt_oss_models_are_asked_to_think_briefly(client, monkeypatch):
    sent = []

    async def post(self, url, **kwargs):
        sent.append(kwargs["json"])
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"ok": true}'}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setattr(settings(), "llm_model", "openai/gpt-oss-120b")
    providers.call_llm("openai", "A", {}, {"type": "object"})
    assert sent[0]["reasoning_effort"] == "low"
    monkeypatch.setattr(settings(), "llm_model", "llama-3.3-70b")
    providers.call_llm("openai", "A", {}, {"type": "object"})
    assert "reasoning_effort" not in sent[1]


def test_saying_skip_moves_to_the_next_question(client):
    headers = auth(client)
    session = start(client, headers)
    response = answer(client, headers, session, "Skip this question")
    turn = response.json()["session"]["turns"][-1]
    assert turn["action"] == "SKIPPED_NEXT_CONCEPT"
    assert response.json()["session"]["progress"]["completed_concepts"] == 1


def test_complete_but_hesitant_speech_is_communication_only_in_c():
    from app.domain.logic import differentiate, hesitation

    turn = {
        "assessment": {"state": "complete", "coverage": 100, "misconceptions": []},
        "input_mode": "speech",
        "hesitation": hesitation(
            "um uh I think maybe um it is, it is last in, last in first out",
            "speech",
            4500,
            {"total_pause_ms": 3000, "fluency": {"speaking_time_s": 12}},
        ),
    }
    assert differentiate([turn], "C")[0] == "LIKELY_COMMUNICATION_DIFFICULTY"
    assert differentiate([turn], "B")[0] == "MIXED_INSUFFICIENT_EVIDENCE"
    turn["hesitation"] = hesitation("it is last in first out", "speech", 4500)  # one signal only
    assert differentiate([turn], "C")[0] == "MIXED_INSUFFICIENT_EVIDENCE"


def test_timing_alone_never_gives_communication_for_complete_answer():
    from app.domain.logic import differentiate, hesitation, signal_details

    # The 6 Oct false positive: complete answer, long wait before speaking, slow speech with
    # long pauses (the fluency signal counts), but only one filler and one "sorry".
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
                "fluency": {
                    "speaking_time_s": 34.0,
                    "speech_rate_syll_s": 0.62,
                    "articulation_rate_syll_s": 1.9,
                    "mean_length_of_run_syll": 1.4,
                    "mean_silent_pause_ms": 1173,
                    "silent_pauses": 15,
                    "syllables": 21,
                },
            },
        ),
    }
    assert differentiate([turn], "C")[0] == "MIXED_INSUFFICIENT_EVIDENCE"
    rows = {r["signal"].split(" ")[0]: r for r in signal_details(turn)}
    assert rows["Speed"]["counted"] and not rows["Filler"]["counted"]
    assert rows["Speed"]["value"].startswith("slower or more paused than typical on 4 of 4")
    assert "2 of the 4 speed and pause measures" in rows["Speed"]["threshold"]


def test_clarify_keeps_two_part_questions_and_repeats_are_rejected():
    bank = seed_questions()[0]
    two_parts = "When do you use a for loop? And when do you use a while loop?"
    assert providers.check_phrasing(two_parts, bank, "CLARIFY", None, "", set(), "") is None
    seen = {
        'you said "a while loop always runs once." what happens if the condition is false at the start?'
    }
    again = 'You said "a while loop always runs once." If the condition is false at the start, what happens?'
    problem = providers.check_phrasing(
        again, bank, "PROBE_MISCONCEPTION", None, "while loop", seen, ""
    )
    assert problem and "repeats" in problem


def test_dont_without_apostrophe_asks_for_clarification():
    assert providers.clarification_request("I dont understand the question.")


def test_simulated_high_load_and_low_mastery_shape_the_session(client):
    # Other students cannot simulate: the values are ignored and the viva is normal.
    other = start(
        client, auth(client, code="P07"), simulated_load="high", simulated_mastery="below_50"
    )
    assert (
        other["max_depth"] == 2 and "simulated" not in other["integration_context"]["c02"]["source"]
    )
    headers = auth(client, code="p00")
    easy = start(client, headers, simulated_load="high", simulated_mastery="below_50")
    assert easy["max_depth"] == 1 and easy["current_question"]["total_concepts"] <= 2
    context = easy["integration_context"]
    assert context["c02"]["cognitive_load"] == "high" and context["c01"]["mastery"] == 35
    normal = start(client, headers, simulated_load="moderate", simulated_mastery="above_50")
    assert normal["max_depth"] == 2 and normal["integration_context"]["c01"]["mastery"] == 80
