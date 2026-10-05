"""How a Unit is cut into chunks. Built directly from sections, no files involved."""

from __future__ import annotations

import pytest

from app.content.chunker import THEORY_MAX_WORDS, _rubric_question_numbers, chunk_unit
from app.content.models import Section, Unit


def unit_of(*sections: Section) -> Unit:
    return Unit(
        unit_id="prog.demo",
        module_id="prog",
        concept_id="prog.demo",
        kind="concept",
        sequence=1,
        topic="T",
        title="1. Demo",
        difficulty=1,
        prerequisites=(),
        cross_module_prerequisites=(),
        java_version=21,
        version=1,
        status="draft",
        source_path="prog/01-demo.md",
        content_hash="x",
        sections=sections,
    )


def section(
    kind: str, text: str, *, path: str = "Demo > X", headings: tuple[str, ...] = ()
) -> Section:
    return Section(kind, text, path, headings, 1)


def words(n: int) -> str:
    return " ".join(["word"] * n)


# ------------------------------------------------------------------ theory
def test_small_theory_blocks_merge_up_to_the_limit() -> None:
    chunks = chunk_unit(
        unit_of(
            section("theory", words(80), headings=("A",)),
            section("theory", words(80), headings=("B",)),
            section("theory", words(80), headings=("C",)),
        )
    )

    # 80 + 80 fits in 200; adding a third (240) does not.
    assert [c.word_count for c in chunks] == [160, 80]
    assert chunks[0].headings == ("A", "B")
    assert chunks[1].headings == ("C",)
    assert all(c.word_count <= THEORY_MAX_WORDS for c in chunks)


def test_an_oversized_theory_block_is_kept_whole() -> None:
    chunks = chunk_unit(unit_of(section("theory", words(THEORY_MAX_WORDS + 40))))

    assert len(chunks) == 1
    assert chunks[0].word_count == THEORY_MAX_WORDS + 40


def test_theory_does_not_merge_across_another_section() -> None:
    chunks = chunk_unit(
        unit_of(
            section("theory", words(10)),
            section("example", words(10)),
            section("theory", words(10)),
        )
    )

    assert [c.section_type for c in chunks] == ["theory", "example", "theory"]


def test_a_merged_chunk_takes_its_path_from_the_first_block() -> None:
    chunks = chunk_unit(
        unit_of(
            section("theory", words(20), path="Demo > Theory > First"),
            section("theory", words(20), path="Demo > Theory > Second"),
        )
    )

    assert chunks[0].heading_path == "Demo > Theory > First"


# ---------------------------------------------------- one chunk per example
def test_every_example_is_its_own_chunk_even_when_tiny() -> None:
    chunks = chunk_unit(unit_of(section("example", words(5)), section("example", words(5))))

    assert [c.chunk_id for c in chunks] == ["prog.demo#example-01", "prog.demo#example-02"]


# ----------------------------------------------------------- misconceptions
def test_each_misconception_is_a_chunk() -> None:
    text = (
        "## Common Misconceptions\n\n"
        '**"First wrong idea."**\nIt is wrong because of this.\n\n'
        '**"Second wrong idea."**\nIt is wrong because of that.\n'
    )
    chunks = chunk_unit(unit_of(section("misconception", text)))

    assert len(chunks) == 2
    assert chunks[0].text.startswith('**"First wrong idea."**')
    assert "Second" not in chunks[0].text
    assert "Common Misconceptions" not in chunks[0].text


# ---------------------------------------------------------------- questions
EXERCISE = """## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** First?
A. x  B. y

**Q2.** Second?

### Level 3: Explain

**Q7.** Explain it.

```java
// ### Level 9: this is code, not a heading
int x = 1;
```

### Level 4: Implement

**Q9. Title.** Write it.
"""


def test_each_question_is_a_chunk_with_its_level() -> None:
    chunks = chunk_unit(unit_of(section("exercise", EXERCISE)))

    assert [(c.question_nos, c.level) for c in chunks] == [
        ((1,), 1),
        ((2,), 1),
        ((7,), 3),
        ((9,), 4),
    ]
    assert [c.chunk_id for c in chunks] == [
        "prog.demo#exercise-q01",
        "prog.demo#exercise-q02",
        "prog.demo#exercise-q07",
        "prog.demo#exercise-q09",
    ]


def test_a_level_heading_never_leaks_into_the_previous_question() -> None:
    chunks = chunk_unit(unit_of(section("exercise", EXERCISE)))

    assert "Level 3" not in chunks[1].text
    assert "Level 4" not in chunks[2].text


def test_code_inside_a_question_stays_with_it() -> None:
    chunks = chunk_unit(unit_of(section("exercise", EXERCISE)))
    q7 = next(c for c in chunks if c.question_nos == (7,))

    assert "int x = 1;" in q7.text
    assert "Level 9" in q7.text  # inside the fence, so it is just text


def test_solutions_split_per_question_without_levels() -> None:
    text = "## Solutions\n\n**Q1.** B.\n\n**Q2.**\n\n```output\n5\n```\n"
    chunks = chunk_unit(unit_of(section("solution", text)))

    assert [(c.question_nos, c.level) for c in chunks] == [((1,), None), ((2,), None)]
    assert "```output" in chunks[1].text


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("**Q7 (Explain, 3 marks)**", (7,)),
        ("**Q9 to Q11 (Implement and Challenge)**", (9, 10, 11)),
        ("**Q9, Q10 (Implement)**", (9, 10)),
        ("**Q9 and Q10 (Implement)**", (9, 10)),
        ("**Q11 (Challenge)**", (11,)),
    ],
)
def test_a_rubric_header_names_every_question_it_covers(header: str, expected: tuple) -> None:
    assert _rubric_question_numbers(header) == expected


def test_a_rubric_entry_can_cover_several_questions() -> None:
    text = (
        "## Marking Rubrics\n\n"
        "**Q7 (Explain, 3 marks)**\n- 1 mark: a.\n\n"
        "**Q9 to Q11 (Implement and Challenge)**\n- Output matches.\n"
    )
    chunks = chunk_unit(unit_of(section("rubric", text)))

    assert [c.question_nos for c in chunks] == [(7,), (9, 10, 11)]
    assert chunks[1].chunk_id == "prog.demo#rubric-q09"


# ------------------------------------------------------------------- others
def test_further_practice_is_not_indexed() -> None:
    chunks = chunk_unit(
        unit_of(section("further_practice", "- https://example.com"), section("facts", "- A."))
    )

    assert [c.section_type for c in chunks] == ["facts"]


def test_ordinals_follow_reading_order_and_are_gapless() -> None:
    chunks = chunk_unit(
        unit_of(
            section("objectives", "1. a"),
            section("theory", words(30)),
            section("facts", "- f"),
        )
    )

    assert [c.ordinal for c in chunks] == [0, 1, 2]


def test_chunking_is_deterministic() -> None:
    unit = unit_of(section("theory", words(30)), section("exercise", EXERCISE))
    assert chunk_unit(unit) == chunk_unit(unit)


def test_an_edit_changes_only_that_chunks_hash() -> None:
    before = chunk_unit(unit_of(section("example", "one"), section("example", "two")))
    after = chunk_unit(unit_of(section("example", "one"), section("example", "TWO")))

    assert before[0].text_hash == after[0].text_hash
    assert before[1].text_hash != after[1].text_hash


def test_question_chunks_do_not_inherit_the_whole_blocks_headings() -> None:
    # The block holds every Level heading; a single question must not claim them all.
    block = Section("exercise", EXERCISE, "Demo > Practice Questions", ("L1", "L3", "L4"), 1)
    chunks = chunk_unit(unit_of(block))

    assert all(c.headings == () for c in chunks)


def test_an_example_keeps_its_own_heading() -> None:
    block = Section("example", "text", "Demo > Worked Examples > Example 2", ("Example 2",), 1)

    assert chunk_unit(unit_of(block))[0].headings == ("Example 2",)
