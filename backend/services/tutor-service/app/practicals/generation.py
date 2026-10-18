"""Making one draft practical end to end: ask the model, run the solution, check everything.

    ask        the model proposes a task, a sample input, a solution and the skills it needs
    run        the solution is run on the sample input and its output becomes the sample output
    validate   the same checks a hand-written draft gets (compiles, safe, stable, tests)
    scope      the NLI check of the skills, the constructs check, the duplicate check

The result is a draft for a lecturer to review. Nothing here publishes anything.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from app.llm.providers import LLMError, LLMProvider
from app.practicals.authoring import DANGEROUS, validate
from app.practicals.generator import (
    PROMPT_VERSION,
    SYSTEM,
    Proposal,
    ProposalError,
    assemble_statement,
    build_prompt,
    parse_proposal,
    sample_output,
)
from app.practicals.runner import CodeRunner
from app.practicals.scope import (
    constructs_check,
    duplicate_check,
    taught_premises,
    taught_scope,
)
from app.practicals.tests_builder import TestCase
from app.sessions.catalog import Course
from app.verification.nli import NLIModel


@dataclass
class GeneratedDraft:
    concept_id: str
    level: int
    title: str
    statement: str
    reference_solution: str
    checks: list[dict[str, str]]
    tests: list[TestCase]
    generation: dict[str, Any] = field(default_factory=dict)


class DraftGenerator:
    def __init__(
        self,
        course: Course,
        runner: CodeRunner,
        provider: LLMProvider,
        nli: NLIModel | None,
        threshold: float,
    ) -> None:
        self.course = course
        self.runner = runner
        self.provider = provider
        self.nli = nli
        self.threshold = threshold

    def generate(
        self,
        concept_id: str,
        level: int,
        existing: Sequence[tuple[str, str]],
        hint: str | None = None,
        avoid: Sequence[str] = (),
    ) -> GeneratedDraft:
        """`existing` is (practical id, statement) of the concept's other practicals. Raises
        LLMError when the model cannot be reached, and ProposalError when it keeps replying
        with something unusable."""
        started = time.perf_counter()
        prompt = build_prompt(
            self.course,
            concept_id,
            level,
            [_task_text(statement) for _, statement in existing],
            hint,
            list(avoid),
        )
        proposal, model, calls = self._ask(prompt)

        statement = self._statement(proposal)
        result = validate(statement, proposal.reference_solution, self.runner, self.provider)
        calls += 1  # validate asks the model for extra test inputs
        checks = list(result.checks)

        skills_meta: list[dict[str, Any]] = []
        if not result.failed:
            checks.append(constructs_check(self.course, concept_id, proposal.reference_solution))
            checks.append(duplicate_check(statement, existing))
            if self.nli is None:
                checks.append(
                    {
                        "name": "taught_scope",
                        "status": "warn",
                        "detail": "not checked: the claim checker is switched off",
                    }
                )
            else:
                check, rows = taught_scope(
                    self.nli,
                    proposal.skills,
                    taught_premises(self.course, concept_id),
                    self.threshold,
                )
                checks.append(check)
                skills_meta = [
                    {"skill": r.skill, "p_entailment": round(r.p_entailment, 4)} for r in rows
                ]

        return GeneratedDraft(
            concept_id=concept_id,
            level=level,
            title=proposal.title,
            statement=statement,
            reference_solution=proposal.reference_solution,
            checks=checks,
            tests=result.tests,
            generation={
                "title": proposal.title,
                "provider": self.provider.name,
                "model": model,
                "prompt_version": PROMPT_VERSION,
                "hint": hint,
                "model_calls": calls,
                "skills": skills_meta or [{"skill": s} for s in proposal.skills],
                "threshold": self.threshold,
                "seconds": round(time.perf_counter() - started, 1),
            },
        )

    # ---------------------------------------------------------------- steps
    def _ask(self, prompt: str) -> tuple[Proposal, str, int]:
        retry = "\n\nYour last reply could not be used ({why}). Reply with the JSON object only."
        why = ""
        for calls in (1, 2):
            reply = self.provider.generate(
                system=SYSTEM,
                prompt=prompt + (retry.format(why=why) if why else ""),
                max_tokens=2200,
                temperature=0.7,
            )
            try:
                return parse_proposal(reply.text), reply.model, calls
            except ProposalError as exc:
                why = str(exc)
        raise ProposalError(why)

    def _statement(self, proposal: Proposal) -> str:
        """The task with a sample whose output was produced by running the solution. If the
        solution is unsafe, will not compile or prints nothing, the task is returned without a
        sample and the checks that follow report why."""
        if DANGEROUS.search(proposal.reference_solution):
            return assemble_statement(proposal.description, None)
        output = sample_output(self.runner, proposal.reference_solution, proposal.sample_input)
        sample = (proposal.sample_input, output) if output is not None else None
        return assemble_statement(proposal.description, sample)


def _task_text(statement: str) -> str:
    return statement.split("Sample input", 1)[0].strip()


__all__ = ["DraftGenerator", "GeneratedDraft", "LLMError", "ProposalError"]
