import io
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import httpx
import pytest
from fastapi import HTTPException
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from app.config import settings
from app.core import limits
from app.db.repositories.materials import extract_material, validate_grounding
from app.db.session import SessionLocal
from app.db.tables import Bank, Material, UsageCounter
from app.domain.disfluency import lexical_metrics
from app.domain.seed import seed_questions
from app.integrations import llm as providers
from app.integrations import speech
from tests.conftest import answer, auth, start

NOTES = "A stack follows last-in, first-out order. Push adds to the top. Pop removes from the top."


def create_course(client, headers):
    response = client.post(
        "/api/v1/viva/courses",
        headers=headers,
        json={"name": "Stack design", "description": "Operations and ordering"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_course_text_upload_permissions_duplicate_and_context(client):
    admin, learner = auth(client, "admin"), auth(client)
    assert (
        client.post("/api/v1/viva/courses", headers=learner, json={"name": "Blocked"}).status_code
        == 403
    )
    course_id = create_course(client, admin)
    path = f"/api/v1/viva/courses/{course_id}/materials/text"
    first = client.post(path, headers=admin, json={"name": "notes", "text": NOTES})
    assert first.status_code == 201
    duplicate = client.post(path, headers=admin, json={"name": "same notes", "text": NOTES}).json()
    assert duplicate["duplicate"] and duplicate["id"] == first.json()["id"]
    context = client.get(
        f"/api/v1/viva/integrations/context?topic_id={course_id}", headers=learner
    ).json()
    assert context["c03"]["chunks"][0]["text"] == NOTES
    assert context["c03"]["chunks"][0]["chunk_id"]
    assert (
        client.post(
            "/api/v1/viva/bank/generate", headers=admin, json={"topic_id": course_id}
        ).status_code
        == 503
    )
    assert any(t["id"] == course_id for t in client.get("/api/v1/viva/topics").json()["items"])
    preview = f"/api/v1/viva/courses/{course_id}/materials/{first.json()['id']}"
    assert client.get(preview, headers=learner).status_code == 403
    assert client.get(preview, headers=admin).json()["chunks"][0]["text"] == NOTES


def pdf_bytes(text=NOTES):
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    stream = DecodedStreamObject()
    stream.set_data(f"BT /F1 12 Tf 50 700 Td ({text}) Tj ET".encode())
    page[NameObject("/Contents")] = writer._add_object(stream)
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()


def test_pdf_ingestion_provenance_and_rejections(client):
    headers = auth(client, "admin")
    course = create_course(client, headers)
    path = f"/api/v1/viva/courses/{course}/materials"
    response = client.post(
        path, headers=headers, files={"file": ("notes.pdf", pdf_bytes(), "application/pdf")}
    )
    assert response.status_code == 201, response.text
    with SessionLocal() as db:
        item = db.get(Material, response.json()["id"])
        assert item.chunks[0]["page"] == 1 and "Push adds" in item.chunks[0]["text"]
    for name, content, code in [
        ("bad.pdf", b"not a pdf", 422),
        ("bad.exe", b"x", 415),
        ("bad.txt", b"\xff", 422),
        ("scan.pdf", pdf_bytes(""), 422),
    ]:
        assert (
            client.post(path, headers=headers, files={"file": (name, content)}).status_code == code
        )


def grounded_question(course, chunk):
    question = deepcopy(seed_questions()[0])
    for key in ("id", "origin", "status", "review_notes", "version"):
        question.pop(key)
    question["topic_id"] = course
    question["sources"] = [chunk]
    for point in question["rubric_points"]:
        point["source_indices"] = [0]
        point["evidence_quote"] = "A stack follows last-in, first-out order."
    return question


def test_grounded_generation_approval_and_session(client, monkeypatch):
    headers = auth(client, "admin")
    course = create_course(client, headers)
    client.post(
        f"/api/v1/viva/courses/{course}/materials/text", headers=headers, json={"text": NOTES}
    )
    context = client.get(
        f"/api/v1/viva/integrations/context?topic_id={course}", headers=headers
    ).json()
    question = grounded_question(course, context["c03"]["chunks"][0])
    monkeypatch.setattr(settings(), "generation_provider", "openai")
    monkeypatch.setattr(providers, "call_llm", lambda *args: deepcopy(question))
    response = client.post(
        "/api/v1/viva/bank/generate", headers=headers, json={"topic_id": course, "count": 1}
    )
    assert response.status_code == 201, response.text
    item = response.json()["items"][0]
    assert item["status"] == "draft"
    learner = auth(client)
    assert (
        client.post("/api/v1/viva/sessions", headers=learner, json={"topic_id": course}).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/v1/viva/bank/{item['id']}/review", headers=headers, json={"status": "approved"}
        ).status_code
        == 200
    )
    session = start(client, learner, topic_id=course)
    result = answer(client, learner, session, "It uses last in first out order.").json()
    assert (
        result["session"]["current_question"]["question"] == question["rubric_points"][1]["probe"]
    )
    question["sources"][0]["text"] = "An invented quotation that is not in the uploaded source."
    invalid = client.post(
        "/api/v1/viva/bank/generate", headers=headers, json={"topic_id": course, "count": 1}
    )
    assert invalid.status_code == 503
    with SessionLocal() as db:
        assert len(list(db.query(Bank).filter(Bank.topic_id == course))) == 1


def test_grounding_rejects_invalid_rubric_evidence():
    chunk = {"source": "Notes", "page": 1, "text": NOTES, "chunk_id": "c:1"}
    item = grounded_question("topic", chunk)
    context = {"c03": {"chunks": [chunk]}}
    validate_grounding(item, context, required=True)
    item["rubric_points"][0]["source_indices"] = [4]
    with pytest.raises(ValueError):
        validate_grounding(item, context, required=True)
    item["rubric_points"][0]["source_indices"] = [0]
    item["rubric_points"][0]["evidence_quote"] = "Unsupported fact"
    with pytest.raises(ValueError):
        validate_grounding(item, context, required=True)


def test_shared_atomic_budget_concurrency_and_rollback(client):
    def reserve_one(_):
        try:
            limits.reserve([("test-budget", 86400, 7, 1)])
            return True
        except HTTPException as exc:
            assert exc.status_code == 429 and int(exc.headers["Retry-After"]) > 0
            return False

    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(reserve_one, range(20)))
    assert sum(results) == 7
    with pytest.raises(HTTPException):
        limits.reserve([("a-uncommitted", 86400, 10, 1), ("test-budget", 86400, 7, 1)])
    with SessionLocal() as db:
        assert db.query(UsageCounter).filter(UsageCounter.key.like("a-uncommitted:%")).count() == 0
    with pytest.raises(HTTPException):
        limits.reserve([("test-budget", 86400, 7, 1)])


def test_budget_resets_at_window_boundary(client, monkeypatch):
    monkeypatch.setattr(limits.time, "time", lambda: 86399)
    limits.reserve([("midnight", 86400, 1, 1)])
    with pytest.raises(HTTPException):
        limits.reserve([("midnight", 86400, 1, 1)])
    monkeypatch.setattr(limits.time, "time", lambda: 86400)
    limits.reserve([("midnight", 86400, 1, 1)])


def test_api_rate_limits_return_retry_after(client, monkeypatch):
    headers = auth(client)
    monkeypatch.setattr(settings(), "api_requests_per_minute", 2)
    assert client.get("/api/v1/viva/topics", headers=headers).status_code == 200
    assert client.get("/api/v1/viva/topics", headers=headers).status_code == 200
    response = client.get("/api/v1/viva/topics", headers=headers)
    assert response.status_code == 429 and int(response.headers["Retry-After"]) > 0


def test_provider_429_is_not_retried_or_demo_fallback(client, monkeypatch):
    calls = []
    monkeypatch.setattr(settings(), "assessment_provider", "openai")
    monkeypatch.setattr(settings(), "demo_fallback", True)

    async def post(self, url, **kwargs):
        calls.append(kwargs)
        return httpx.Response(
            429, headers={"Retry-After": "12"}, request=httpx.Request("POST", url)
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    # Direct provider call avoids mocking TestClient's own post.
    with pytest.raises(HTTPException) as error:
        providers.assess(seed_questions()[0], "Explain", "A response", [])
    assert error.value.status_code == 429 and len(calls) == 1
    assert error.value.headers["Retry-After"] == "12"
    assert calls[0]["json"]["max_tokens"] == 2048  # assessment output cap
    assert any(c["scope"] == "llm-day" and c["used"] == 1 for c in limits.usage())


def test_budget_stops_outbound_call(client, monkeypatch):
    monkeypatch.setattr(settings(), "llm_daily_token_budget", 1)
    monkeypatch.setattr(
        httpx.AsyncClient, "post", lambda *a, **k: pytest.fail("Outbound call must not happen")
    )
    with pytest.raises(HTTPException) as error:
        providers.call_llm("openai", "Assess", {}, {})
    assert error.value.status_code == 429


def test_fillers_and_pause_overlap_are_conservative():
    result = lexical_metrics(
        "Umm, uhhh, erm... hmm. I like queues, so I use one. You know the rule."
    )
    assert result["filler_count"] == 4
    assert result["ambiguous_markers"] == 3
    assert len(result["filler_events"]) == 4
    result = speech.pause_metrics(
        [{"start": 32000, "end": 48000}, {"start": 0, "end": 10000}, {"start": 9000, "end": 16000}],
        64000,
    )
    assert result["pause_count"] == 1 and result["total_pause_ms"] == 1000


def test_speech_concurrency_fails_fast():
    speech._inference_lock.acquire()
    try:
        with pytest.raises(HTTPException) as error:
            speech.transcribe(b"data", ".wav")
        assert error.value.status_code == 429
    finally:
        speech._inference_lock.release()


def test_material_size_and_scanned_pdf_limits(monkeypatch):
    monkeypatch.setattr(settings(), "max_material_bytes", 10)
    with pytest.raises(HTTPException) as error:
        extract_material(b"a" * 11, "notes.txt")
    assert error.value.status_code == 413


def test_neon_url_options_preserved():
    from app.db.session import build_engine

    engine = build_engine(
        "postgresql://user:dummy@example.neon.tech/test?sslmode=require&channel_binding=require"
    )
    assert engine.url.drivername == "postgresql+psycopg"
    assert engine.url.query["sslmode"] == "require"
    assert engine.url.query["channel_binding"] == "require"
    engine.dispose()


def test_transcribe_reuses_vad_and_preserves_word_evidence(monkeypatch):
    from types import SimpleNamespace

    import numpy as np

    vad = pytest.importorskip("faster_whisper.vad")
    monkeypatch.setattr(settings(), "speech_provider", "faster_whisper")
    monkeypatch.setattr(speech, "decode_bounded", lambda content: np.zeros(64000, dtype=np.float32))
    monkeypatch.setattr(
        vad,
        "get_speech_timestamps",
        lambda *a, **k: [{"start": 8000, "end": 24000}, {"start": 40000, "end": 56000}],
    )
    calls = []

    class Recognizer:
        def transcribe(self, audio, **kwargs):
            calls.append(kwargs)
            return iter(
                [
                    SimpleNamespace(
                        start=0.5,
                        end=3.5,
                        text="Um, a stack uses LIFO.",
                        words=[SimpleNamespace(start=0.5, end=0.8, word="Um", probability=0.9)],
                    )
                ]
            ), None

    monkeypatch.setattr(speech, "model", lambda: Recognizer())
    result = speech.transcribe(b"fixture", ".wav")
    assert len(calls) == 1 and calls[0]["vad_filter"] is False
    assert calls[0]["clip_timestamps"] == [0.3, 3.7]
    assert calls[0]["beam_size"] == 1 and calls[0]["language"] == "en"
    assert result["metrics"]["total_pause_ms"] == 1000
    assert result["lexical_metrics"]["filler_count"] == 1
    assert result["segments"][0]["words"][0]["probability"] == 0.9
    assert result["processing_ms"] >= 0


def test_speech_failures_release_inference_slot(monkeypatch):
    monkeypatch.setattr(settings(), "speech_provider", "disabled")
    for _ in range(2):
        with pytest.raises(providers.ProviderUnavailable):
            speech.transcribe(b"fixture", ".wav")
    assert not speech._inference_lock.locked()


def test_cors_exposes_rate_limit_wait(client, monkeypatch):
    headers = auth(client)
    headers["Origin"] = "http://localhost:5173"
    monkeypatch.setattr(settings(), "api_requests_per_minute", 1)
    assert client.get("/api/v1/viva/topics", headers=headers).status_code == 200
    response = client.get("/api/v1/viva/topics", headers=headers)
    assert response.status_code == 429
    assert response.headers["Access-Control-Allow-Origin"] == headers["Origin"]
    assert "Retry-After" in response.headers["Access-Control-Expose-Headers"]


def test_gemini_compatible_contract_without_network(client, monkeypatch):
    monkeypatch.setattr(
        settings(), "llm_base_url", "https://generativelanguage.googleapis.com/v1beta/openai"
    )
    monkeypatch.setattr(settings(), "llm_model", "gemini-configured-model")
    monkeypatch.setattr(settings(), "llm_api_key", "unit-test-placeholder")
    monkeypatch.setattr(settings(), "allow_cloud_llm", True)
    calls = []

    async def post(self, url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"ok": true}'}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    assert providers.call_llm("openai", "Assess", {"example": "synthetic"}, {"type": "object"}) == {
        "ok": True
    }
    assert calls[0][0] == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    assert calls[0][1]["headers"]["Authorization"] == "Bearer unit-test-placeholder"
    assert calls[0][1]["json"]["model"] == "gemini-configured-model"
    assert calls[0][1]["json"]["response_format"]["type"] == "json_schema"


def test_cloud_gate_precedes_budget_and_network(client, monkeypatch):
    monkeypatch.setattr(
        settings(), "llm_base_url", "https://generativelanguage.googleapis.com/v1beta/openai"
    )
    monkeypatch.setattr(settings(), "allow_cloud_llm", False)
    monkeypatch.setattr(
        httpx.AsyncClient, "post", lambda *a, **k: pytest.fail("Cloud opt-in required")
    )
    with pytest.raises(providers.ProviderUnavailable):
        providers.call_llm("openai", "Assess", {}, {})
    assert limits.usage() == []
