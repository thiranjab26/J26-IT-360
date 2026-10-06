"""The running app: health, error shape, request ids and production hardening."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(), raise_server_exceptions=False)


@pytest.mark.parametrize("path", ["/health", "/api/v1/curriculum/health"])
def test_health_is_served_directly_and_through_the_gateway_prefix(
    client: TestClient, path: str
) -> None:
    response = client.get(path)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_the_gateway_request_id_is_echoed(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-Id": "req-123"})
    assert response.headers["x-request-id"] == "req-123"


def test_unknown_routes_use_the_shared_error_shape(client: TestClient) -> None:
    response = client.get("/api/v1/curriculum/no-such-route")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_docs_are_available_outside_production(client: TestClient) -> None:
    assert client.get("/openapi.json").status_code == 200


def test_production_hides_docs_and_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    get_settings.cache_clear()
    try:
        client = TestClient(create_app())
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404
    finally:
        get_settings.cache_clear()


def test_dev_tools_are_off_in_production_and_live_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    for environment, mode, expected in [
        ("development", "stub", True),
        ("development", "live", False),
        ("production", "stub", False),
    ]:
        monkeypatch.setenv("ENVIRONMENT", environment)
        monkeypatch.setenv("INTEGRATION_MODE", mode)
        get_settings.cache_clear()
        assert get_settings().dev_tools_enabled is expected
    get_settings.cache_clear()
