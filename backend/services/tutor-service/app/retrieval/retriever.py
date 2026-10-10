"""Find the course material relevant to a question, within what a mode may see.

Reads only ChromaDB (this service's private store), never Postgres, so retrieval
works with the database unreachable and its latency is the vector search alone.

Two ways in:

    search(...)              restricted to the mode's section types and always to one
                             module (one collection per module). By default hybrid: the
                             embedding ranking and a BM25 keyword ranking fused by rank,
                             which measured never worse than either and significantly
                             better than embeddings alone on questions that contain
                             code. `method="dense"` is the embedding ranking alone.
    question_materials(...)  exact lookup of one authored question with its solution
                             and rubric, for grading. No similarity involved.

The keyword index is built only from the sections the mode may see, so keyword search
cannot return anything the embedding search could not.

A Passage carries its cosine distance when the embedding search found it (0 is
identical, around 0.2 a close match, larger weaker), and None when only the keyword
ranking did. Hybrid results are ordered by fused rank, not by distance. The faithfulness
gate later logs the IDs it was handed, which is why a Passage keeps its chunk_id.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from chromadb.api import ClientAPI
from chromadb.api.models.Collection import Collection

from app.content.embedder import Embedder
from app.content.indexer import collection_name
from app.content.models import question_chunk_id
from app.retrieval.access import (
    CONCEPT_SCOPED_MODES,
    RetrievalMode,
    searchable_sections,
)
from app.retrieval.hybrid import BM25, reciprocal_rank_fusion, tokens

Method = Literal["hybrid", "dense"]

# How deep each ranking goes before fusion. The whole tutoring pool is a few hundred
# chunks, so this is generous; it is what the evaluation used.
FUSION_DEPTH = 60


class RetrievalError(Exception):
    """Retrieval was asked for something it must not or cannot do."""


@dataclass(frozen=True)
class Passage:
    chunk_id: str
    unit_id: str
    concept_id: str | None
    section_type: str
    heading_path: str
    text: str
    distance: float | None
    question_nos: tuple[int, ...] = ()
    level: int | None = None


@dataclass(frozen=True)
class QuestionMaterials:
    """One authored question with the answer material used to grade it."""

    question: Passage
    solution: Passage | None
    rubric: Passage | None


@dataclass(frozen=True)
class _KeywordPool:
    """The chunks a mode may see in one module, indexed for keyword search."""

    passages: list[Passage]
    bm25: BM25


class Retriever:
    def __init__(self, client: ClientAPI, embedder: Embedder) -> None:
        self._client = client
        self._embedder = embedder
        # Keyed by module, allowed sections and collection size, so re-indexing in the
        # same process builds a fresh pool instead of serving a stale one.
        self._pools: dict[tuple[str, tuple[str, ...], int], _KeywordPool] = {}

    # ------------------------------------------------------------------ search
    def search(
        self,
        query: str,
        *,
        mode: RetrievalMode,
        module_id: str,
        concept_ids: Sequence[str] | None = None,
        sections: Sequence[str] | None = None,
        k: int = 5,
        max_distance: float | None = None,
        method: Method = "hybrid",
    ) -> list[Passage]:
        """The k best passages for `query` that `mode` is allowed to see.

        concept_ids narrows the search to those concepts. Grading requires it.
        sections narrows it to some of the mode's section types, for example the
        generator searching `theory` for grounding and `exercise` for style examples
        separately, so exercises do not crowd out the theory. It can only narrow:
        asking for a type the mode may not see is an error, not a silent drop.
        max_distance drops weak matches, so a question the course does not cover
        returns nothing rather than the least-bad paragraph. A passage only the keyword
        ranking found has no distance and cannot satisfy a distance cut-off.
        """
        if not query.strip():
            return []
        if k < 1:
            raise RetrievalError("k must be at least 1")
        if mode in CONCEPT_SCOPED_MODES and not concept_ids:
            raise RetrievalError(
                f"{mode.value} retrieval must name the concept being assessed: its evidence "
                "is answer keys, which are never searched across a whole module"
            )

        allowed = searchable_sections(mode)
        if sections is not None:
            forbidden = [name for name in sections if name not in allowed]
            if forbidden or not sections:
                raise RetrievalError(
                    f"{mode.value} retrieval may not search: {', '.join(forbidden) or 'nothing'}. "
                    f"Allowed: {', '.join(allowed)}"
                )
            allowed = tuple(sections)

        collection = self._collection(module_id)
        depth = k if method == "dense" else max(k, FUSION_DEPTH)
        result = collection.query(
            query_embeddings=[self._embedder.embed_query(query)],
            n_results=depth,
            where=_where(allowed, concept_ids),
            include=["documents", "metadatas", "distances"],
        )
        dense = [
            _passage(chunk_id, document, metadata, distance)
            for chunk_id, document, metadata, distance in zip(
                result["ids"][0],
                result["documents"][0],
                result["metadatas"][0],
                result["distances"][0],
                strict=True,
            )
        ]

        if method == "dense":
            passages = dense[:k]
        else:
            passages = self._fuse(collection, module_id, query, allowed, concept_ids, dense, k)

        if max_distance is not None:
            passages = [
                p for p in passages if p.distance is not None and p.distance <= max_distance
            ]
        return passages

    # ------------------------------------------------------- exact, for grading
    def question_materials(
        self, *, module_id: str, unit_id: str, question_no: int
    ) -> QuestionMaterials | None:
        """The authored question, its solution and the rubric entry covering it.

        None if the question does not exist. Solution or rubric is None if the
        content has none (an MCQ has a solution but no rubric).
        """
        collection = self._collection(module_id)

        question = _get_one(collection, question_chunk_id(unit_id, "exercise", question_no))
        if question is None:
            return None

        # A rubric entry can cover several questions ("Q9 to Q11"), so it is found by
        # the question numbers it names, not by an ID derived from this question.
        rubrics = collection.get(
            where={"$and": [{"unit_id": unit_id}, {"section_type": "rubric"}]},
            include=["documents", "metadatas"],
        )
        rubric = next(
            (
                _passage(chunk_id, document, metadata, None)
                for chunk_id, document, metadata in zip(
                    rubrics["ids"], rubrics["documents"], rubrics["metadatas"], strict=True
                )
                if question_no in _question_nos(metadata)
            ),
            None,
        )

        return QuestionMaterials(
            question=question,
            solution=_get_one(collection, question_chunk_id(unit_id, "solution", question_no)),
            rubric=rubric,
        )

    # ----------------------------------------------------------------- helpers
    def _fuse(
        self,
        collection: Collection,
        module_id: str,
        query: str,
        allowed: Sequence[str],
        concept_ids: Sequence[str] | None,
        dense: list[Passage],
        k: int,
    ) -> list[Passage]:
        """Merge the embedding ranking with a BM25 ranking of the same permitted pool."""
        pool = self._pool(collection, module_id, allowed)

        wanted = set(concept_ids) if concept_ids else None
        candidates = (
            [i for i, p in enumerate(pool.passages) if p.concept_id in wanted] if wanted else None
        )
        keyword = [
            pool.passages[i]
            for i in pool.bm25.rank(tokens(query), allowed=candidates, limit=FUSION_DEPTH)
        ]

        fused = reciprocal_rank_fusion(
            [[p.chunk_id for p in dense], [p.chunk_id for p in keyword]]
        )[:k]

        # Prefer the embedding result when there is one: it carries the distance.
        known = {p.chunk_id: p for p in keyword} | {p.chunk_id: p for p in dense}
        return [known[chunk_id] for chunk_id in fused]

    def _pool(self, collection: Collection, module_id: str, allowed: Sequence[str]) -> _KeywordPool:
        key = (module_id, tuple(sorted(allowed)), collection.count())
        if key not in self._pools:
            stored = collection.get(
                where={"section_type": {"$in": list(allowed)}},
                include=["documents", "metadatas"],
            )
            passages = [
                _passage(chunk_id, document, metadata, None)
                for chunk_id, document, metadata in zip(
                    stored["ids"], stored["documents"], stored["metadatas"], strict=True
                )
            ]
            # The same text the embedding model sees: heading path, then the chunk.
            self._pools[key] = _KeywordPool(
                passages=passages,
                bm25=BM25([tokens(f"{p.heading_path}\n\n{p.text}") for p in passages]),
            )
        return self._pools[key]

    def _collection(self, module_id: str) -> Collection:
        name = collection_name(module_id, self._embedder.name)
        try:
            collection = self._client.get_collection(name)
        except Exception as exc:  # chromadb raises different types across versions
            raise RetrievalError(
                f"no index for module `{module_id}` with model `{self._embedder.name}`. "
                "Run: uv run python -m app.content.cli index"
            ) from exc
        return collection


def _where(sections: Sequence[str], concept_ids: Sequence[str] | None) -> dict[str, Any]:
    conditions: list[dict[str, Any]] = [{"section_type": {"$in": list(sections)}}]
    if concept_ids:
        conditions.append({"concept_id": {"$in": list(concept_ids)}})
    return conditions[0] if len(conditions) == 1 else {"$and": conditions}


def _question_nos(metadata: dict[str, Any] | None) -> tuple[int, ...]:
    raw = (metadata or {}).get("question_nos")
    return tuple(int(n) for n in str(raw).split(",")) if raw else ()


def _passage(
    chunk_id: str, document: str, metadata: dict[str, Any] | None, distance: float | None
) -> Passage:
    metadata = metadata or {}
    level = metadata.get("level")
    return Passage(
        chunk_id=chunk_id,
        unit_id=str(metadata.get("unit_id", "")),
        concept_id=metadata.get("concept_id"),
        section_type=str(metadata.get("section_type", "")),
        heading_path=str(metadata.get("heading_path", "")),
        text=document,
        distance=distance,
        question_nos=_question_nos(metadata),
        level=int(level) if level is not None else None,
    )


def _get_one(collection: Collection, chunk_id: str) -> Passage | None:
    found = collection.get(ids=[chunk_id], include=["documents", "metadatas"])
    if not found["ids"]:
        return None
    return _passage(found["ids"][0], found["documents"][0], found["metadatas"][0], None)
