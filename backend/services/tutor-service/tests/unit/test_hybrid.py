"""Keyword ranking, rank fusion, and the hybrid retriever built from them."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from app.content.indexer import index_module, open_store
from app.retrieval.access import ANSWER_SECTIONS, RetrievalMode
from app.retrieval.hybrid import BM25, reciprocal_rank_fusion, tokens
from app.retrieval.retriever import RetrievalError, Retriever
from tests.unit.support import FakeEmbedder, make_chunk
from tests.unit.test_retrieval import QUERY, corpus


# ------------------------------------------------------------------- tokenizing
def test_tokens_keep_words_and_numbers_and_drop_code_punctuation() -> None:
    assert tokens("for (int i = 0; i < n; i++) { sum += i; }") == [
        "for", "int", "i", "0", "i", "n", "i", "sum", "i",
    ]  # fmt: skip
    assert tokens("do-while loops, 3 times") == ["do", "while", "loops", "3", "times"]


# ------------------------------------------------------------------------- BM25
DOCS = [
    tokens("a while loop repeats while a condition holds"),
    tokens("a for loop has an initialisation a condition and an update"),
    tokens("arrays hold many values in one variable"),
]


def test_a_document_sharing_no_term_is_not_ranked_at_all() -> None:
    ranked = BM25(DOCS).rank(tokens("zebra quantum"), limit=10)

    assert ranked == []


def test_the_document_with_the_rare_matching_term_ranks_first() -> None:
    bm25 = BM25(DOCS)

    assert bm25.rank(tokens("arrays"), limit=3)[0] == 2
    assert bm25.rank(tokens("initialisation update"), limit=3)[0] == 1


def test_a_rarer_term_outweighs_a_common_one() -> None:
    # "a" is in every document, "initialisation" in one: the rare term decides.
    assert BM25(DOCS).rank(tokens("a initialisation"), limit=3)[0] == 1


def test_ranking_can_be_limited_to_allowed_documents() -> None:
    bm25 = BM25(DOCS)

    assert bm25.rank(tokens("loop"), allowed=[1], limit=5) == [1]
    assert bm25.rank(tokens("loop"), allowed=[], limit=5) == []


def test_bm25_over_nothing_is_empty_not_an_error() -> None:
    assert BM25([]).rank(tokens("anything"), limit=5) == []


# ------------------------------------------------------------------- fusion
def test_an_item_ranked_well_by_both_lists_beats_one_ranked_first_by_only_one() -> None:
    assert reciprocal_rank_fusion([["a", "b", "c"], ["b", "x", "a"]])[0] == "b"


def test_an_item_only_one_list_found_still_appears() -> None:
    fused = reciprocal_rank_fusion([["a", "b"], ["c"]])

    assert set(fused) == {"a", "b", "c"}


def test_fusion_is_deterministic_on_ties() -> None:
    first = reciprocal_rank_fusion([["a"], ["b"]])

    assert first == reciprocal_rank_fusion([["a"], ["b"]])
    assert first == ["a", "b"]  # equal scores: whichever appeared first


def test_fusing_nothing_gives_nothing() -> None:
    assert reciprocal_rank_fusion([[], []]) == []


# --------------------------------------------------------------- the retriever
@pytest.fixture
def retriever(tmp_path: Path) -> Retriever:
    client = open_store(tmp_path / "chroma")
    embedder = FakeEmbedder()
    chunks = [replace(c, unit_id=c.chunk_id.split("#")[0]) for c in corpus()]
    index_module(client, embedder, "prog", chunks)
    return Retriever(client, embedder)


@pytest.mark.parametrize("method", ["hybrid", "dense"])
def test_the_tutor_never_sees_answer_keys_with_either_method(retriever, method) -> None:
    passages = retriever.search(
        QUERY, mode=RetrievalMode.TUTORING, module_id="prog", k=20, method=method
    )

    assert passages
    kinds = {p.section_type for p in passages}
    assert not kinds & set(ANSWER_SECTIONS)
    assert "exercise" not in kinds


@pytest.mark.parametrize("method", ["hybrid", "dense"])
def test_question_generation_never_sees_answer_keys_with_either_method(retriever, method) -> None:
    passages = retriever.search(
        QUERY, mode=RetrievalMode.PRACTICAL, module_id="prog", k=20, method=method
    )

    assert not {p.section_type for p in passages} & set(ANSWER_SECTIONS)


@pytest.mark.parametrize("method", ["hybrid", "dense"])
def test_grading_stays_inside_its_concept_with_either_method(retriever, method) -> None:
    passages = retriever.search(
        QUERY,
        mode=RetrievalMode.GRADING,
        module_id="prog",
        concept_ids=["prog.loops"],
        k=20,
        method=method,
    )

    assert passages
    assert {p.concept_id for p in passages} == {"prog.loops"}


def test_a_keyword_that_only_the_keyword_ranking_knows_still_finds_its_chunk(tmp_path) -> None:
    """The reason for hybrid: an exact rare term should not be lost to vague similarity."""
    client = open_store(tmp_path / "chroma")
    embedder = FakeEmbedder()
    rare = make_chunk(
        "prog.loops#theory-09", "the sentinel value ends the reading loop", concept_id="prog.loops"
    )
    others = [
        make_chunk(f"prog.loops#theory-{n:02d}", f"a loop does thing number {n}")
        for n in range(1, 8)
    ]
    chunks = [replace(c, unit_id="prog.loops") for c in [*others, rare]]
    index_module(client, embedder, "prog", chunks)
    retriever = Retriever(client, embedder)

    found = retriever.search(
        "sentinel", mode=RetrievalMode.TUTORING, module_id="prog", k=3, method="hybrid"
    )

    assert "prog.loops#theory-09" in [p.chunk_id for p in found]


def test_a_distance_cut_off_still_drops_weak_matches_in_hybrid(retriever) -> None:
    weak = retriever.search(
        "zebra quantum banana",
        mode=RetrievalMode.TUTORING,
        module_id="prog",
        k=10,
        max_distance=0.2,
    )

    assert weak == []


def test_hybrid_is_the_default_method(retriever) -> None:
    default = retriever.search(QUERY, mode=RetrievalMode.TUTORING, module_id="prog", k=5)
    explicit = retriever.search(
        QUERY, mode=RetrievalMode.TUTORING, module_id="prog", k=5, method="hybrid"
    )

    assert [p.chunk_id for p in default] == [p.chunk_id for p in explicit]


def test_hybrid_respects_narrowed_sections_and_refuses_forbidden_ones(retriever) -> None:
    only_facts = retriever.search(
        QUERY, mode=RetrievalMode.TUTORING, module_id="prog", sections=["facts"], k=10
    )

    assert {p.section_type for p in only_facts} == {"facts"}
    with pytest.raises(RetrievalError, match="may not search"):
        retriever.search(QUERY, mode=RetrievalMode.TUTORING, module_id="prog", sections=["rubric"])


def test_the_keyword_pool_follows_a_reindex_in_the_same_process(tmp_path) -> None:
    client = open_store(tmp_path / "chroma")
    embedder = FakeEmbedder()
    first = [replace(make_chunk("prog.loops#theory-01", "alpha beta gamma"), unit_id="u")]
    index_module(client, embedder, "prog", first)
    retriever = Retriever(client, embedder)
    retriever.search("alpha", mode=RetrievalMode.TUTORING, module_id="prog")

    second = [*first, replace(make_chunk("prog.loops#theory-02", "uniqueterm"), unit_id="u")]
    index_module(client, embedder, "prog", second)
    found = retriever.search("uniqueterm", mode=RetrievalMode.TUTORING, module_id="prog", k=5)

    assert "prog.loops#theory-02" in [p.chunk_id for p in found]
