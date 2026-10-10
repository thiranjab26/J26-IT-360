"""The validator must be able to fail, or a clean report means nothing.

Each test starts from a small valid unit and breaks exactly one thing.
"""

from __future__ import annotations

from dataclasses import replace

from app.content.chunker import chunk_unit
from app.content.models import Section, Unit
from app.content.validate import validate

EXERCISE = """## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** First?
A. one  B. two  C. three  D. four

### Level 3: Explain

**Q7.** Explain it.

### Level 4: Implement

**Q9.** Write it.
"""

SOLUTION = "## Solutions\n\n**Q1.** B.\n\n**Q7.** Because.\n\n**Q9.** Code.\n"
RUBRIC = "## Marking Rubrics\n\n**Q7 (Explain, 2 marks)**\n- a.\n\n**Q9 (Implement)**\n- b.\n"


def make_sections(**overrides: str | None) -> tuple[Section, ...]:
    texts = {
        "objectives": "1. a",
        "prerequisites": "From x.",
        "theory": "words",
        "example": "ex",
        "misconception": '**"a"**\nb',
        "facts": "- f",
        "exercise": EXERCISE,
        "solution": SOLUTION,
        "rubric": RUBRIC,
    }
    texts.update(overrides)
    return tuple(Section(k, v, "D > X", (), 1) for k, v in texts.items() if v is not None)


def make_unit(
    *,
    unit_id: str = "prog.b",
    sequence: int = 2,
    prerequisites: tuple[str, ...] = ("prog.a",),
    sections: tuple[Section, ...] | None = None,
    **fields,
) -> Unit:
    base = Unit(
        unit_id=unit_id,
        module_id="prog",
        concept_id=unit_id,
        kind="concept",
        sequence=sequence,
        topic="T",
        title="2. B",
        difficulty=1,
        prerequisites=prerequisites,
        cross_module_prerequisites=(),
        java_version=21,
        version=1,
        status="draft",
        source_path=f"prog/{sequence:02d}-{unit_id.split('.')[1]}.md",
        content_hash="x",
        sections=sections or make_sections(),
    )
    return replace(base, **fields)


def first_unit() -> Unit:
    return make_unit(unit_id="prog.a", sequence=1, prerequisites=())


def check(units: list[Unit], **kwargs):
    chunks = {u.unit_id: chunk_unit(u) for u in units}
    return validate(units, chunks, **kwargs)


def messages(issues) -> str:
    return "\n".join(str(i) for i in issues)


def test_a_valid_course_has_no_issues() -> None:
    assert check([first_unit(), make_unit()]) == []


def test_a_question_without_a_solution_is_an_error() -> None:
    broken = make_unit(sections=make_sections(solution="## Solutions\n\n**Q1.** B.\n\n**Q9.** x\n"))
    issues = check([first_unit(), broken])

    assert "Q7 has no solution" in messages(issues)


def test_a_free_form_question_without_a_rubric_is_an_error() -> None:
    broken = make_unit(
        sections=make_sections(rubric="## Marking Rubrics\n\n**Q7 (Explain)**\n- a.\n")
    )

    assert "Q9 (level 4) has no rubric entry" in messages(check([first_unit(), broken]))


def test_an_mcq_does_not_need_a_rubric() -> None:
    # Q1 is level 1 and has no rubric in the valid unit, and that is fine.
    assert "Q1" not in messages(check([first_unit(), make_unit()]))


def test_a_solution_for_a_missing_question_is_an_error() -> None:
    extra = SOLUTION + "\n**Q4.** orphan\n"
    broken = make_unit(sections=make_sections(solution=extra))

    assert "solution for Q4 has no matching question" in messages(check([first_unit(), broken]))


def test_a_missing_required_section_is_an_error() -> None:
    broken = make_unit(sections=make_sections(misconception=None))

    assert "missing required section `misconception`" in messages(check([first_unit(), broken]))


def test_a_prerequisite_that_does_not_exist_is_an_error() -> None:
    broken = make_unit(prerequisites=("prog.nope",))

    assert "prog.nope is not a known concept" in messages(check([first_unit(), broken]))


def test_a_prerequisite_taught_later_is_an_error() -> None:
    later = make_unit(unit_id="prog.c", sequence=3, prerequisites=())
    broken = make_unit(prerequisites=("prog.c",))

    assert "is not taught before this concept" in messages(check([first_unit(), broken, later]))


def test_a_filename_that_disagrees_with_the_sequence_is_an_error() -> None:
    broken = make_unit(source_path="prog/05-b.md")

    assert "does not match sequence" in messages(check([first_unit(), broken]))


def test_a_file_in_the_wrong_module_folder_is_an_error() -> None:
    broken = make_unit(source_path="dsa/02-b.md")

    assert "frontmatter says module" in messages(check([first_unit(), broken]))


def test_an_unknown_status_is_an_error() -> None:
    assert "status must be one of" in messages(check([first_unit(), make_unit(status="done")]))


def test_a_concept_id_the_platform_does_not_know_is_an_error() -> None:
    issues = check([first_unit(), make_unit()], known_concepts={"prog.a"})

    assert "prog.b is not in core.concepts" in messages(issues)


def test_prerequisites_that_differ_from_the_database_are_an_error() -> None:
    issues = check(
        [first_unit(), make_unit()],
        known_concepts={"prog.a", "prog.b"},
        known_edges={"prog.b": {"prog.old"}},
    )
    text = messages(issues)

    assert "differ from core.concept_prerequisites" in text
    assert "prog.a" in text and "prog.old" in text


def test_matching_prerequisites_pass_the_database_check() -> None:
    issues = check(
        [first_unit(), make_unit()],
        known_concepts={"prog.a", "prog.b"},
        known_edges={"prog.b": {"prog.a"}},
    )

    assert issues == []


def test_a_seeded_concept_with_no_file_is_only_a_warning() -> None:
    issues = check([first_unit()], known_concepts={"prog.a", "prog.missing"})

    assert [i.severity for i in issues] == ["warning"]
    assert "prog.missing" in messages(issues)


def test_a_module_with_no_content_raises_no_warnings() -> None:
    # dsa concepts are seeded but dsa has no files yet; that is expected, not a problem.
    issues = check([first_unit()], known_concepts={"prog.a", "dsa.big_o"})

    assert issues == []


# ------------------------------------------------------------------ the question bank
def with_sections(**changes: str):
    return make_unit(sections=make_sections(**changes))


def test_a_multiple_choice_question_that_will_not_split_is_an_error() -> None:
    broken = with_sections(
        exercise="## Practice Questions\n\n### Level 1: Recall (MCQ)\n\n**Q1.** No options here\n",
        solution="## Solutions\n\n**Q1.** B.\n",
        rubric="## Marking Rubrics\n\n**Q7 (Explain)**\n- a.\n",
    )

    assert "no `A. ...  B. ...` options line" in messages(check([first_unit(), broken]))


def test_a_level_2_question_with_no_output_block_is_only_a_warning() -> None:
    reason = with_sections(
        exercise=(
            "## Practice Questions\n\n### Level 2: Trace and Predict\n\n"
            "**Q5.** What prints, and why?\n"
        ),
        solution="## Solutions\n\n**Q5.** It prints `7` because of x.\n",
        rubric="## Marking Rubrics\n",
    )
    issues = check([first_unit(), reason])

    assert [i.severity for i in issues if "no ```output block" in i.message] == ["warning"]
    assert not [i for i in issues if i.severity == "error"]


def test_a_well_formed_mcq_and_predict_question_raise_nothing() -> None:
    fine = with_sections(
        exercise=(
            "## Practice Questions\n\n### Level 1: Recall (MCQ)\n\n"
            "**Q1.** How many?\nA. 3  B. 4  C. 5  D. 8\n\n"
            "### Level 2: Trace and Predict\n\n**Q5.** What prints?\n"
        ),
        solution="## Solutions\n\n**Q1.** B. four\n\n**Q5.**\n\n```output\n81\n```\n",
        rubric="## Marking Rubrics\n",
    )

    assert check([first_unit(), fine]) == []
