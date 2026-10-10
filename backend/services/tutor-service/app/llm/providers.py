"""Language model providers behind one small interface.

Gemini is the cloud provider and Ollama the optional local one. Both are called over
plain HTTP with httpx, so there is no vendor SDK to install or keep up to date.

`generate` either returns text or raises `LLMError`. It never returns an empty string,
so a caller only has to decide what to do when it fails (here: show the authored text).
`FallbackChain` tries providers in order and, after one fails, skips it for a short
cool-down so a provider that is down costs one timeout, not one per request.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config import Settings

log = logging.getLogger("tutor.llm")


class LLMError(Exception):
    """The model could not produce usable text (network, quota, bad key, empty reply)."""


@dataclass(frozen=True)
class Generation:
    text: str
    provider: str
    model: str
    latency_ms: int


class LLMProvider(Protocol):
    name: str
    model: str

    def generate(
        self, *, system: str, prompt: str, max_tokens: int = 700, temperature: float = 0.3
    ) -> Generation: ...


class GeminiProvider:
    name = "gemini"

    def __init__(
        self,
        api_key: str,
        model: str,
        timeout: float = 25.0,
        client: httpx.Client | None = None,
    ) -> None:
        self._key = api_key
        self.model = model
        self._timeout = timeout
        self._client = client or httpx.Client()

    def generate(
        self, *, system: str, prompt: str, max_tokens: int = 700, temperature: float = 0.3
    ) -> Generation:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        )
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            # Some Gemini models spend output tokens on hidden reasoning, so leave room.
            "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens + 800},
        }
        started = time.perf_counter()
        try:
            response = self._client.post(
                url, json=body, headers={"x-goog-api-key": self._key}, timeout=self._timeout
            )
        except httpx.HTTPError as exc:
            raise LLMError(f"gemini unreachable: {type(exc).__name__}") from exc
        if response.status_code != 200:
            # The body can echo request details, so report the status only.
            raise LLMError(f"gemini returned HTTP {response.status_code}")

        try:
            parts = response.json()["candidates"][0]["content"]["parts"]
            text = "".join(part.get("text", "") for part in parts).strip()
        except (KeyError, IndexError, ValueError, TypeError) as exc:
            raise LLMError("gemini reply had no text") from exc
        if not text:
            raise LLMError("gemini reply was empty")
        return Generation(text, self.name, self.model, int((time.perf_counter() - started) * 1000))


class OllamaProvider:
    name = "ollama"

    def __init__(
        self,
        base_url: str,
        model: str,
        timeout: float = 25.0,
        client: httpx.Client | None = None,
    ) -> None:
        self._base = base_url.rstrip("/")
        self.model = model
        self._timeout = timeout
        self._client = client or httpx.Client()

    def generate(
        self, *, system: str, prompt: str, max_tokens: int = 700, temperature: float = 0.3
    ) -> Generation:
        body = {
            "model": self.model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        started = time.perf_counter()
        try:
            response = self._client.post(f"{self._base}/api/chat", json=body, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise LLMError(f"ollama unreachable: {type(exc).__name__}") from exc
        if response.status_code != 200:
            raise LLMError(f"ollama returned HTTP {response.status_code}")
        try:
            text = response.json()["message"]["content"].strip()
        except (KeyError, ValueError, TypeError, AttributeError) as exc:
            raise LLMError("ollama reply had no text") from exc
        if not text:
            raise LLMError("ollama reply was empty")
        return Generation(text, self.name, self.model, int((time.perf_counter() - started) * 1000))


class FallbackChain:
    """Try providers in order. One that just failed is skipped for `cooldown` seconds."""

    def __init__(
        self,
        providers: Sequence[LLMProvider],
        *,
        cooldown: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not providers:
            raise ValueError("a chain needs at least one provider")
        self.providers = list(providers)
        self._cooldown = cooldown
        self._clock = clock
        self._down_until: dict[str, float] = {}

    @property
    def name(self) -> str:
        return "+".join(p.name for p in self.providers)

    @property
    def model(self) -> str:
        return self.providers[0].model

    def generate(
        self, *, system: str, prompt: str, max_tokens: int = 700, temperature: float = 0.3
    ) -> Generation:
        problems: list[str] = []
        for provider in self.providers:
            if self._clock() < self._down_until.get(provider.name, 0.0):
                problems.append(f"{provider.name} cooling down")
                continue
            try:
                return provider.generate(
                    system=system, prompt=prompt, max_tokens=max_tokens, temperature=temperature
                )
            except LLMError as exc:
                log.warning(
                    "llm provider failed", extra={"provider": provider.name, "why": str(exc)}
                )
                self._down_until[provider.name] = self._clock() + self._cooldown
                problems.append(str(exc))
        raise LLMError("; ".join(problems))


def build_provider(settings: Settings) -> LLMProvider | None:
    """The configured provider chain, or None when no model is available.

    With None the tutor teaches from the authored course text alone, which is also what
    it falls back to whenever a call fails.
    """
    timeout = settings.llm_timeout_seconds

    def make(name: str) -> LLMProvider | None:
        if name == "gemini" and settings.gemini_configured:
            assert settings.gemini_api_key is not None
            return GeminiProvider(
                settings.gemini_api_key.get_secret_value().strip(), settings.gemini_model, timeout
            )
        if name == "ollama":
            return OllamaProvider(settings.ollama_base_url, settings.ollama_model, timeout)
        return None

    names = [settings.llm_provider, settings.llm_fallback_provider]
    made = [make(n.strip().lower()) for n in names]
    # The same provider named twice is one provider.
    unique = list({p.name: p for p in made if p is not None}.values())
    return FallbackChain(unique) if unique else None
