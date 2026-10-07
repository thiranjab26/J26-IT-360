import httpx
import pytest

from app.config import settings
from app.integrations import notifications
from tests.conftest import answer, auth, start


@pytest.mark.parametrize("response_status,expected", [(202, "delivered"), (503, "failed")])
def test_configured_review_delivery_is_logged_after_completion(
    client, monkeypatch, response_status, expected
):
    monkeypatch.setattr(settings(), "c01_review_url", "https://c01.invalid/reviews")
    from app.integrations.context import adapter

    original = adapter.context

    def real_context(topic, participant):
        value = original(topic, participant)
        value["c01"]["source"] = "HTTP C01 adapter"
        return value

    monkeypatch.setattr(adapter, "context", real_context)
    sent = []

    class StubHTTP:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            sent.append(kwargs)
            return httpx.Response(response_status, request=httpx.Request("POST", url))

    monkeypatch.setattr(notifications.httpx, "Client", StubHTTP)
    headers = auth(client)
    session = start(client, headers, max_depth=1)
    first = answer(client, headers, session, "A stack follows FIFO.", "n1").json()["session"]
    second = answer(client, headers, first, "A stack follows FIFO.", "n2").json()["session"]
    answer(
        client,
        headers,
        second,
        "Push adds to the top. Pop removes the top. An empty stack causes underflow.",
        "n3",
    ).raise_for_status()
    report = client.get(f"/api/v1/viva/sessions/{session['id']}/report", headers=headers).json()
    event = next(e for e in report["integration_events"] if e["component"] == "C01")
    assert event["status"] == expected
    assert len(sent) == 1
    assert sent[0]["headers"]["Idempotency-Key"] == f"{session['id']}:c01-review"
    assert "mastery" not in sent[0]["json"]
