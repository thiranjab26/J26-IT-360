"""Indexing chunks into ChromaDB, with a fake embedder so no model is downloaded.

The fake turns words into a small hashed bag-of-words vector, so texts that share
words land near each other. That is enough to check that the right chunk is found,
that unchanged chunks are not re-embedded, and that changes propagate.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

import pytest

from app.content.embedder import (
    QUERY_PREFIXES,
    SentenceTransformerEmbedder,
    model_slug,
)
from app.content.indexer import (
    collection_name,
    embed_text,
    get_collection,
    index_module,
    open_store,
    truncated_chunks,
)
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


@pytest.fixture
def client(tmp_path: Path):
    return open_store(tmp_path / "chroma")


@pytest.fixture
def chunks() -> list[Chunk]:
    return [
        make_chunk("prog.loops#theory-01", "a while loop checks its condition before each pass"),
        make_chunk("prog.loops#theory-02", "a for loop keeps its counter in the header"),
        make_chunk(
            "prog.loops#rubric-q09",
            "one mark for the correct output",
            section_type="rubric",
            question_nos=(9, 10, 11),
        ),
        make_chunk(
            "prog.loops#exercise-q07",
            "explain why the loop runs one extra time",
            section_type="exercise",
            question_nos=(7,),
            level=3,
        ),
    ]


def test_every_chunk_is_stored_with_its_metadata(client, chunks) -> None:
    embedder = FakeEmbedder()
    result = index_module(client, embedder, "prog", chunks)
    collection = get_collection(client, "prog", embedder.name)

    assert (result.added, result.updated, result.unchanged, result.removed) == (4, 0, 0, 0)
    assert collection.count() == 4

    stored = collection.get(ids=["prog.loops#rubric-q09"], include=["metadatas", "documents"])
    meta = stored["metadatas"][0]
    assert meta["section_type"] == "rubric"
    assert meta["question_nos"] == "9,10,11"
    assert meta["module_id"] == "prog" and meta["concept_id"] == "prog.loops"
    assert "level" not in meta  # absent, not None: Chroma rejects None
    assert stored["documents"][0] == "one mark for the correct output"


def test_a_level_is_kept_as_a_number(client, chunks) -> None:
    index_module(client, FakeEmbedder(), "prog", chunks)
    stored = get_collection(client, "prog", "fake-a").get(
        ids=["prog.loops#exercise-q07"], include=["metadatas"]
    )

    assert stored["metadatas"][0]["level"] == 3


def test_reindexing_unchanged_content_embeds_nothing(client, chunks) -> None:
    embedder = FakeEmbedder()
    index_module(client, embedder, "prog", chunks)
    embedded_first = embedder.documents_embedded

    result = index_module(client, embedder, "prog", chunks)

    assert embedder.documents_embedded == embedded_first
    assert (result.added, result.updated, result.unchanged) == (0, 0, 4)


def test_editing_one_chunk_re_embeds_only_that_chunk(client, chunks) -> None:
    embedder = FakeEmbedder()
    index_module(client, embedder, "prog", chunks)
    embedder.documents_embedded = 0

    edited = [*chunks[:1], replace(chunks[1], text="a for loop has three parts"), *chunks[2:]]
    result = index_module(client, embedder, "prog", edited)

    assert embedder.documents_embedded == 1
    assert (result.added, result.updated, result.unchanged) == (0, 1, 3)


def test_a_changed_heading_also_re_embeds_because_it_is_part_of_the_text(client, chunks) -> None:
    embedder = FakeEmbedder()
    index_module(client, embedder, "prog", chunks)
    embedder.documents_embedded = 0

    moved = [replace(chunks[0], heading_path="Loops > Something Else"), *chunks[1:]]
    result = index_module(client, embedder, "prog", moved)

    assert result.updated == 1
    assert embedder.documents_embedded == 1


def test_a_chunk_removed_from_the_content_leaves_the_index(client, chunks) -> None:
    embedder = FakeEmbedder()
    index_module(client, embedder, "prog", chunks)

    result = index_module(client, embedder, "prog", chunks[:3])
    collection = get_collection(client, "prog", embedder.name)

    assert result.removed == 1
    assert collection.count() == 3
    assert collection.get(ids=["prog.loops#exercise-q07"])["ids"] == []


def test_the_nearest_chunk_to_a_question_is_the_one_about_it(client, chunks) -> None:
    embedder = FakeEmbedder()
    index_module(client, embedder, "prog", chunks)
    collection = get_collection(client, "prog", embedder.name)

    hit = collection.query(
        query_embeddings=[embedder.embed_query("loop condition checked before each pass")],
        n_results=1,
    )

    assert hit["ids"][0][0] == "prog.loops#theory-01"


def test_each_model_gets_its_own_collection(client, chunks) -> None:
    index_module(client, FakeEmbedder("fake-a"), "prog", chunks)
    index_module(client, FakeEmbedder("fake-b"), "prog", chunks[:2])

    assert get_collection(client, "prog", "fake-a").count() == 4
    assert get_collection(client, "prog", "fake-b").count() == 2


def test_each_module_gets_its_own_collection(client, chunks) -> None:
    index_module(client, FakeEmbedder(), "prog", chunks)

    assert get_collection(client, "dsa", "fake-a").count() == 0


# --------------------------------------------------------------- truncation
def test_chunks_longer_than_the_model_reads_are_reported(chunks) -> None:
    long_chunk = make_chunk("prog.loops#theory-09", "word " * 80)
    embedder = FakeEmbedder(max_tokens=50)

    flagged = truncated_chunks(embedder, [*chunks, long_chunk])

    assert [c.chunk_id for c, _ in flagged] == ["prog.loops#theory-09"]
    assert flagged[0][1] > 50


def test_the_embedded_text_includes_the_heading_path(chunks) -> None:
    text = embed_text(chunks[0])

    assert text.startswith("Loops > Theory")
    assert chunks[0].text in text


# -------------------------------------------------------------------- names
def test_collection_names_are_valid_and_readable() -> None:
    assert model_slug("BAAI/bge-small-en-v1.5") == "bge-small-en-v1-5"
    assert collection_name("prog", "BAAI/bge-small-en-v1.5") == "content_prog__bge-small-en-v1-5"
    assert collection_name("dsa", "sentence-transformers/all-MiniLM-L6-v2") == (
        "content_dsa__all-minilm-l6-v2"
    )


# --------------------------------------------------------- query instruction
class _RecordingModel:
    def __init__(self) -> None:
        self.inputs: list = []

    def encode(self, text, **_kwargs):  # noqa: ANN001, ANN201
        import numpy as np

        self.inputs.append(text)
        count = len(text) if isinstance(text, list) else 1
        return np.zeros((count, 3)) if isinstance(text, list) else np.zeros(3)


def test_retrieval_models_get_their_query_instruction_but_passages_do_not() -> None:
    name = "BAAI/bge-small-en-v1.5"
    embedder = SentenceTransformerEmbedder(name)
    model = _RecordingModel()
    embedder._model = model

    embedder.embed_query("why does it loop")
    embedder.embed_documents(["a passage"])

    assert model.inputs[0] == QUERY_PREFIXES[name] + "why does it loop"
    assert model.inputs[1] == ["a passage"]


def test_a_model_without_an_instruction_gets_the_bare_query() -> None:
    embedder = SentenceTransformerEmbedder("sentence-transformers/all-MiniLM-L6-v2")
    model = _RecordingModel()
    embedder._model = model

    embedder.embed_query("why does it loop")

    assert model.inputs[0] == "why does it loop"
