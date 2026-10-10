"""The tutor's own words: explanations, hints and re-teaches, written by a language model.

Every prompt gives the model ONE authored course passage and tells it to use nothing
else, and none of them ever contains an answer key. That is a request, not a guarantee:
a model can still add something that is not in the passage. Catching that is the job of
the faithfulness gate (phase P3), which will check these same texts. Until it exists the
interface labels generated text as such and offers the authored passage beside it.

If no model is configured, or a call fails, `write` returns None and the caller shows
the authored passage instead. A session never waits on, or breaks because of, a model.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from app.llm.providers import LLMError, LLMProvider

log = logging.getLogger("tutor.writer")

SYSTEM = (
    "You are VeriTutor, a patient Java tutor for first-year university students.\n"
    "Rules:\n"
    "- Use ONLY the course passage you are given. Do not add facts, rules or examples "
    "that are not in it.\n"
    "- Never state the answer to a practice question.\n"
    "- Plain, friendly language and short paragraphs. Keep any Java code exactly as it "
    "appears in the passage, inside ``` fences.\n"
    "- Do not use em dashes. Do not greet the student. Start with the explanation."
)

MAX_CHARS = 3000

EXPLAIN = "explain"
HINT = "hint"
RETEACH = "reteach"

_TASKS = {
    EXPLAIN: (
        "Explain this passage to the student in your own words, in 120 to 200 words. "
        "Keep the code examples that matter."
    ),
    HINT: (
        "The student is stuck on the question below. Write ONE short hint (at most 40 words) "
        "that points them to the idea in the passage they need. Do not give the answer, "
        "the program's output, or any final value."
    ),
    RETEACH: (
        "The student has missed the question below twice. Explain the passage again from a "
        "different angle, such as a step-by-step trace or a plain-language comparison that "
        "adds no new facts, in 100 to 160 words. Do not give the answer to the question."
    ),
}


@dataclass(frozen=True)
class Generated:
    text: str
    provider: str
    model: str


class TutorWriter:
    def __init__(self, provider: LLMProvider | None) -> None:
        self._provider = provider

    @property
    def enabled(self) -> bool:
        return self._provider is not None

    def write(
        self, kind: str, *, concept: str, passage: str, question: str | None = None
    ) -> Generated | None:
        """Text for one point of a session, or None if it should fall back to the course."""
        if self._provider is None:
            return None

        prompt = f"Concept: {concept}\n\nCourse passage:\n<<<\n{passage}\n>>>\n\n"
        if question is not None:
            prompt += f"Question:\n<<<\n{question}\n>>>\n\n"
        prompt += _TASKS[kind]

        try:
            result = self._provider.generate(
                system=SYSTEM,
                prompt=prompt,
                max_tokens=300 if kind == HINT else 700,
                temperature=0.3,
            )
        except LLMError as exc:
            log.warning("tutor text fell back to the course", extra={"kind": kind, "why": str(exc)})
            return None

        text = result.text.strip()
        if not text or len(text) > MAX_CHARS:
            return None
        return Generated(text, result.provider, result.model)


def gives_away(hint: str, expected_output: str | None) -> bool:
    """True if a hint states a line of the program's expected output.

    Whole-token matching, so the output "26" is found in "it prints 26" but not in "126".
    A hint that does this is thrown away for the generic one.
    """
    if not expected_output:
        return False
    for line in expected_output.splitlines():
        line = line.strip()
        if line and re.search(rf"(?<![\w.]){re.escape(line)}(?![\w.])", hint):
            return True
    return False
