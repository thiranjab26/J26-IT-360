"""Asking a model for a practical, and turning its reply into something that can be checked.

The model is asked for a task description, one sample INPUT, a reference solution and the skills
the task needs. It is never asked for the sample OUTPUT: that is made by running the reference
solution, so a wrong number written by the model cannot reach a student. The statement is then
assembled in the same shape as the authored practicals, so students cannot tell them apart and
the existing test builder reads it.

No FastAPI imports and no database. The provider, runner and checks are passed in.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.practicals.runner import CodeRunner
from app.sessions.catalog import Course

PROMPT_VERSION = "practical-v1"
MATERIAL_SECTIONS = ("theory", "example", "facts")
MAX_MATERIAL_CHARS = 7_000

SYSTEM = (
    "You write programming practicals for a first university Java course. "
    "Reply with ONE JSON object and nothing else."
)

LEVEL_MEANING = {
    4: "apply one or two of the taught ideas in a short program, with a clear input and output",
    5: "harder: combine several taught ideas, or handle tricky cases such as empty, equal or "
    "extreme values, in one program",
}


class ProposalError(ValueError):
    """The model's reply could not be used."""


@dataclass(frozen=True)
class Proposal:
    title: str
    description: str
    sample_input: str
    reference_solution: str
    skills: tuple[str, ...]


def material_for(course: Course, concept_id: str, sections: tuple[str, ...] = MATERIAL_SECTIONS):
    """The course text of one concept, in reading order, for the sections named."""
    out = []
    for chunk_id, text in course.chunk_text.items():
        concept, _, rest = chunk_id.partition("#")
        if concept == concept_id and rest.split("-")[0] in sections:
            out.append(text)
    return out


def prerequisite_closure(course: Course, concept_id: str) -> list[str]:
    """Every concept this one builds on, directly or not, in teaching order."""
    seen: set[str] = set()
    stack = list(course.prerequisites.get(concept_id, ()))
    while stack:
        current = stack.pop()
        if current not in seen:
            seen.add(current)
            stack.extend(course.prerequisites.get(current, ()))
    return [c for c in course.order if c in seen]


def build_prompt(
    course: Course,
    concept_id: str,
    level: int,
    existing: list[str],
    hint: str | None,
    avoid: list[str],
) -> str:
    material = "\n\n".join(material_for(course, concept_id))[:MAX_MATERIAL_CHARS]
    earlier = [
        text
        for c in prerequisite_closure(course, concept_id)
        for text in material_for(course, c, ("theory", "facts"))
    ]
    background = "\n\n".join(earlier)[:2_500]
    taken = "\n".join(f"- {text[:240]}" for text in [*existing, *avoid]) or "(none)"
    return (
        f"Concept: {course.titles[concept_id]}\n"
        f"Level {level}: {LEVEL_MEANING.get(level, LEVEL_MEANING[4])}.\n\n"
        f"What the students have been taught about this concept:\n<<<\n{material}\n>>>\n\n"
        f"Earlier concepts they also know (brief):\n<<<\n{background or '(none)'}\n>>>\n\n"
        f"Practicals that already exist for this concept. Write something DIFFERENT:\n{taken}\n\n"
        + (f"The lecturer asks for: {hint.strip()}\n\n" if hint and hint.strip() else "")
        + "Rules:\n"
        "- The program reads from standard input with Scanner and prints to standard output.\n"
        "- Use only Java that the material above teaches. No libraries, collections or syntax "
        "it does not mention.\n"
        "- One class named Main in the default package. The output must be exactly the same on "
        "every run.\n"
        "- The description must say exactly what is read and what is printed, including the "
        "format. Keep inputs small.\n"
        "- Do NOT put a sample input or sample output in the description.\n\n"
        "Reply with this JSON object:\n"
        '{"title": "3 to 6 words", "description": "the task in Markdown", '
        '"sample_input": "one example input with line breaks written as \\n", '
        '"reference_solution": "the complete Java program", '
        '"skills": ["3 to 6 short, complete, TRUE sentences about Java, each one a thing the '
        'student must know to solve this, worded as a course would teach it"]}'
    )


def parse_proposal(reply: str) -> Proposal:
    body = re.sub(r"^```(?:json)?\s*|\s*```$", "", reply.strip())
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        # Models sometimes wrap the object in prose: take the outermost braces.
        start, end = body.find("{"), body.rfind("}")
        if start < 0 or end <= start:
            raise ProposalError("the reply was not JSON") from exc
        try:
            data = json.loads(body[start : end + 1])
        except json.JSONDecodeError as inner:
            raise ProposalError("the reply was not valid JSON") from inner
    if not isinstance(data, dict):
        raise ProposalError("the reply was not a JSON object")

    def text(key: str) -> str:
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ProposalError(f"the reply has no {key}")
        return value.strip()

    description = text("description")
    cut = re.search(r"sample\s+(input|output)", description, re.I)
    if cut:  # a sample in the description would be a second, unchecked one
        description = description[: cut.start()].rstrip(" \n:*-#")
    sample = text("sample_input").replace("\r\n", "\n")
    skills = data.get("skills")
    if not isinstance(skills, list):
        raise ProposalError("the reply has no skills list")
    cleaned = tuple(s.strip() for s in skills if isinstance(s, str) and len(s.strip()) > 8)[:6]
    return Proposal(
        title=text("title")[:80],
        description=description,
        sample_input=sample if sample.endswith("\n") else sample + "\n",
        reference_solution=text("reference_solution"),
        skills=cleaned,
    )


def assemble_statement(description: str, sample: tuple[str, str] | None) -> str:
    """The statement in the authored shape: the task, then one sample input and its output."""
    if sample is None:
        return description.strip()
    stdin, stdout = sample
    return (
        f"{description.strip()}\n\n"
        f"Sample input:\n\n```text\n{stdin.rstrip(chr(10))}\n```\n\n"
        f"Sample output:\n\n```text\n{stdout.rstrip()}\n```"
    )


def sample_output(runner: CodeRunner, reference: str, stdin: str) -> str | None:
    """What the reference solution prints for the sample input, or None if it cannot say."""
    batch = runner.run_batch(reference, [stdin])
    if not batch.compiled or not batch.runs:
        return None
    run = batch.runs[0]
    if run.status != "ok" or not run.stdout.strip():
        return None
    return run.stdout
