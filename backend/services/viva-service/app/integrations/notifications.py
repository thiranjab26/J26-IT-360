"""Deliver already-persisted review events; never modify C01 mastery."""

from copy import deepcopy
from urllib.parse import urlparse

import httpx
from sqlalchemy import select

from app.config import settings
from app.db.session import SessionLocal
from app.db.tables import IntegrationEvent, Result, VivaSession


def deliver_review_notifications(session_id):
    cfg = settings()
    if not cfg.c01_review_url:
        return
    with SessionLocal() as db:
        session = db.get(VivaSession, session_id)
        if not session or session.status != "completed":
            return
        for record in db.scalars(
            select(IntegrationEvent).where(IntegrationEvent.session_id == session_id)
        ):
            event = deepcopy(record.data)
            if event.get("event") != "mastery_review_requested" or event.get("status") != "queued":
                continue
            event_id = f"{session_id}:c01-review"
            payload = {
                "event_id": event_id,
                "event": "mastery_review_requested",
                "studentId": session.user_id,
                "sessionId": session_id,
                "topic": session.data["topic"],
                "concepts": [
                    c["concept"]
                    for c in session.data["report"]["concepts"]
                    if c["outcome"] == "LIKELY_KNOWLEDGE_GAP"
                ],
                "recommendation": "Review the viva evidence; C04 has not changed mastery.",
            }
            headers = {"Idempotency-Key": event_id}
            if cfg.integration_api_token:
                headers["Authorization"] = f"Bearer {cfg.integration_api_token}"
            try:
                local = urlparse(cfg.c01_review_url).hostname in ("localhost", "127.0.0.1", "::1")
                with httpx.Client(
                    timeout=cfg.integration_timeout_seconds, trust_env=not local
                ) as client:
                    response = client.post(cfg.c01_review_url, json=payload, headers=headers)
                    response.raise_for_status()
                event.update(
                    status="delivered",
                    detail="The configured C01 review endpoint accepted this notification. C01 mastery was not modified by C04.",
                )
            except (httpx.HTTPError, ValueError, ImportError):
                event.update(
                    status="failed",
                    detail="C01 review delivery failed. The review event remains recorded locally; check the configured endpoint before retrying delivery.",
                )
            record.data = event
            data = deepcopy(session.data)
            data["report"]["integration_events"] = [
                event if e.get("event") == event["event"] else e
                for e in data["report"]["integration_events"]
            ]
            session.data = data
            stored_result = db.get(Result, session_id)
            if stored_result:
                stored_result.data = deepcopy(data["report"])
            db.commit()
