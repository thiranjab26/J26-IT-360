"""Split a Unit into retrievable Chunks. No database, no FastAPI.

The rule of thumb is that a chunk should be the smallest piece that still makes
sense alone, because that is what a retriever returns and what the faithfulness
gate later checks claims against.

    theory         small adjacent blocks are merged up to THEORY_MAX_WORDS, so a
                   one-paragraph subsection is not retrieved without its context
    example        one chunk per worked example; a program and its trace belong together
    misconception  one chunk per misconception, so a hint can quote exactly one
    facts          one chunk per block (the short list of statements)
    exercise       one chunk per question
    solution       one chunk per question, so the grader gets exactly one answer
    rubric         one chunk per rubric entry, which may cover several questions
    others         one chunk per block (objectives, prerequisites, overview)

`further_practice` is authored for students and is not indexed.

Chunk IDs are stable for unchanged content: `prog.loops#theory-02`,
`prog.loops#solution-q07`. A re-index can therefore tell what actually changed.
"""

from __future__ import annotations

import hashlib
import re
from collections import Counter

from app.content.markdown import scan_lines
from app.content.models import (
    INDEXED_SECTION_TYPES,
    Chunk,
    Section,
    Unit,
)

# Merge adjacent theory blocks while the result stays at or under this many words.
# About one screen of reading; small enough that an embedding stays about one idea.
THEORY_MAX_WORDS = 200

LEVEL_HEADING_RE = re.compile(r"^###\s+Level\s+(\d+)\b")
QUESTION_START_RE = re.compile(r"^\*\*Q(\d+)\b")
MISCONCEPTION_START_RE = re.compile(r'^\*\*["“]')


def _default_headings(section: Section) -> tuple[str, ...]:
    """The sub-headings a chunk covers when it is cut from this block unchanged.

    Only an example or an overview block is a single topic named by its own heading.
    A block that is split into many chunks (every question, every misconception)
    holds headings that belong to the block, not to any one piece of it, so its
    pieces claim none. A question's level is carried in `level` instead.
    """
    return section.headings if section.section_type in ("example", "overview") else ()


def chunk_unit(unit: Unit) -> list[Chunk]:
    chunks: list[Chunk] = []
    counters: Counter[str] = Counter()

    def add(
        section: Section,
        text: str,
        *,
        heading_path: str | None = None,
        headings: tuple[str, ...] | None = None,
        question_nos: tuple[int, ...] | None = None,
        level: int | None = None,
    ) -> None:
        text = text.strip()
        if not text:
            return
        kind = section.section_type
        if question_nos:
            chunk_id = f"{unit.unit_id}#{kind}-q{question_nos[0]:02d}"
        else:
            counters[kind] += 1
            chunk_id = f"{unit.unit_id}#{kind}-{counters[kind]:02d}"
        chunks.append(
            Chunk(
                chunk_id=chunk_id,
                unit_id=unit.unit_id,
                module_id=unit.module_id,
                concept_id=unit.concept_id,
                section_type=kind,
                ordinal=len(chunks),
                heading_path=heading_path or section.heading_path,
                headings=_default_headings(section) if headings is None else headings,
                question_nos=question_nos,
                level=level,
                text=text,
                word_count=len(text.split()),
                text_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
            )
        )

    theory_run: list[Section] = []

    def flush_theory() -> None:
        for group in _merge_theory(theory_run):
            first = group[0]
            add(
                first,
                "\n\n".join(section.text for section in group),
                headings=tuple(h for section in group for h in section.headings),
            )
        theory_run.clear()

    for section in unit.sections:
        kind = section.section_type

        if kind == "theory":
            theory_run.append(section)
            continue
        flush_theory()

        if kind not in INDEXED_SECTION_TYPES:
            continue

        if kind == "misconception":
            for item in _split_misconceptions(section.text):
                add(section, item)
        elif kind == "exercise":
            for level, number, text in _split_questions(section.text, track_levels=True):
                add(section, text, question_nos=(number,), level=level)
        elif kind == "solution":
            for _, number, text in _split_questions(section.text, track_levels=False):
                add(section, text, question_nos=(number,))
        elif kind == "rubric":
            for _, _first, text in _split_questions(section.text, track_levels=False):
                add(section, text, question_nos=_rubric_question_numbers(text.split("\n")[0]))
        else:
            # overview, objectives, prerequisites, example, facts
            add(section, section.text)

    flush_theory()
    return chunks


# ---------------------------------------------------------------------------
# Theory
# ---------------------------------------------------------------------------
def _merge_theory(run: list[Section]) -> list[list[Section]]:
    """Greedily group consecutive theory blocks without exceeding THEORY_MAX_WORDS.

    A single block that is already over the limit stays alone rather than being cut:
    splitting mid-explanation or mid-code would be worse than one long chunk.
    """
    groups: list[list[Section]] = []
    words = 0
    for section in run:
        size = len(section.text.split())
        if groups and words + size <= THEORY_MAX_WORDS:
            groups[-1].append(section)
            words += size
        else:
            groups.append([section])
            words = size
    return groups


# ---------------------------------------------------------------------------
# Misconceptions, questions, solutions, rubrics
# ---------------------------------------------------------------------------
def _split_misconceptions(text: str) -> list[str]:
    """Each misconception starts with a bold quoted statement, e.g. **"A while ..."**."""
    items: list[list[str]] = []
    for line, in_code in scan_lines(text)[0]:
        if not in_code and MISCONCEPTION_START_RE.match(line):
            items.append([line])
        elif items:
            items[-1].append(line)
    return ["\n".join(item).strip() for item in items]


def _split_questions(text: str, *, track_levels: bool) -> list[tuple[int | None, int, str]]:
    """Split on `**Q<n>` lines into (level, question number, text).

    With track_levels, `### Level N` headings set the level of the questions that
    follow and end the question before them, so a heading never leaks into the
    previous question's text. Text before the first question (the section heading)
    is dropped; it is already in the chunk's heading path.
    """
    groups: list[tuple[int | None, int, list[str]]] = []
    level: int | None = None
    open_group = False

    for line, in_code in scan_lines(text)[0]:
        if not in_code:
            if track_levels:
                heading = LEVEL_HEADING_RE.match(line)
                if heading:
                    level = int(heading.group(1))
                    open_group = False
                    continue
            question = QUESTION_START_RE.match(line)
            if question:
                groups.append((level, int(question.group(1)), [line]))
                open_group = True
                continue
        if open_group:
            groups[-1][2].append(line)

    return [(lvl, number, "\n".join(lines).strip()) for lvl, number, lines in groups]


def _rubric_question_numbers(header: str) -> tuple[int, ...]:
    """Question numbers a rubric entry covers, from its bold header line.

    Handles every shape the content uses:
        **Q7 (Explain, 3 marks)**          -> (7,)
        **Q9 to Q11 (Implement ...)**      -> (9, 10, 11)
        **Q9, Q10 (Implement)**            -> (9, 10)
        **Q9 and Q10 (Implement)**         -> (9, 10)
    """
    head = header.split("(")[0]
    numbers = [int(n) for n in re.findall(r"Q(\d+)", head)]
    if len(numbers) == 2 and re.search(r"\bto\b", head):
        return tuple(range(numbers[0], numbers[1] + 1))
    return tuple(numbers)
