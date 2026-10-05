"""Turn text into vectors. Local models only, no network once the model is cached.

The rest of the pipeline sees only the Embedder protocol, so the model is a setting
(TUTOR_EMBEDDING_MODEL) and a test can pass a fake that downloads nothing. Documents
and queries are embedded through different methods because some retrieval models are
trained to expect an instruction on the query side and not on the passage side.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Protocol

# Models trained with a query-side instruction. Applying it is part of using them
# correctly: without it their retrieval quality drops. Passages never get a prefix.
QUERY_PREFIXES = {
    "BAAI/bge-small-en-v1.5": "Represent this sentence for searching relevant passages: ",
    "BAAI/bge-base-en-v1.5": "Represent this sentence for searching relevant passages: ",
}

BATCH_SIZE = 32


class Embedder(Protocol):
    name: str

    @property
    def max_tokens(self) -> int:
        """Longest input the model reads. Anything longer is silently cut off."""
        ...

    def token_count(self, text: str) -> int: ...

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class SentenceTransformerEmbedder:
    """A sentence-transformers model run on the local CPU or GPU."""

    def __init__(self, model_name: str) -> None:
        self.name = model_name
        self._query_prefix = QUERY_PREFIXES.get(model_name, "")
        self._model = None  # loaded on first use: importing torch is slow

    def _load(self):  # noqa: ANN202
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.name)
        return self._model

    @property
    def max_tokens(self) -> int:
        """Longest input the model reads. Longer text is silently cut off."""
        return int(self._load().max_seq_length)

    def token_count(self, text: str) -> int:
        return len(self._load().tokenizer(text)["input_ids"])

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        vectors = self._load().encode(
            list(texts), normalize_embeddings=True, batch_size=BATCH_SIZE, show_progress_bar=False
        )
        return vectors.tolist()

    def embed_query(self, text: str) -> list[float]:
        vector = self._load().encode(
            self._query_prefix + text, normalize_embeddings=True, show_progress_bar=False
        )
        return vector.tolist()


def model_slug(model_name: str) -> str:
    """'BAAI/bge-small-en-v1.5' -> 'bge-small-en-v1-5', safe inside a collection name."""
    name = model_name.rsplit("/", 1)[-1].lower()
    return re.sub(r"[^a-z0-9]+", "-", name).strip("-")
