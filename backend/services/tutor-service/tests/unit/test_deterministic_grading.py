"""Marking multiple choice and predicted output without a model."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.content.chunker import chunk_unit
from app.content.loader import load_content
from app.domain.questions import (
    KIND_MCQ,
    KIND_PREDICT,
    AnswerKey,
    Option,
    Question,
    build_question_bank,
)
from app.grading.deterministic import (
    CORRECT,
    UNREADABLE,
    WRONG,
    grade,
    grade_mcq,
    grade_output,
    normalise_output,
    read_option,
)

QUESTION = Question(
    question_id="prog.demo#exercise-q01",
    unit_id="prog.demo",
    concept_id="prog.demo",
    number=1,
    level=1,
    kind=KIND_MCQ,
    stem="How many?",
    options=(Option("A", "3"), Option("B", "4"), Option("C", "`while`"), Option("D", "8")),
)
MCQ_KEY = AnswerKey(question_id=QUESTION.question_id, kind=KIND_MCQ, correct_option="B")
PREDICT_KEY = AnswerKey(
    question_id="prog.demo#exercise-q05", kind=KIND_PREDICT, expected_output="1 2 4 5\n4"
)


# ------------------------------------------------------------------------- MCQ
@pytest.mark.parametrize("answer", ["B", "b", " B ", "B.", "(B)", "B)", "b:"])
def test_a_letter_is_accepted_however_it_is_written(answer: str) -> None:
    assert grade_mcq(QUESTION, MCQ_KEY, answer).outcome == CORRECT


def test_the_text_of_an_option_is_accepted_too() -> None:
    assert grade_mcq(QUESTION, MCQ_KEY, "4").outcome == CORRECT
    assert grade_mcq(QUESTION, MCQ_KEY, "`while`").outcome == WRONG
    assert read_option(QUESTION, "while") == "C"


@pytest.mark.parametrize("answer", ["A", "C", "d", "3"])
def test_a_wrong_option_is_wrong(answer: str) -> None:
    verdict = grade_mcq(QUESTION, MCQ_KEY, answer)

    assert verdict.outcome == WRONG and not verdict.correct
    assert verdict.counts_as_attempt


@pytest.mark.parametrize("answer", ["", "   ", "E", "I think it is four", "AB", "none"])
def test_an_unreadable_answer_is_not_a_wrong_answer(answer: str) -> None:
    verdict = grade_mcq(QUESTION, MCQ_KEY, answer)

    assert verdict.outcome == UNREADABLE
    assert not verdict.counts_as_attempt


# ------------------------------------------------------------------ predicted output
def test_the_exact_output_is_correct() -> None:
    assert grade_output(PREDICT_KEY, "1 2 4 5\n4").correct


@pytest.mark.parametrize(
    "answer",
    [
        "1 2 4 5\r\n4",  # Windows line endings
        "1 2 4 5   \n4  ",  # trailing spaces
        "\n\n1 2 4 5\n4\n\n",  # blank lines at either end
        "```\n1 2 4 5\n4\n```",  # pasted inside a code fence
        "```text\n1 2 4 5\n4\n```",
    ],
)
def test_formatting_that_is_not_a_mistake_is_forgiven(answer: str) -> None:
    assert grade_output(PREDICT_KEY, answer).correct


@pytest.mark.parametrize(
    "answer",
    [
        "1 2 4 5",  # a line missing
        "1 2 4 5\n4\n4",  # a line extra
        "1  2 4 5\n4",  # a different number of spaces is different output
        "1 2 5 4\n4",
        "1 2 4 5\n5",
    ],
)
def test_output_that_differs_is_wrong(answer: str) -> None:
    verdict = grade_output(PREDICT_KEY, answer)

    assert verdict.outcome == WRONG


def test_the_reason_says_where_it_went_wrong() -> None:
    assert grade_output(PREDICT_KEY, "1 2 4 5\n5").reason == "line 2 differs"
    assert grade_output(PREDICT_KEY, "1 2 4 5").reason == "expected 2 line(s), got 1"


def test_an_empty_answer_is_unreadable_and_free() -> None:
    verdict = grade_output(PREDICT_KEY, "  \n ")

    assert verdict.outcome == UNREADABLE and not verdict.counts_as_attempt


def test_output_is_compared_case_sensitively() -> None:
    key = AnswerKey(question_id="q", kind=KIND_PREDICT, expected_output="Sum = 10")

    assert not grade_output(key, "sum = 10").correct


def test_a_key_with_no_expected_output_cannot_be_marked_this_way() -> None:
    with pytest.raises(ValueError, match="no authored output"):
        grade_output(AnswerKey(question_id="q", kind=KIND_PREDICT), "anything")


def test_normalising_output_is_idempotent() -> None:
    once = normalise_output("\n a  \r\nb \n\n")

    assert normalise_output("\n".join(once)) == once == [" a", "b"]


# ------------------------------------------------------------------- dispatching
def test_grade_routes_by_kind_and_refuses_the_rest() -> None:
    assert grade(QUESTION, MCQ_KEY, "B").correct
    assert grade(QUESTION, PREDICT_KEY, "1 2 4 5\n4").correct

    explain = AnswerKey(question_id="q", kind="explain")
    with pytest.raises(ValueError, match="not marked deterministically"):
        grade(QUESTION, explain, "because")


# -------------------------------------------------------------------- real content
@pytest.fixture(scope="module")
def bank():
    root = Path(__file__).resolve().parents[2] / "content"
    chunks = [c for u in load_content(root, "prog") for c in chunk_unit(u)]
    return build_question_bank(chunks)


def test_every_authored_answer_marks_itself_correct(bank) -> None:
    checked = 0
    for entry in bank.values():
        if entry.question.kind == KIND_MCQ:
            assert grade(entry.question, entry.key, entry.key.correct_option).correct
        elif entry.question.kind == KIND_PREDICT:
            assert grade(entry.question, entry.key, entry.key.expected_output).correct
        else:
            continue
        checked += 1

    assert checked == 77


def test_every_wrong_letter_marks_wrong_on_the_real_questions(bank) -> None:
    for entry in bank.values():
        if entry.question.kind != KIND_MCQ:
            continue
        for option in entry.question.options:
            verdict = grade(entry.question, entry.key, option.letter)
            assert verdict.correct == (option.letter == entry.key.correct_option), entry.question


def test_a_changed_program_output_is_caught_on_the_real_questions(bank) -> None:
    for entry in bank.values():
        if entry.question.kind == KIND_PREDICT:
            tampered = entry.key.expected_output + "\nextra"
            assert not grade(entry.question, entry.key, tampered).correct
