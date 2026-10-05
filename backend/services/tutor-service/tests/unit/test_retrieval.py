"""Retrieval and the rules about who may see what.

The corpus is built so the answer key is the closest match to the query. Only the
access rules can keep it out of the results, so a pass here means the rules work and
not that the key happened to rank low.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.content.indexer import embed_text, index_module, open_store
from app.content.models import Chunk
from app.retrieval.access import (
    ANSWER_SECTIONS,
    SEARCHABLE_SECTIONS,
    RetrievalMode,
    searchable_sections,
)
from app.retrieval.retriever import RetrievalError, Retriever
from tests.unit.support import FakeEmbedder, make_chunk

QUERY = "difference between while and do-while loops"


def corpus() -> list[Chunk]:
    """Loops content where the solution and rubric match the query best of all."""
    return [
        make_chunk(
            "prog.loops#theory-01",
            "a while loop checks its condition first and a do-while loop checks it after",
        ),
        make_chunk(
            "prog.loops#example-01",
            "example that counts to five",
            section_type="example",
        ),
        make_chunk(
            "prog.loops#misconception-01",
            "students think a while loop always runs once but a do-while loop does",
            section_type="misconception",
        ),
        make_chunk(
            "prog.loops#facts-01", "a do-while loop always runs at least once", section_type="facts"
        ),
        make_chunk(
            "prog.loops#exercise-q08",
            "explain the difference between a while and a do-while loop",
            section_type="exercise",
            question_nos=(8,),
            level=3,
        ),
        make_chunk(
            "prog.loops#solution-q08",
            "difference between while and do-while loops: do-while runs once before checking",
            section_type="solution",
            question_nos=(8,),
        ),
        make_chunk(
            "prog.loops#rubric-q07",
            "difference between while and do-while loops one mark for naming the check order",
            section_type="rubric",
            question_nos=(7, 8),
        ),
        # A second concept, to prove scoping.
        make_chunk(
            "prog.arrays#theory-01",
            "an array holds many values in one variable",
            concept_id="prog.arrays",
        ),
        make_chunk(
            "prog.arrays#solution-q02",
            "difference between while and do-while loops as used on an array",
            section_type="solution",
            question_nos=(2,),
            concept_id="prog.arrays",
        ),
    ]


@pytest.fixture
def retriever(tmp_path: Path) -> Retriever:
    client = open_store(tmp_path / "chroma")
    embedder = FakeEmbedder()
    chunks = [
        # unit_id follows the chunk id prefix so lookups by unit work
        _with_unit(chunk)
        for chunk in corpus()
    ]
    index_module(client, embedder, "prog", chunks)
    return Retriever(client, embedder)


def _with_unit(chunk: Chunk) -> Chunk:
    from dataclasses import replace

    return replace(chunk, unit_id=chunk.chunk_id.split("#")[0])


def kinds(passages) -> set[str]:
    return {p.section_type for p in passages}


# ------------------------------------------------------------- the rules
def test_the_tutor_never_sees_answer_keys_even_when_they_are_the_best_match(retriever) -> None:
    passages = retriever.search(QUERY, mode=RetrievalMode.TUTORING, module_id="prog", k=20)

    assert passages, "expected some explanatory content"
    assert kinds(passages) <= set(SEARCHABLE_SECTIONS[RetrievalMode.TUTORING])
    assert not kinds(passages) & set(ANSWER_SECTIONS)
    assert "exercise" not in kinds(passages)


def test_question_generation_sees_exercises_as_examples_but_never_answers(retriever) -> None:
    passages = retriever.search(QUERY, mode=RetrievalMode.PRACTICAL, module_id="prog", k=20)

    assert "exercise" in kinds(passages)
    assert not kinds(passages) & set(ANSWER_SECTIONS)


def test_no_mode_but_grading_can_ever_search_answer_keys() -> None:
    for mode, sections in SEARCHABLE_SECTIONS.items():
        if mode is not RetrievalMode.GRADING:
            assert not set(sections) & set(ANSWER_SECTIONS), mode


def test_planning_sections_are_not_searchable_in_any_mode() -> None:
    for mode in RetrievalMode:
        assert not set(searchable_sections(mode)) & {"objectives", "prerequisites", "overview"}


def test_grading_must_name_the_concept_it_is_assessing(retriever) -> None:
    with pytest.raises(RetrievalError, match="must name the concept"):
        retriever.search(QUERY, mode=RetrievalMode.GRADING, module_id="prog")


def test_grading_reaches_answer_keys_but_only_for_its_concept(retriever) -> None:
    passages = retriever.search(
        QUERY,
        mode=RetrievalMode.GRADING,
        module_id="prog",
        concept_ids=["prog.loops"],
        k=20,
    )

    assert kinds(passages) & set(ANSWER_SECTIONS)
    assert {p.concept_id for p in passages} == {"prog.loops"}
    assert "prog.arrays#solution-q02" not in {p.chunk_id for p in passages}


def test_a_concept_filter_narrows_tutoring_too(retriever) -> None:
    passages = retriever.search(
        "values in one variable",
        mode=RetrievalMode.TUTORING,
        module_id="prog",
        concept_ids=["prog.arrays"],
        k=20,
    )

    assert {p.concept_id for p in passages} == {"prog.arrays"}


# ---------------------------------------------------------------- search
def test_results_are_the_true_nearest_allowed_chunks_in_order(retriever) -> None:
    embedder = FakeEmbedder()
    query = embedder.embed_query(QUERY)
    allowed = set(SEARCHABLE_SECTIONS[RetrievalMode.TUTORING])

    # Brute force over every chunk the tutor may see: the retriever must agree.
    def distance(chunk: Chunk) -> float:
        vector = embedder.embed_documents([embed_text(chunk)])[0]
        return 1 - sum(a * b for a, b in zip(query, vector, strict=True))

    visible = [c for c in map(_with_unit, corpus()) if c.section_type in allowed]
    expected = sorted(visible, key=distance)
    # Exact ties make "the nearest" ambiguous and the order arbitrary, which would make
    # this test flaky for a reason that has nothing to do with the retriever.
    assert len({round(distance(c), 9) for c in visible}) == len(visible), "corpus has a tie"

    passages = retriever.search(QUERY, mode=RetrievalMode.TUTORING, module_id="prog", k=3)

    assert [p.chunk_id for p in passages] == [c.chunk_id for c in expected[:3]]
    distances = [p.distance for p in passages]
    assert distances == sorted(distances)


def test_k_limits_the_number_of_results(retriever) -> None:
    assert len(retriever.search(QUERY, mode=RetrievalMode.TUTORING, module_id="prog", k=2)) == 2


def test_a_distance_cut_off_drops_weak_matches(retriever) -> None:
    everything = retriever.search(
        "zebra quantum banana", mode=RetrievalMode.TUTORING, module_id="prog", k=10
    )
    filtered = retriever.search(
        "zebra quantum banana",
        mode=RetrievalMode.TUTORING,
        module_id="prog",
        k=10,
        max_distance=0.2,
    )

    assert everything, "unfiltered search always returns the nearest k"
    assert filtered == []


def test_a_blank_query_returns_nothing(retriever) -> None:
    assert retriever.search("   ", mode=RetrievalMode.TUTORING, module_id="prog") == []


def test_a_passage_carries_what_the_gate_will_need_to_log(retriever) -> None:
    passage = retriever.search(QUERY, mode=RetrievalMode.TUTORING, module_id="prog", k=1)[0]

    assert passage.chunk_id
    assert passage.unit_id == passage.chunk_id.split("#")[0]  # metadata agrees with the ID
    assert passage.concept_id and passage.section_type
    assert passage.heading_path and passage.text and passage.distance is not None


def test_searching_a_module_that_was_never_indexed_says_how_to_fix_it(retriever) -> None:
    with pytest.raises(RetrievalError, match="Run: uv run python -m app.content.cli index"):
        retriever.search(QUERY, mode=RetrievalMode.TUTORING, module_id="dsa")


# -------------------------------------------------------------- grading lookup
def test_question_materials_returns_the_question_solution_and_rubric(retriever) -> None:
    found = retriever.question_materials(module_id="prog", unit_id="prog.loops", question_no=8)

    assert found is not None
    assert found.question.chunk_id == "prog.loops#exercise-q08"
    assert found.solution.chunk_id == "prog.loops#solution-q08"
    # The rubric entry is filed under Q7 but covers Q7 and Q8, so it is found by the
    # question numbers it names.
    assert found.rubric.chunk_id == "prog.loops#rubric-q07"
    assert found.rubric.question_nos == (7, 8)


def test_a_question_without_a_rubric_still_returns_its_solution(retriever) -> None:
    found = retriever.question_materials(module_id="prog", unit_id="prog.arrays", question_no=2)

    assert found is None  # no authored exercise chunk for it in this corpus


def test_asking_for_a_question_that_does_not_exist_returns_none(retriever) -> None:
    assert (
        retriever.question_materials(module_id="prog", unit_id="prog.loops", question_no=99) is None
    )


def test_materials_never_leak_another_units_rubric(retriever) -> None:
    found = retriever.question_materials(module_id="prog", unit_id="prog.loops", question_no=8)

    assert found.rubric.unit_id == "prog.loops"


# ----------------------------------------------------- narrowing the sections
def test_a_caller_can_narrow_a_modes_sections(retriever) -> None:
    only_exercises = retriever.search(
        QUERY, mode=RetrievalMode.PRACTICAL, module_id="prog", sections=["exercise"], k=10
    )
    grounding = retriever.search(
        QUERY, mode=RetrievalMode.PRACTICAL, module_id="prog", sections=["theory", "facts"], k=10
    )

    assert kinds(only_exercises) == {"exercise"}
    assert kinds(grounding) <= {"theory", "facts"} and grounding


def test_a_caller_can_never_widen_a_mode(retriever) -> None:
    for mode, wanted in (
        (RetrievalMode.TUTORING, ["solution"]),
        (RetrievalMode.TUTORING, ["theory", "rubric"]),
        (RetrievalMode.PRACTICAL, ["solution"]),
        (RetrievalMode.TUTORING, ["exercise"]),
    ):
        with pytest.raises(RetrievalError, match="may not search"):
            retriever.search(QUERY, mode=mode, module_id="prog", sections=wanted)


def test_an_empty_section_list_is_an_error_not_everything(retriever) -> None:
    with pytest.raises(RetrievalError, match="may not search"):
        retriever.search(QUERY, mode=RetrievalMode.TUTORING, module_id="prog", sections=[])
