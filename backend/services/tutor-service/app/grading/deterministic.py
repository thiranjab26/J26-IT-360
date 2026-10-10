"""Marking that needs no model and no code execution. No database, no FastAPI.

Only questions with an exactly checkable authored answer are marked here: multiple
choice, and "what does this program print" with the expected output written in the
solution. Because the verdict comes from the authored key and never from a model, it
cannot be a hallucination, and the faithfulness gate does not apply to it. It applies
to the *explanation* the tutor writes around the verdict.

A verdict carries a machine-readable reason, so the session can tell "your answer was
wrong" from "I could not read your answer". The second must never cost the student an
attempt.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.domain.questions import KIND_MCQ, KIND_PREDICT, AnswerKey, Question

CORRECT = "correct"
WRONG = "wrong"
UNREADABLE = "unreadable"  # not a wrong answer: the student's input was not an answer

_LETTER_RE = re.compile(r"^\(?([A-Da-d])\)?[.):]?$")
_FENCE_RE = re.compile(r"^```[A-Za-z]*\n(.*?)\n?```$", re.S)


@dataclass(frozen=True)
class Verdict:
    outcome: str
    reason: str

    @property
    def correct(self) -> bool:
        return self.outcome == CORRECT

    @property
    def counts_as_attempt(self) -> bool:
        """An unreadable answer is asked for again; it does not use up an attempt."""
        return self.outcome != UNREADABLE


def grade(question: Question, key: AnswerKey, answer: str) -> Verdict:
    """Mark an answer to a question that can be marked exactly."""
    if key.kind == KIND_MCQ:
        return grade_mcq(question, key, answer)
    if key.kind == KIND_PREDICT:
        return grade_output(key, answer)
    raise ValueError(f"{key.kind} questions are not marked deterministically")


def grade_mcq(question: Question, key: AnswerKey, answer: str) -> Verdict:
    letter = read_option(question, answer)
    if letter is None:
        return Verdict(UNREADABLE, "not one of the options")
    if letter == key.correct_option:
        return Verdict(CORRECT, "correct option")
    return Verdict(WRONG, f"chose {letter}")


def read_option(question: Question, answer: str) -> str | None:
    """The option letter a student meant, or None.

    Accepts a letter however it is dressed (B, b, B., (B), B) ) or the exact text of
    one option. Anything else is not guessed at.
    """
    text = answer.strip()
    match = _LETTER_RE.match(text)
    if match:
        return match.group(1).upper()
    wanted = _squash(text).strip("`").lower()
    for option in question.options:
        if wanted and wanted == _squash(option.text).strip("`").lower():
            return option.letter
    return None


def grade_output(key: AnswerKey, answer: str) -> Verdict:
    """Compare what the student says the program prints with the authored output.

    Line by line and exact within a line, because the output is literal: `81 4` and
    `81  4` are different programs' output. Forgiven: a surrounding code fence,
    Windows line endings, trailing spaces, and blank lines at either end.
    """
    if key.expected_output is None:
        raise ValueError("this question has no authored output to compare against")
    if not answer.strip():
        return Verdict(UNREADABLE, "empty answer")

    given = normalise_output(answer)
    expected = normalise_output(key.expected_output)
    if given == expected:
        return Verdict(CORRECT, "output matches")
    if len(given) != len(expected):
        return Verdict(WRONG, f"expected {len(expected)} line(s), got {len(given)}")
    first = next(i for i, (g, e) in enumerate(zip(given, expected, strict=True)) if g != e)
    return Verdict(WRONG, f"line {first + 1} differs")


def normalise_output(text: str) -> list[str]:
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    fenced = _FENCE_RE.match(text.strip())
    if fenced:
        text = fenced.group(1)
    lines = [line.rstrip() for line in text.split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()
