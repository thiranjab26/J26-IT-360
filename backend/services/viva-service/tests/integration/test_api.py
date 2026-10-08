from sqlalchemy import select

from app.db.session import SessionLocal
from app.db.tables import HumanRating, VivaSession
from tests.conftest import answer, auth, start


def test_auth_fresh_identity_and_owner_role_enforcement(client):
    a, b = auth(client, code="SAME"), auth(client, code="SAME")
    session = start(client, a)
    assert client.get(f"/api/v1/viva/sessions/{session['id']}", headers=b).status_code == 403
    assert client.get("/api/v1/viva/bank", headers=a).status_code == 403
    assert client.get("/api/v1/viva/sessions").status_code == 401
    evaluator = auth(client, "evaluator")
    for endpoint in (
        "bank",
        "evaluation/metrics",
        "evaluation/export",
        f"sessions/{session['id']}",
    ):
        assert client.get("/api/v1/viva/" + endpoint, headers=evaluator).status_code == 403
    assert (
        client.post(
            "/api/v1/viva/auth/participant",
            json={"participant_code": "NoConsent", "consent": False},
        ).status_code
        == 422
    )


def test_idempotency_stale_and_active_no_rubric_leak(client):
    headers = auth(client)
    session = start(client, headers)
    response = answer(client, headers, session, "The last item is removed first.")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["assessment"]["rubric_hits"] == []
    assert "reference_answer" not in str(result["session"])
    same = answer(client, headers, session, "The last item is removed first.")
    assert same.json() == result
    assert answer(client, headers, session, "Changed content").status_code == 409
    assert answer(client, headers, session, "Other answer", request_id="r2").status_code == 409
    assert (
        len(client.get(f"/api/v1/viva/sessions/{session['id']}", headers=headers).json()["turns"])
        == 1
    )
    assert (
        client.get(f"/api/v1/viva/sessions/{session['id']}/export", headers=headers).status_code
        == 409
    )


def test_approved_only_edit_invalidates_and_snapshot_immutable(client):
    user, staff = auth(client), auth(client, "admin")
    session = start(client, user)
    with SessionLocal() as db:
        snapshot = db.get(VivaSession, session["id"]).data["snapshots"][0]
    qid = snapshot["id"]
    changed = client.put(
        f"/api/v1/viva/bank/{qid}",
        headers=staff,
        json={"question": "A changed question about a stack."},
    )
    assert changed.status_code == 200
    assert changed.json()["status"] == "draft"
    with SessionLocal() as db:
        assert (
            db.get(VivaSession, session["id"]).data["snapshots"][0]["question"]
            == snapshot["question"]
        )
    other = start(client, user)
    assert other["current_question"]["concept"] != snapshot["concept"]
    for item in client.get("/api/v1/viva/bank?topic_id=stacks", headers=staff).json()["items"]:
        client.post(
            f"/api/v1/viva/bank/{item['id']}/review", headers=staff, json={"status": "rejected"}
        )
    assert (
        client.post("/api/v1/viva/sessions", headers=user, json={"topic_id": "stacks"}).status_code
        == 409
    )


def test_early_finish_report_and_persisted_reload(client):
    user = auth(client)
    session = start(client, user)
    report = client.post(f"/api/v1/viva/sessions/{session['id']}/finish", headers=user).json()
    assert report["outcome"] == "MIXED_INSUFFICIENT_EVIDENCE"
    assert all(c["turn_count"] == 0 for c in report["concepts"])
    assert report["hesitation"]["pause_count"] is None
    assert (
        client.post(f"/api/v1/viva/sessions/{session['id']}/finish", headers=user).json() == report
    )
    # Fresh ORM connection proves stored state is sufficient, not a process-local session dict.
    with SessionLocal() as db:
        record = db.get(VivaSession, session["id"])
        assert record.status == "completed"
        assert record.data["report"] == {k: v for k, v in report.items() if k != "transcript"}
    assert report["transcript"] == []
    assert answer(client, user, session, "LIFO").status_code == 409
    exported = client.get(f"/api/v1/viva/sessions/{session['id']}/export", headers=user).json()
    assert "policy_version" in exported["session"]
    assert "token" not in exported


def test_full_flow_blinding_separate_raters_and_metrics(client):
    user, admin = auth(client), auth(client, "admin")
    session = start(client, user, max_depth=1)
    first = answer(client, user, session, "A stack follows FIFO.", "r1").json()["session"]
    second = answer(client, user, first, "A stack follows FIFO.", "r2").json()["session"]
    assert second["current_question"]["concept"] == "Push and pop"
    third = answer(
        client,
        user,
        second,
        "Push adds to the top. Pop removes the top. An empty stack causes underflow.",
        "r3",
    )
    assert third.status_code == 200, third.text
    assert third.json()["session"]["status"] == "completed"
    assert third.json()["session"]["report"]["mastery_mismatch"] is True
    raters = [auth(client, "evaluator"), auth(client, "evaluator", key="demo-evaluator-two-local")]
    cases_a = client.get("/api/v1/viva/evaluation/cases?condition=A", headers=raters[0]).json()[
        "items"
    ]
    cases_b = client.get("/api/v1/viva/evaluation/cases?condition=B", headers=raters[0]).json()[
        "items"
    ]
    cases_c = client.get("/api/v1/viva/evaluation/cases?condition=C", headers=raters[0]).json()[
        "items"
    ]
    assert len(cases_a[0]["turns"]) == 1
    assert len(cases_b[0]["turns"]) == 2
    assert "hesitation" not in cases_b[0]["turns"][0]
    assert "hesitation" in cases_c[0]["turns"][0]
    assert all(
        k not in str(cases_c)
        for k in ("assessment", "reference_answer", "NEXT_CONCEPT", "rubric_hits")
    )
    body = {
        "case_id": cases_a[0]["case_id"],
        "condition": "B",
        "answer_state": "misconception_bearing",
        "gap_outcome": "LIKELY_KNOWLEDGE_GAP",
    }
    ids = [
        client.post("/api/v1/viva/evaluation/ratings", headers=r, json=body).json()["id"]
        for r in raters
    ]
    assert ids[0] != ids[1]
    assert (
        client.post("/api/v1/viva/evaluation/ratings", headers=raters[0], json=body).json()["id"]
        == ids[0]
    )
    result = client.get("/api/v1/viva/evaluation/metrics", headers=admin).json()
    assert result["conditions"][0]["n"] == 0
    assert result["conditions"][0]["answer_accuracy"] is None
    assert result["conditions"][1]["n"] == 2
    assert result["conditions"][1]["gap_accuracy"] == 1
    assert result["inter_rater"]["n"] == 1
    with SessionLocal() as db:
        assert len(list(db.scalars(select(HumanRating)))) == 2


def test_ownership_generation_drafts_and_validation(client):
    user, staff = auth(client), auth(client, "admin")
    assert (
        client.get("/api/v1/viva/knowledge-check?topic_id=stacks", headers=user).status_code == 404
    )
    session = start(client, user)
    generated = client.post(
        "/api/v1/viva/bank/generate", headers=staff, json={"topic_id": "stacks", "count": 2}
    ).json()
    assert generated["provider"] == "demo"
    assert all(q["status"] == "draft" for q in generated["items"])
    assert answer(client, user, session, "x", state="complete").status_code == 422
    assert answer(client, user, session, "x" * 12001).status_code == 422
    assert (
        client.post(
            "/api/v1/viva/speech/transcribe",
            headers=user,
            files={"audio": ("x.txt", b"x", "text/plain")},
        ).status_code
        == 415
    )
    assert (
        client.post(
            "/api/v1/viva/speech/transcribe",
            headers=user,
            files={"audio": ("x.webm", b"fake", "audio/webm")},
        ).status_code
        == 503
    )
