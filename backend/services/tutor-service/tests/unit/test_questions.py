"""The question bank: authored text turned into structured questions and answer keys."""

from __future__ import annotations

import random
from collections import Counter
from pathlib import Path

import pytest

from app.content.chunker import chunk_unit
from app.content.loader import load_content
from app.domain.questions import (
    KIND_CODE,
    KIND_EXPLAIN,
    KIND_MCQ,
    KIND_PREDICT,
    AnswerKey,
    Question,
    QuestionError,
    build_entry,
    build_question_bank,
    question_errors,
    question_warnings,
    refers_to_option_letters,
    shuffled,
)
from tests.unit.support import make_chunk


def exercise(text: str, level: int, number: int = 1):
    return make_chunk(
        f"prog.demo#exercise-q{number:02d}",
        text,
        section_type="exercise",
        question_nos=(number,),
        level=level,
        concept_id="prog.demo",
    )


def solution(text: str, number: int = 1):
    return make_chunk(
        f"prog.demo#solution-q{number:02d}",
        text,
        section_type="solution",
        question_nos=(number,),
        concept_id="prog.demo",
    )


MCQ = "**Q1.** How many times does it run?\nA. 3  B. 4  C. 5  D. 8"


# ----------------------------------------------------------------- multiple choice
def test_an_mcq_is_split_into_stem_options_and_key() -> None:
    entry = build_entry(
        exercise(MCQ, 1), solution("**Q1.** B. `i` takes the values 2, 4, 6, 8."), None
    )

    assert entry.question.kind == KIND_MCQ
    assert entry.question.stem == "How many times does it run?"
    assert [(o.letter, o.text) for o in entry.question.options] == [
        ("A", "3"),
        ("B", "4"),
        ("C", "5"),
        ("D", "8"),
    ]
    assert entry.key.correct_option == "B"
    assert entry.key.explanation == "`i` takes the values 2, 4, 6, 8."


def test_the_student_facing_question_carries_no_answer() -> None:
    entry = build_entry(exercise(MCQ, 1), solution("**Q1.** B. because"), None)
    visible = repr(entry.question)

    assert "correct" not in visible and "because" not in visible
    assert not hasattr(entry.question, "key") and not hasattr(entry.question, "explanation")


def test_options_that_contain_code_and_spaces_survive() -> None:
    text = "**Q2.** Which is valid?\nA. `int x = 1;`  B. `x = int 1;`  C. `1 = x;`  D. `int = x;`"
    entry = build_entry(exercise(text, 1, 2), solution("**Q2.** A. valid", 2), None)

    assert entry.question.options[0].text == "`int x = 1;`"
    assert len(entry.question.options) == 4


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("**Q1.** No options here at all", "no `A. ...  B. ...` options line"),
        ("**Q1.** Two only\nA. yes  B. no", "expected options A to D"),
    ],
)
def test_an_mcq_that_cannot_be_split_is_an_error(text: str, message: str) -> None:
    with pytest.raises(QuestionError, match=message):
        build_entry(exercise(text, 1), solution("**Q1.** A. x"), None)


def test_an_answer_letter_outside_a_to_d_is_an_error() -> None:
    with pytest.raises(QuestionError, match="answer letter"):
        build_entry(exercise(MCQ, 1), solution("**Q1.** E. nope"), None)


def test_a_solution_that_does_not_start_with_a_letter_is_an_error() -> None:
    with pytest.raises(QuestionError, match="answer letter"):
        build_entry(exercise(MCQ, 1), solution("**Q1.** Because reasons."), None)


# --------------------------------------------------------------- predict the output
def test_a_predict_question_gets_its_expected_output_from_the_solution() -> None:
    sol = "**Q5.**\n\n```output\n81 4\n```\n\n`x` goes 1, 3, 9, 27, 81."
    entry = build_entry(
        exercise("**Q5.** What does this program print?\n\n```java\nint x;\n```", 2, 5),
        solution(sol, 5),
        None,
    )

    assert entry.question.kind == KIND_PREDICT
    assert entry.key.expected_output == "81 4"
    assert entry.key.explanation == "`x` goes 1, 3, 9, 27, 81."


def test_multi_line_expected_output_is_kept_whole() -> None:
    sol = "**Q5.**\n\n```output\n1 2 4 5\n4\n```\n\nbubble sort"
    entry = build_entry(exercise("**Q5.** What does it print?", 2, 5), solution(sol, 5), None)

    assert entry.key.expected_output == "1 2 4 5\n4"


def test_a_level_2_answer_that_is_a_reason_becomes_an_explain_question() -> None:
    entry = build_entry(
        exercise("**Q6.** What does it print, and why?", 2, 6),
        solution("**Q6.** It prints `[7][]` because of the leftover newline.", 6),
        None,
    )

    assert entry.question.kind == KIND_EXPLAIN
    assert entry.key.expected_output is None


# ------------------------------------------------------------- explain and code
def test_an_explain_question_carries_its_rubric() -> None:
    rubric = make_chunk(
        "prog.demo#rubric-q07",
        "**Q7 (Explain, 3 marks)**\n- 1 mark: names the bug.",
        section_type="rubric",
        question_nos=(7, 8),
    )
    entry = build_entry(
        exercise("**Q7.** Explain the bug.", 3, 7), solution("**Q7.** The off-by-one.", 7), rubric
    )

    assert entry.question.kind == KIND_EXPLAIN
    assert "names the bug" in entry.key.rubric


def test_a_code_question_keeps_its_reference_solution() -> None:
    sol = (
        "**Q9.**\n\n```java\npublic class Main {\n"
        "    public static void main(String[] a) {}\n}\n```"
    )
    entry = build_entry(exercise("**Q9. Even Sum.** Write it.", 4, 9), solution(sol, 9), None)

    assert entry.question.kind == KIND_CODE
    assert "public class Main" in entry.key.reference_solution
    assert entry.question.stem == "Write it."


def test_a_question_with_no_solution_is_an_error() -> None:
    with pytest.raises(QuestionError, match="no solution"):
        build_entry(exercise("**Q1.** x", 3), None, None)


# --------------------------------------------------------------- authoring checks
def test_authoring_errors_and_warnings_are_separate() -> None:
    reason = exercise("**Q6.** What does it print, and why?", 2, 6)
    reason_solution = solution("**Q6.** It prints `[7][]`.", 6)

    assert question_errors(reason, reason_solution, None) == []
    assert "no ```output block" in question_warnings(reason, reason_solution, None)[0]

    broken = exercise("**Q1.** nothing", 1)
    assert question_errors(broken, solution("**Q1.** A. x"), None)
    assert question_warnings(broken, solution("**Q1.** A. x"), None) == []


# ---------------------------------------------------------------------- shuffling
def mcq_entry(text: str = MCQ, answer: str = "**Q1.** B. because four"):
    return build_entry(exercise(text, 1), solution(answer), None)


def correct_text(question: Question, key: AnswerKey) -> str:
    return next(o.text for o in question.options if o.letter == key.correct_option)


def test_shuffling_keeps_the_key_pointing_at_the_same_option() -> None:
    entry = mcq_entry()
    for seed in range(50):
        q, k = shuffled(entry.question, entry.key, random.Random(seed))

        assert correct_text(q, k) == "4"
        assert [o.letter for o in q.options] == ["A", "B", "C", "D"]
        assert sorted(o.text for o in q.options) == ["3", "4", "5", "8"]


def test_shuffling_actually_moves_things() -> None:
    entry = mcq_entry()
    orders = {
        tuple(o.text for o in shuffled(entry.question, entry.key, random.Random(s))[0].options)
        for s in range(30)
    }

    assert len(orders) > 5


def test_group_options_stay_last() -> None:
    text = (
        "**Q1.** Which loop runs at least once?\n"
        "A. `for`  B. `while`  C. `do-while`  D. All of them"
    )
    entry = mcq_entry(text, "**Q1.** D. every loop can")
    for seed in range(30):
        q, k = shuffled(entry.question, entry.key, random.Random(seed))

        assert q.options[-1].text == "All of them"
        assert k.correct_option == "D"


def test_a_question_whose_text_names_a_letter_is_left_in_authored_order() -> None:
    entry = mcq_entry(answer="**Q1.** B. A is too small, C is too big, so B.")
    q, k = shuffled(entry.question, entry.key, random.Random(1))

    assert q == entry.question and k == entry.key


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("B is a keyword and D contains a space", True),
        ("the answer A would not compile", True),
        ("A while loop checks first", False),
        ("`B` inside code does not count", False),
        ("option C is wrong", True),
        ("Both loops end", False),
    ],
)
def test_letter_references_are_detected_without_tripping_on_the_article(text, expected) -> None:
    assert refers_to_option_letters(text) is expected


def test_only_multiple_choice_is_ever_shuffled() -> None:
    entry = build_entry(
        exercise("**Q5.** What does it print?", 2, 5),
        solution("**Q5.**\n\n```output\n1\n```", 5),
        None,
    )

    assert shuffled(entry.question, entry.key, random.Random(1)) == (entry.question, entry.key)


# -------------------------------------------------------------------- real content
@pytest.fixture(scope="module")
def bank():
    root = Path(__file__).resolve().parents[2] / "content"
    chunks = [c for u in load_content(root, "prog") for c in chunk_unit(u)]
    return build_question_bank(chunks)


def test_every_authored_question_becomes_a_bank_entry(bank) -> None:
    assert len(bank) == 143
    assert Counter(e.question.kind for e in bank.values()) == {
        KIND_MCQ: 52,
        KIND_PREDICT: 25,
        KIND_EXPLAIN: 27,
        KIND_CODE: 39,
    }


def test_every_mcq_has_four_options_and_a_key_among_them(bank) -> None:
    mcqs = [e for e in bank.values() if e.question.kind == KIND_MCQ]

    assert all(len(e.question.options) == 4 for e in mcqs)
    assert all(e.key.correct_option in {o.letter for o in e.question.options} for e in mcqs)


def test_every_predict_question_has_an_expected_output(bank) -> None:
    predict = [e for e in bank.values() if e.question.kind == KIND_PREDICT]

    assert all(e.key.expected_output and e.key.expected_output.strip() for e in predict)


def test_every_free_form_question_has_what_a_grader_needs(bank) -> None:
    explain = [e for e in bank.values() if e.question.kind == KIND_EXPLAIN]
    code = [e for e in bank.values() if e.question.kind == KIND_CODE]

    assert sum(bool(e.key.rubric) for e in explain) == 26  # the 27th is java_intro Q6
    assert all(e.key.reference_solution for e in code)


def test_the_authored_answer_letters_are_as_unbalanced_as_reported(bank) -> None:
    """Documents why shuffling exists: B and C are the answer in over 90% of MCQs."""
    letters = Counter(e.key.correct_option for e in bank.values() if e.question.kind == KIND_MCQ)

    assert (letters["B"] + letters["C"]) / sum(letters.values()) > 0.9


def test_shuffling_balances_the_letters_and_never_breaks_a_key(bank) -> None:
    rng = random.Random(7)
    mcqs = [e for e in bank.values() if e.question.kind == KIND_MCQ]
    letters: Counter[str] = Counter()

    for _ in range(100):
        for e in mcqs:
            q, k = shuffled(e.question, e.key, rng)
            assert correct_text(q, k) == correct_text(e.question, e.key)
            letters[k.correct_option] += 1

    total = sum(letters.values())
    assert all(0.15 < letters[x] / total < 0.35 for x in "ABCD"), dict(letters)
