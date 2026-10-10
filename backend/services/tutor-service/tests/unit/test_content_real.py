"""The actual Programming course, parsed with no database.

These pin facts about the authored content, so an edit that quietly breaks the
structure (a lost solution, a merged question) fails here rather than at retrieval.
They are also the cross-check that the chunker agrees with an independent count.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

from app.content.chunker import THEORY_MAX_WORDS, chunk_unit
from app.content.loader import load_content
from app.content.models import INDEXED_SECTION_TYPES
from app.content.validate import validate

CONTENT = Path(__file__).resolve().parents[2] / "content"


@pytest.fixture(scope="module")
def units():
    return load_content(CONTENT, "prog")


@pytest.fixture(scope="module")
def chunks(units):
    return {u.unit_id: chunk_unit(u) for u in units}


def all_chunks(chunks):
    return [c for group in chunks.values() for c in group]


def test_the_module_has_an_introduction_and_thirteen_concepts(units) -> None:
    concepts = [u for u in units if u.kind == "concept"]

    assert len(units) == 14
    assert len(concepts) == 13
    assert [u.sequence for u in units] == list(range(14))


def test_the_content_passes_every_structural_check(units, chunks) -> None:
    issues = validate(units, chunks)

    errors = [i for i in issues if i.severity == "error"]
    assert errors == [], "\n".join(str(i) for i in errors)

    # No warnings: every level-2 question has an expected-output block, so it can be
    # marked exactly. Pinned so that any NEW question that cannot be marked automatically
    # is noticed rather than slipping in.
    warnings = [i.message.split(":")[0] for i in issues if i.severity == "warning"]
    assert warnings == []


def test_every_concept_has_at_least_two_gating_questions(units, chunks) -> None:
    """Mastery needs two gating results. A concept with one could never be mastered."""
    from app.domain.questions import KIND_PREDICT, build_question_bank

    bank = build_question_bank(all_chunks(chunks))
    for unit in units:
        if unit.concept_id:
            gating = [
                e
                for e in bank.values()
                if e.question.concept_id == unit.concept_id and e.question.kind == KIND_PREDICT
            ]
            assert len(gating) >= 2, unit.concept_id


def test_every_question_has_a_solution_and_a_matching_rubric(chunks) -> None:
    items = all_chunks(chunks)
    exercises = [c for c in items if c.section_type == "exercise"]
    solutions = [c for c in items if c.section_type == "solution"]

    assert len(exercises) == 143
    assert len(solutions) == 143
    assert Counter(c.level for c in exercises) == {1: 52, 2: 26, 3: 26, 4: 26, 5: 13}

    # Levels 3 to 5 are 65 questions, and the 41 rubric entries cover exactly those.
    rubric_numbers = sum(len(c.question_nos) for c in items if c.section_type == "rubric")
    assert rubric_numbers == 65


def test_every_chunk_is_a_known_type_with_unique_stable_ids(chunks) -> None:
    items = all_chunks(chunks)
    ids = [c.chunk_id for c in items]

    assert len(ids) == len(set(ids))
    assert {c.section_type for c in items} <= set(INDEXED_SECTION_TYPES)
    assert all(c.chunk_id.startswith(f"{c.unit_id}#") for c in items)


def test_theory_chunks_respect_the_size_limit_unless_a_single_block_is_larger(
    units, chunks
) -> None:
    for unit in units:
        blocks = [len(s.text.split()) for s in unit.sections if s.section_type == "theory"]
        for chunk in chunks[unit.unit_id]:
            if chunk.section_type == "theory" and chunk.word_count > THEORY_MAX_WORDS:
                # Only allowed when it is one block that was already too large.
                assert chunk.word_count in blocks, chunk.chunk_id


def test_no_text_is_lost_between_the_files_and_the_chunks(units, chunks) -> None:
    """Every word of every indexed section ends up in some chunk."""
    for unit in units:
        authored = sum(
            len(s.text.split()) for s in unit.sections if s.section_type in INDEXED_SECTION_TYPES
        )
        chunked = sum(c.word_count for c in chunks[unit.unit_id])
        # Splitting drops only section headings (## Practice Questions, ### Level N and
        # the like), a handful of words per file, never body text.
        assert 0 <= authored - chunked <= 60, unit.unit_id


def test_concept_ids_are_the_ones_seeded_for_the_platform(units) -> None:
    csv = (
        Path(__file__).resolve().parents[5] / "database/seed/concepts_programming.csv"
    ).read_text(encoding="utf-8")
    seeded = {line.split(",")[0] for line in csv.splitlines()[1:] if line.strip()}

    assert {u.concept_id for u in units if u.concept_id} == seeded
