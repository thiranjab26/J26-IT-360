import httpx
import pytest

from app.api.v1.routes.speech import topic_terms
from app.config import settings
from app.db.session import SessionLocal
from app.integrations import llm as providers
from app.integrations import speech
from tests.conftest import auth


def test_live_transcript_keeps_fillers_and_only_measures_pauses(monkeypatch):
    import numpy as np

    vad = pytest.importorskip("faster_whisper.vad")
    monkeypatch.setattr(settings(), "speech_provider", "disabled")
    monkeypatch.setattr(speech, "decode_bounded", lambda content: np.zeros(64000, dtype=np.float32))
    monkeypatch.setattr(
        vad,
        "get_speech_timestamps",
        lambda *a, **k: [{"start": 8000, "end": 24000}, {"start": 40000, "end": 56000}],
    )
    monkeypatch.setattr(speech, "model", lambda: pytest.fail("Whisper must not run"))
    result = speech.transcribe(b"x", ".webm", ("Um, a stack is LIFO.", "deepgram:nova-3:live"))
    assert result["transcript"] == "Um, a stack is LIFO."
    assert result["provider"] == "deepgram:nova-3:live"
    assert result["lexical_metrics"]["filler_count"] == 1
    assert result["metrics"]["total_pause_ms"] == 1000


def test_deepgram_voice_is_labelled_and_budget_falls_back(client, monkeypatch):
    cfg = settings()
    monkeypatch.setattr(cfg, "allow_cloud_llm", True)
    monkeypatch.setattr(cfg, "deepgram_api_key", "dg-placeholder")
    monkeypatch.setattr(cfg, "speech_api_key", "")
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(200, content=b"mp3", request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", post)
    speech.synthesize.cache_clear()
    headers = auth(client)
    response = client.post(
        "/api/v1/viva/speech/synthesize", headers=headers, json={"text": "What is a stack?"}
    )
    assert response.status_code == 200
    assert response.headers["X-Voice-Provider"] == "deepgram:aura-2-thalia-en"
    assert calls[0][1]["headers"]["Authorization"] == "Token dg-placeholder"
    # Over the character budget: no Deepgram call, and no Groq key, so the browser voice is used.
    monkeypatch.setattr(cfg, "deepgram_tts_daily_chars", 20)
    speech.synthesize.cache_clear()
    with pytest.raises(providers.ProviderUnavailable):
        speech.synthesize("A much longer question than twenty characters?")
    assert len(calls) == 1
    speech.synthesize.cache_clear()


def test_keyterms_are_topic_wide_bounded_and_unique(client):
    with SessionLocal() as db:
        terms = topic_terms(db, "stacks")
    assert terms and len(terms) <= 50 and len(terms) == len(set(terms))
    assert all(4 <= len(t) <= 40 for t in terms)


def test_live_socket_refuses_when_deepgram_is_off(client):
    headers = auth(client)
    token = headers["Authorization"].split()[1]
    with client.websocket_connect("/api/v1/viva/speech/live") as ws:
        ws.send_json({"token": token, "topic_id": "stacks"})
        assert ws.receive_json() == {
            "type": "error",
            "message": "Live transcription is not configured.",
        }
    health = client.get("/api/v1/viva/health").json()
    assert health["live_speech_provider"] is None
