"""Shared test doubles: an offline embedder and a quick way to build chunks."""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence

from app.content.models import Chunk

DIMENSIONS = 64


class FakeEmbedder:
    """Deterministic, offline, and counts how much work it was asked to do."""

    def __init__(self, name: str = "fake-a", max_tokens: int = 10_000) -> None:
        self.name = name
        self._max_tokens = max_tokens
        self.documents_embedded = 0

    @property
    def max_tokens(self) -> int:
        return self._max_tokens

    def token_count(self, text: str) -> int:
        return len(text.split())

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        self.documents_embedded += len(texts)
        return [self._vector(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector(text)

    @staticmethod
    def _vector(text: str) -> list[float]:
        vector = [0.0] * DIMENSIONS
        for word in text.lower().split():
            digest = hashlib.sha256(word.encode()).digest()
            vector[digest[0] % DIMENSIONS] += 1.0
        norm = math.sqrt(sum(x * x for x in vector)) or 1.0
        return [x / norm for x in vector]


def make_chunk(
    chunk_id: str,
    text: str,
    *,
    section_type: str = "theory",
    heading_path: str = "Loops > Theory",
    question_nos: tuple[int, ...] | None = None,
    level: int | None = None,
    concept_id: str | None = "prog.loops",
) -> Chunk:
    return Chunk(
        chunk_id=chunk_id,
        unit_id="prog.loops",
        module_id="prog",
        concept_id=concept_id,
        section_type=section_type,
        ordinal=0,
        heading_path=heading_path,
        headings=(),
        question_nos=question_nos,
        level=level,
        text=text,
        word_count=len(text.split()),
        text_hash=hashlib.sha256(text.encode()).hexdigest(),
    )
