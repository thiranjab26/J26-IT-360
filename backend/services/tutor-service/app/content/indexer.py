"""Write chunk embeddings into ChromaDB. The vector store belongs to this service alone.

One collection per module and embedding model, named like
`content_prog__bge-small-en-v1-5`. Retrieval is therefore namespaced by module by
construction (architecture: retrieval is module-scoped), and trying a second
embedding model for the evaluation means a second collection next to the first rather
than overwriting it.

Indexing is incremental. A chunk is embedded only if it is new or its embedded text
changed, so re-indexing an unedited course embeds nothing, and editing one example
re-embeds that example alone. The embedded text is the heading path plus the chunk
text: the heading carries the concept name, which a bare paragraph about "the update"
or "the base case" does not.
"""

from __future__ import annotations

import hashlib
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import chromadb
from chromadb.api import ClientAPI
from chromadb.api.models.Collection import Collection

from app.content.embedder import Embedder, model_slug
from app.content.models import Chunk

UPSERT_BATCH = 256


@dataclass(frozen=True)
class IndexResult:
    collection: str
    added: int
    updated: int
    unchanged: int
    removed: int
    seconds: float

    @property
    def embedded(self) -> int:
        return self.added + self.updated


def open_store(path: Path) -> ClientAPI:
    path.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(
        path=str(path), settings=chromadb.Settings(anonymized_telemetry=False)
    )


def collection_name(module_id: str, model_name: str) -> str:
    return f"content_{module_id}__{model_slug(model_name)}"


def get_collection(client: ClientAPI, module_id: str, model_name: str) -> Collection:
    """The module's collection for this model, created on first use.

    Cosine distance: the vectors are normalised, so it ranks the same as a dot
    product and gives distances that read as 0 (identical) to 2 (opposite).
    """
    return client.get_or_create_collection(
        name=collection_name(module_id, model_name),
        configuration={"hnsw": {"space": "cosine"}},
        metadata={"embedding_model": model_name, "module_id": module_id},
    )


def embed_text(chunk: Chunk) -> str:
    return f"{chunk.heading_path}\n\n{chunk.text}"


def embed_hash(chunk: Chunk) -> str:
    return hashlib.sha256(embed_text(chunk).encode("utf-8")).hexdigest()


def index_module(
    client: ClientAPI,
    embedder: Embedder,
    module_id: str,
    chunks: Sequence[Chunk],
) -> IndexResult:
    """Make the module's collection match `chunks`, embedding only what changed."""
    started = time.perf_counter()
    collection = get_collection(client, module_id, embedder.name)

    current = {chunk.chunk_id: chunk for chunk in chunks}
    stored = _stored_hashes(collection)

    added = [c for cid, c in current.items() if cid not in stored]
    updated = [c for cid, c in current.items() if cid in stored and stored[cid] != embed_hash(c)]
    removed = [cid for cid in stored if cid not in current]
    unchanged = len(current) - len(added) - len(updated)

    to_embed = added + updated
    if to_embed:
        vectors = embedder.embed_documents([embed_text(c) for c in to_embed])
        for start in range(0, len(to_embed), UPSERT_BATCH):
            batch = to_embed[start : start + UPSERT_BATCH]
            collection.upsert(
                ids=[c.chunk_id for c in batch],
                embeddings=vectors[start : start + UPSERT_BATCH],
                documents=[c.text for c in batch],
                metadatas=[_metadata(c) for c in batch],
            )

    for start in range(0, len(removed), UPSERT_BATCH):
        collection.delete(ids=removed[start : start + UPSERT_BATCH])

    return IndexResult(
        collection=collection.name,
        added=len(added),
        updated=len(updated),
        unchanged=unchanged,
        removed=len(removed),
        seconds=time.perf_counter() - started,
    )


def truncated_chunks(embedder: Embedder, chunks: Sequence[Chunk]) -> list[tuple[Chunk, int]]:
    """Chunks longer than the model reads, with their token counts.

    A model cuts long input off without any error, so the end of such a chunk is
    never searchable. This is checked on every index run, so a longer unit or a model
    swap cannot quietly reintroduce the problem.
    """
    limit = embedder.max_tokens
    counted = ((chunk, embedder.token_count(embed_text(chunk))) for chunk in chunks)
    return [(chunk, tokens) for chunk, tokens in counted if tokens > limit]


def _stored_hashes(collection: Collection) -> dict[str, str]:
    stored = collection.get(include=["metadatas"])
    return {
        chunk_id: (metadata or {}).get("embed_hash", "")
        for chunk_id, metadata in zip(stored["ids"], stored["metadatas"] or [], strict=True)
    }


def _metadata(chunk: Chunk) -> dict[str, str | int]:
    """Chroma metadata may not hold lists or None, so those are flattened or left out."""
    metadata: dict[str, str | int] = {
        "module_id": chunk.module_id,
        "unit_id": chunk.unit_id,
        "section_type": chunk.section_type,
        "ordinal": chunk.ordinal,
        "heading_path": chunk.heading_path,
        "word_count": chunk.word_count,
        "embed_hash": embed_hash(chunk),
    }
    if chunk.concept_id:
        metadata["concept_id"] = chunk.concept_id
    if chunk.level is not None:
        metadata["level"] = chunk.level
    if chunk.question_nos:
        metadata["question_nos"] = ",".join(str(n) for n in chunk.question_nos)
    return metadata
