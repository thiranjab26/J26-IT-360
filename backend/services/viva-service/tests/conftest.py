import os
import tempfile

os.environ["DATABASE_URL"] = "sqlite:///" + tempfile.mktemp(prefix="c04-tests-", suffix=".db")
os.environ["VIVA_DEV_MODE"] = "true"
os.environ["VIVA_SEED_DEMO_BANK"] = "true"
os.environ["VIVA_ASSESSMENT_PROVIDER"] = "demo"
os.environ["VIVA_GENERATION_PROVIDER"] = "demo"
# Never inherit the real .env LLM endpoint/key: an unmocked call must fail locally, not reach Gemini.
os.environ["VIVA_LLM_BASE_URL"] = "http://127.0.0.1:9"
os.environ["VIVA_LLM_API_KEY"] = ""
os.environ["VIVA_LLM_MODEL"] = "test-model"
os.environ["VIVA_LLM_FALLBACK_MODELS"] = ""
for name in ("VIVA_FALLBACK_LLM_BASE_URL", "VIVA_FALLBACK_LLM_MODEL", "VIVA_FALLBACK_LLM_API_KEY"):
    os.environ[name] = ""
os.environ["VIVA_SPEECH_WARMUP"] = "false"
os.environ["VIVA_SPEECH_API_KEY"] = ""
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.db.tables import Base  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    from app.integrations import llm as providers

    providers._cooldown.clear()
    from app.core import auth as auth_module
    from app.core import limits as limits_module

    auth_module._sessions.clear()
    limits_module._windows.clear()
    with TestClient(app) as client:
        yield client


def auth(client, role="participant", code="P001", key=None):
    if role == "participant":
        response = client.post(
            "/api/v1/viva/auth/participant", json={"participant_code": code, "consent": True}
        )
    else:
        response = client.post(
            "/api/v1/viva/auth/staff",
            json={"role": role, "access_key": key or f"demo-{role}-local"},
        )
    assert response.status_code in (200, 201), response.text
    return {"Authorization": "Bearer " + response.json()["token"]}


def start(client, headers, **extra):
    response = client.post(
        "/api/v1/viva/sessions",
        headers=headers,
        json={"topic_id": "stacks", "input_mode": "text", "max_depth": 2, **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


def answer(client, headers, session, transcript, request_id="r1", **extra):
    return client.post(
        f"/api/v1/viva/sessions/{session['id']}/answers",
        headers=headers,
        json={
            "question_id": session["current_question"]["id"],
            "transcript": transcript,
            "input_mode": "text",
            "request_id": request_id,
            **extra,
        },
    )
