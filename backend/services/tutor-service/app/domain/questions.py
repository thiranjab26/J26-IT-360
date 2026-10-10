"""The authored practice questions as structured data. No database, no FastAPI.

The course files hold each question as text: the question in one section, its answer
in another, a rubric in a third. Sessions need them as objects, and need two things
kept strictly apart:

    Question   everything a student may see before answering
    AnswerKey  the answer, the authored explanation, the rubric. Server side only.

A route that returns a Question to the browser is safe; one that returns a BankEntry
or an AnswerKey is not. They are separate types so that mistake is hard to make by
accident. The explanation in the key is shown only after the student has answered.

Kinds, by the level the author gave the question:

    mcq             level 1. One correct option. A recall check: it never gates anything.
    predict_output  level 2. "What does this program print?" with the expected output
                    authored in the solution, so the answer is checked exactly.
    explain         level 3, and any level-2 question whose answer is a reason rather
                    than an output. Graded against a rubric by a model, then verified.
    code            levels 4 and 5. Needs a code runner and hidden tests (phase P4).
"""

from __future__ import annotations

import random
import re
from collections.abc import Iterable
from dataclasses import dataclass, replace

from app.content.models import LEVEL_QUESTION_TYPES, Chunk

KIND_MCQ = "mcq"
KIND_PREDICT = "predict_output"
KIND_EXPLAIN = "explain"
KIND_CODE = "code"

# Kinds the platform can mark without a model and without running student code.
DETERMINISTIC_KINDS = (KIND_MCQ, KIND_PREDICT)

HEADER_RE = re.compile(r"^\*\*Q\d+\.[^*]*\*\*\s*")
SOLUTION_LETTER_RE = re.compile(r"^\*\*Q\d+\.\*\*\s*([A-D])\b\.?\s*(.*)$", re.S)
OPTIONS_START_RE = re.compile(r"^A\.\s")
OPTION_SPLIT_RE = re.compile(r"\s{2,}(?=[B-D]\.\s)")
OUTPUT_BLOCK_RE = re.compile(r"```output\n(.*?)\n?```", re.S)
JAVA_BLOCK_RE = re.compile(r"```java\n(.*?)```", re.S)


class QuestionError(ValueError):
    """A question that cannot be turned into structured data."""


@dataclass(frozen=True)
class Option:
    letter: str
    text: str


@dataclass(frozen=True)
class Question:
    """What a student may see before answering."""

    question_id: str
    unit_id: str
    concept_id: str
    number: int
    level: int
    kind: str
    stem: str
    options: tuple[Option, ...] = ()


@dataclass(frozen=True)
class AnswerKey:
    """The answer and everything that explains it. Never sent before the student answers."""

    question_id: str
    kind: str
    correct_option: str | None = None
    expected_output: str | None = None
    reference_solution: str | None = None
    explanation: str = ""
    rubric: str | None = None


@dataclass(frozen=True)
class BankEntry:
    question: Question
    key: AnswerKey


# ------------------------------------------------------------------------ parsing
def build_question_bank(chunks: Iterable[Chunk]) -> dict[str, BankEntry]:
    """Every exercise in the chunks as a BankEntry, keyed by question_id.

    Raises QuestionError naming the first question that cannot be understood.
    """
    exercises: dict[tuple[str, int], Chunk] = {}
    solutions: dict[tuple[str, int], Chunk] = {}
    rubrics: dict[tuple[str, int], Chunk] = {}

    for chunk in chunks:
        if chunk.section_type not in ("exercise", "solution", "rubric") or not chunk.question_nos:
            continue
        target = {"exercise": exercises, "solution": solutions, "rubric": rubrics}[
            chunk.section_type
        ]
        for number in chunk.question_nos:
            target[(chunk.unit_id, number)] = chunk

    bank: dict[str, BankEntry] = {}
    for (unit_id, number), exercise in sorted(exercises.items()):
        entry = build_entry(
            exercise, solutions.get((unit_id, number)), rubrics.get((unit_id, number))
        )
        bank[entry.question.question_id] = entry
    return bank


def build_entry(exercise: Chunk, solution: Chunk | None, rubric: Chunk | None) -> BankEntry:
    if exercise.level is None or not exercise.question_nos:
        raise QuestionError(f"{exercise.chunk_id}: not under a `### Level N` heading")
    if solution is None:
        raise QuestionError(f"{exercise.chunk_id}: no solution")

    level = exercise.level
    number = exercise.question_nos[0]
    stem = HEADER_RE.sub("", exercise.text).strip()
    solution_text = solution.text

    question_kwargs = {
        "question_id": exercise.chunk_id,
        "unit_id": exercise.unit_id,
        "concept_id": exercise.concept_id or "",
        "number": number,
        "level": level,
    }
    key_kwargs = {
        "question_id": exercise.chunk_id,
        "rubric": rubric.text if rubric else None,
    }

    if level == 1:
        stem, options = _split_options(exercise.chunk_id, stem)
        # The options are always exactly A to D and the answer letter is read from A to D,
        # so the letter is necessarily one of the options.
        letter, explanation = _solution_letter(exercise.chunk_id, solution_text)
        return BankEntry(
            Question(**question_kwargs, kind=KIND_MCQ, stem=stem, options=options),
            AnswerKey(**key_kwargs, kind=KIND_MCQ, correct_option=letter, explanation=explanation),
        )

    if level == 2:
        match = OUTPUT_BLOCK_RE.search(solution_text)
        if match:
            explanation = (solution_text[: match.start()] + solution_text[match.end() :]).strip()
            explanation = HEADER_RE.sub("", explanation).strip()
            return BankEntry(
                Question(**question_kwargs, kind=KIND_PREDICT, stem=stem),
                AnswerKey(
                    **key_kwargs,
                    kind=KIND_PREDICT,
                    expected_output=match.group(1),
                    explanation=explanation,
                ),
            )
        # The answer is a reason, not an output (for example "what does it print, and why").
        return BankEntry(
            Question(**question_kwargs, kind=KIND_EXPLAIN, stem=stem),
            AnswerKey(
                **key_kwargs,
                kind=KIND_EXPLAIN,
                explanation=HEADER_RE.sub("", solution_text).strip(),
            ),
        )

    if level == 3:
        return BankEntry(
            Question(**question_kwargs, kind=KIND_EXPLAIN, stem=stem),
            AnswerKey(
                **key_kwargs,
                kind=KIND_EXPLAIN,
                explanation=HEADER_RE.sub("", solution_text).strip(),
            ),
        )

    if level in (4, 5):
        java = JAVA_BLOCK_RE.search(solution_text)
        return BankEntry(
            Question(**question_kwargs, kind=KIND_CODE, stem=stem),
            AnswerKey(
                **key_kwargs,
                kind=KIND_CODE,
                reference_solution=java.group(1).rstrip() if java else None,
                explanation=HEADER_RE.sub("", solution_text).strip(),
            ),
        )

    raise QuestionError(
        f"{exercise.chunk_id}: unknown level {level} "
        f"(expected one of {sorted(LEVEL_QUESTION_TYPES)})"
    )


def _split_options(question_id: str, stem: str) -> tuple[str, tuple[Option, ...]]:
    """Separate the question from its `A. x  B. y  C. z  D. w` line."""
    lines = stem.split("\n")
    for index, line in enumerate(lines):
        if OPTIONS_START_RE.match(line):
            parts = OPTION_SPLIT_RE.split(line.strip())
            options = tuple(
                Option(part[0], part[2:].strip()) for part in parts if re.match(r"^[A-D]\.\s", part)
            )
            letters = [o.letter for o in options]
            if letters != ["A", "B", "C", "D"] or any(not o.text for o in options):
                raise QuestionError(f"{question_id}: expected options A to D, got {letters}")
            return "\n".join(lines[:index]).strip(), options
    raise QuestionError(f"{question_id}: no `A. ...  B. ...` options line")


def _solution_letter(question_id: str, solution_text: str) -> tuple[str, str]:
    match = SOLUTION_LETTER_RE.match(solution_text.strip())
    if not match:
        raise QuestionError(f"{question_id}: solution does not start with the answer letter")
    return match.group(1), match.group(2).strip()


# ------------------------------------------------------------------------ shuffling
# Options that read as a group ("Both", "Neither", "All of them") stay last, by convention.
_PINNED_LAST_RE = re.compile(r"^(?:both|neither|all of|none of|all|none)\b", re.I)

# Text that points at a letter ("B is a keyword", "option C"). If the stem or the
# authored explanation does this, reordering the options would make it wrong, so such a
# question is shown in its authored order. Capital A is only matched where it plainly
# names an option, since it is also the English article.
_LETTER_REFERENCE_RE = re.compile(
    r"\b(?:option|answer|choice)\s+[A-D]\b"
    r"|(?<![\w`'\".-])[B-D](?![\w`'\".-])"
    r"|(?<![\w`'\".-])A\s+(?:is|are|does|do|would|has|starts|cannot|can)\b"
)


def refers_to_option_letters(text: str) -> bool:
    return bool(_LETTER_REFERENCE_RE.search(re.sub(r"`[^`]*`", " ", text)))


def shuffled(question: Question, key: AnswerKey, rng: random.Random) -> tuple[Question, AnswerKey]:
    """The question with its options in a random order and the key adjusted to match.

    The authored answers are far from balanced (in the Programming module the correct
    option is B or C in 92% of multiple-choice questions), which rewards guessing the
    same letter every time. Shuffling at presentation time fixes that without editing
    the course. Anything that is not multiple choice, or whose wording depends on the
    authored order, is returned unchanged.
    """
    if question.kind != KIND_MCQ or key.correct_option is None:
        return question, key
    if refers_to_option_letters(question.stem) or refers_to_option_letters(key.explanation):
        return question, key

    movable = [o for o in question.options if not _PINNED_LAST_RE.match(o.text)]
    pinned = [o for o in question.options if _PINNED_LAST_RE.match(o.text)]
    rng.shuffle(movable)

    correct_text = next(o.text for o in question.options if o.letter == key.correct_option)
    relettered = tuple(
        Option("ABCD"[index], option.text) for index, option in enumerate([*movable, *pinned])
    )
    new_correct = next(o.letter for o in relettered if o.text == correct_text)
    return replace(question, options=relettered), replace(key, correct_option=new_correct)


# ------------------------------------------------------------------ authoring checks
def question_errors(exercise: Chunk, solution: Chunk | None, rubric: Chunk | None) -> list[str]:
    """Why this question cannot be used at all. Empty means it parses."""
    try:
        build_entry(exercise, solution, rubric)
    except QuestionError as exc:
        return [str(exc)]
    return []


def question_warnings(exercise: Chunk, solution: Chunk | None, rubric: Chunk | None) -> list[str]:
    """Notes that block nothing but cost the platform an automatic check."""
    try:
        entry = build_entry(exercise, solution, rubric)
    except QuestionError:
        return []  # reported as an error instead

    if entry.key.kind == KIND_EXPLAIN and entry.question.level == 2:
        return [
            f"{entry.question.question_id}: level 2 but the solution has no ```output block, so "
            "it cannot be checked automatically; add the expected output, or make it level 3"
        ]
    return []
