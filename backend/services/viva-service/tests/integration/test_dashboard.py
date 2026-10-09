"""Admin overview dashboard and the speech lab (recording analysis)."""

import numpy as np

from app.integrations import recording
from tests.conftest import answer, auth, start


def test_overview_is_admin_only_and_counts_sessions(client):
    learner = auth(client)
    session = start(client, learner)
    answer(client, learner, session, "LIFO: last in, first out. B is removed first.")
    for role in ("participant", "evaluator"):
        headers = learner if role == "participant" else auth(client, "evaluator")
        assert client.get("/api/v1/viva/overview", headers=headers).status_code == 403
    data = client.get("/api/v1/viva/overview", headers=auth(client, "admin")).json()
    assert data["totals"]["sessions"] == 1 and data["totals"]["participants"] >= 1
    assert data["totals"]["answers"] == 1 and data["bank"]["approved"] > 0
    assert len(data["daily"]) == 14 and data["daily"][-1]["started"] == 1
    assert data["recent"][0]["topic"] == "Stacks" and data["recent"][0]["status"] == "active"
    assert set(data["outcomes"]) == {
        "STRONG",
        "LIKELY_KNOWLEDGE_GAP",
        "LIKELY_COMMUNICATION_DIFFICULTY",
        "MIXED_INSUFFICIENT_EVIDENCE",
    }


def test_session_list_includes_coverage(client):
    learner = auth(client)
    session = start(client, learner)
    client.post(f"/api/v1/viva/sessions/{session['id']}/finish", headers=learner)
    item = client.get("/api/v1/viva/sessions", headers=learner).json()["items"][0]
    assert item["coverage"] == 0 and item["strong"] is False


def test_lab_analyses_a_recording_from_the_sound(client, monkeypatch):
    monkeypatch.setattr(recording, "decode", lambda content, max_seconds=0: np.zeros(16000 * 20))
    monkeypatch.setattr(
        recording, "speech_intervals", lambda audio: [(1.0, 4.0), (5.0, 9.0), (10.0, 15.0)]
    )
    monkeypatch.setattr(recording, "syllables", lambda audio: [1.5 + 0.4 * i for i in range(30)])
    files = {"audio": ("P01_student.m4a", b"fake", "audio/mp4")}
    assert (
        client.post("/api/v1/viva/lab/analyse", headers=auth(client), files=files).status_code
        == 403
    )
    response = client.post(
        "/api/v1/viva/lab/analyse",
        headers=auth(client, "admin"),
        files=files,
        data={"transcriber": "none"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["syllable_source"] == "acoustic" and data["transcript_source"] == "none"
    assert data["session"]["silent_pauses"] == 2 and data["session"]["speaking_time_s"] == 14
    assert [p["ms"] for p in data["pauses"]] == [1000, 1000]
    assert {r["measure"] for r in data["profile"]["rules"]} >= {"speech_rate_syll_s"}
    assert any("from the sound" in n for n in data["notes"])


def test_lab_rejects_non_audio(client):
    response = client.post(
        "/api/v1/viva/lab/analyse",
        headers=auth(client, "admin"),
        files={"audio": ("notes.pdf", b"%PDF", "application/pdf")},
    )
    assert response.status_code == 415


def test_lab_explains_a_missing_speech_extra(client, monkeypatch):
    def missing(content, max_seconds=0):
        raise ImportError("No module named 'av'")

    monkeypatch.setattr(recording, "decode", missing)
    response = client.post(
        "/api/v1/viva/lab/analyse",
        headers=auth(client, "admin"),
        files={"audio": ("P01_student.wav", b"fake", "audio/wav")},
        data={"transcriber": "none"},
    )
    assert response.status_code == 503
    assert "--extra speech" in response.text
