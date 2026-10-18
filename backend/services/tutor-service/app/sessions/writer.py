"""The tutor's own words: explanations, hints and re-teaches, written by a language model
and checked by the faithfulness gate before anyone sees them.

Every prompt gives the model ONE authored course passage and tells it to use nothing
else, and none of them ever contains an answer key. That is a request, not a guarantee:
a model can still add something that is not in the passage. The gate (app/verification)
is what turns the request into a check. A generated text reaches a student only if the
gate passes it. If the gate blocks it, the model is asked once more and told which
statements were unsupported; if that is blocked too, nothing generated is shown and the
caller falls back to the authored passage.

Every attempt, passed or blocked, comes back in `WriteResult.audits` so the caller can
log it. If no model is configured, or a call fails, `generated` is None and the session
shows the authored passage. A session never waits on, or breaks because of, a model.
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
from collections.abc import Callable, Collection, Sequence
from dataclasses import dataclass

from app.llm.providers import LLMError, LLMProvider, LLMQuotaError
from app.verification.claims import trim_unsupported
from app.verification.gate import FaithfulnessGate, GateResult

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
        "Explain the MAIN passage to the student in your own words, in 120 to 200 words. "
        "Do not copy its sentences: rephrase them as a tutor speaking to a first-year "
        "student. Where a related passage adds something useful, such as an example or a "
        "common mistake, work it in. Keep the code examples that matter."
    ),
    HINT: (
        "The student is stuck on the question below. Write ONE short hint (at most 40 words) "
        "that points them to the idea in the passage they need. Do not give the answer, "
        "the program's output, or any final value."
    ),
    RETEACH: (
        "The student did not understand this passage the first time. Explain it again from a "
        "different angle, such as a step-by-step trace or a plain-language comparison that "
        "adds no new facts, in 100 to 160 words."
    ),
}


@dataclass(frozen=True)
class Generated:
    text: str
    provider: str
    model: str
    # True: the gate passed it. None: the gate was not run on it (off, or not this kind).
    verified: bool | None = None


@dataclass(frozen=True)
class GateAudit:
    """One generated text and what the gate decided about it."""

    attempt: int  # 1 for the first text, 2 for the regeneration
    text: str
    result: GateResult


@dataclass(frozen=True)
class WriteResult:
    generated: Generated | None  # None means: show the authored passage
    audits: tuple[GateAudit, ...] = ()
    blocked: bool = False  # True when the gate rejected every text it was shown
    # Why nothing was produced, when the retry policy was in force: blocked (the gate kept
    # rejecting), failures (the model kept failing), quota (the day's allowance is used up) or
    # gate_error (the checker itself broke). Empty when text was produced.
    reason: str = ""


@dataclass(frozen=True)
class RetryPolicy:
    """How hard to try before giving up and showing the authored text (live mode).

    A ROUND is one model call and, if the text is gated, its check, including the step that
    cuts the failing sentences and checks what is left. Rounds the gate rejects count as BLOCKS;
    model calls that fail (an error, or an empty or over-long reply) count as FAILURES. The
    two are counted apart, and reaching either limit stops the attempt.
    """

    max_blocks: int = 3
    max_failures: int = 5
    backoff: float = 1.0  # seconds before the first retry after a failure; doubles each time
    sleep: Callable[[float], None] = time.sleep


class TutorWriter:
    def __init__(
        self,
        provider: LLMProvider | None,
        gate: FaithfulnessGate | None = None,
        *,
        max_regenerations: int = 1,
        gated_kinds: Collection[str] = (EXPLAIN, RETEACH, HINT),
        policy: RetryPolicy | None = None,
    ) -> None:
        self._provider = provider
        self._gate = gate
        self._regenerations = max(0, max_regenerations)
        self._gated = frozenset(gated_kinds)
        # With a policy the writer tries until it is satisfied or the policy says stop. Without
        # one it makes 1 + max_regenerations tries, as it always did.
        self._policy = policy

    @property
    def enabled(self) -> bool:
        return self._provider is not None

    def cache_fingerprint(self, kind: str) -> str | None:
        """Identifies everything that could change a stored explanation, or None if this
        kind of text must not be shared between sessions.

        Explanations and re-teaches are shared (each depends on the passage alone, where a
        hint depends on the question), and only when the gate checked them: text that was
        not checked is never handed to other students.
        """
        if kind not in (EXPLAIN, RETEACH) or self._provider is None or self._gate is None:
            return None
        if kind not in self._gated:
            return None
        prompt = hashlib.sha1((SYSTEM + _TASKS[kind]).encode()).hexdigest()[:10]  # noqa: S324
        gate = self._gate
        return "|".join(
            [
                kind,
                prompt,
                self._provider.model,
                gate.nli.name,
                f"{gate.threshold}",
                gate.granularity,
                type(gate.decomposer).__name__,
                f"windows{int(gate.windows)}",
                "rag1",  # explanations are built from retrieved passages as well as the main one
            ]
        )

    def _write_with_policy(
        self,
        kind: str,
        base: str,
        passage: str,
        support: Sequence[tuple[str, str]],
        gated: bool,
        policy: RetryPolicy,
    ) -> WriteResult:
        """The live-mode loop: keep asking until a text passes, the gate has rejected
        `policy.max_blocks` texts, or the model has failed `policy.max_failures` times."""
        assert self._provider is not None
        premises = [passage, *(t for _, t in support)]
        audits: list[GateAudit] = []
        blocks = failures = 0
        prompt = base

        while True:
            try:
                result = self._provider.generate(
                    system=SYSTEM,
                    prompt=prompt,
                    max_tokens=300 if kind == HINT else 700,
                    temperature=0.3,
                )
                text = result.text.strip()
                if not text or len(text) > MAX_CHARS:
                    raise LLMError("the reply was empty or too long")
            except LLMQuotaError:
                # The day's allowance is gone: another try cannot work, so stop at once.
                log.warning(
                    "tutor text fell back to the course: quota used up", extra={"kind": kind}
                )
                return WriteResult(None, tuple(audits), reason="quota")
            except LLMError as exc:
                failures += 1
                log.warning(
                    "tutor text: the model failed",
                    extra={"kind": kind, "why": str(exc), "failures": failures},
                )
                if failures >= policy.max_failures:
                    return WriteResult(None, tuple(audits), reason="failures")
                policy.sleep(policy.backoff * 2 ** (failures - 1))
                continue

            if not gated:
                return WriteResult(Generated(text, result.provider, result.model, None))

            assert self._gate is not None
            try:
                verdict = self._gate.check(text, premises)
            except Exception:
                # The checker itself failed. Fail closed: unchecked text is never shown as if it
                # had been checked, and asking the model again would not mend the checker.
                log.exception("faithfulness gate failed to run")
                return WriteResult(None, tuple(audits), blocked=True, reason="gate_error")

            audits.append(GateAudit(len(audits) + 1, text, verdict))
            if verdict.passed:
                return WriteResult(
                    Generated(text, result.provider, result.model, True), tuple(audits)
                )

            # Cut just the sentences that failed and check what is left with the same gate, before
            # spending another model call. Part of the same round: it does not count as a block.
            if all(v.kind == "claim" for v in verdict.unsupported):
                trimmed = trim_unsupported(text, [v.text for v in verdict.unsupported])
                if trimmed is not None:
                    try:
                        recheck = self._gate.check(trimmed, premises)
                    except Exception:
                        log.exception("faithfulness gate failed to run")
                        return WriteResult(None, tuple(audits), blocked=True, reason="gate_error")
                    audits.append(GateAudit(len(audits) + 1, trimmed, recheck))
                    if recheck.passed:
                        return WriteResult(
                            Generated(trimmed, result.provider, result.model, True), tuple(audits)
                        )

            blocks += 1
            if blocks >= policy.max_blocks:
                return WriteResult(None, tuple(audits), blocked=True, reason="blocked")
            prompt = base + _retry_note([v.text for v in verdict.unsupported])

    def write(
        self,
        kind: str,
        *,
        concept: str,
        passage: str,
        question: str | None = None,
        support: Sequence[tuple[str, str]] = (),
    ) -> WriteResult:
        """Text for one point of a session, checked if the gate applies to this kind.

        `support` is (label, text) for passages retrieved to help with the main one. The
        model may draw on them and the gate accepts a claim that any of them supports.
        """
        if self._provider is None:
            return WriteResult(None)

        base = f"Concept: {concept}\n\nMAIN course passage:\n<<<\n{passage}\n>>>\n\n"
        if support:
            base += "Related course passages (retrieved from the course; use only what helps):\n"
            for label, text in support:
                base += f"[{label}]\n<<<\n{text}\n>>>\n"
            base += "\n"
        if question is not None:
            base += f"Question:\n<<<\n{question}\n>>>\n\n"
        base += _TASKS[kind]

        gated = self._gate is not None and kind in self._gated
        if self._policy is not None:
            return self._write_with_policy(kind, base, passage, support, gated, self._policy)
        tries = 1 + (self._regenerations if gated else 0)
        audits: list[GateAudit] = []
        prompt = base

        for attempt in range(1, tries + 1):
            try:
                result = self._provider.generate(
                    system=SYSTEM,
                    prompt=prompt,
                    max_tokens=300 if kind == HINT else 700,
                    temperature=0.3,
                )
            except LLMError as exc:
                log.warning(
                    "tutor text fell back to the course", extra={"kind": kind, "why": str(exc)}
                )
                return WriteResult(None, tuple(audits))

            text = result.text.strip()
            if not text or len(text) > MAX_CHARS:
                return WriteResult(None, tuple(audits))

            if not gated:
                return WriteResult(Generated(text, result.provider, result.model, None))

            assert self._gate is not None
            try:
                verdict = self._gate.check(text, [passage, *(t for _, t in support)])
            except Exception:
                # The checker itself failed. Fail closed: unchecked text is never shown
                # as if it had been checked.
                log.exception("faithfulness gate failed to run")
                return WriteResult(None, tuple(audits), blocked=True)

            audits.append(GateAudit(attempt, text, verdict))
            if verdict.passed:
                return WriteResult(
                    Generated(text, result.provider, result.model, True), tuple(audits)
                )
            # Something in this text is unsupported. Before spending another model call on a
            # rewrite, cut just the sentences that failed and check what is left with the same
            # gate. Measured on the operators concept, rewriting never produced a passing text
            # (four rewrites in a row failed) while cutting the failing sentences did, so
            # cutting comes first. The result is shown only if it passes.
            if all(v.kind == "claim" for v in verdict.unsupported):
                trimmed = trim_unsupported(text, [v.text for v in verdict.unsupported])
                if trimmed is not None:
                    try:
                        recheck = self._gate.check(trimmed, [passage, *(t for _, t in support)])
                    except Exception:
                        log.exception("faithfulness gate failed to run")
                        return WriteResult(None, tuple(audits), blocked=True)
                    audits.append(GateAudit(len(audits) + 1, trimmed, recheck))
                    if recheck.passed:
                        return WriteResult(
                            Generated(trimmed, result.provider, result.model, True), tuple(audits)
                        )

            prompt = base + _retry_note([v.text for v in verdict.unsupported])

        return WriteResult(None, tuple(audits), blocked=True)


def passage_hash(passage: str) -> str:
    """Identifies the exact passage text a stored explanation was written and checked from."""
    return hashlib.sha256(passage.encode()).hexdigest()


def _retry_note(unsupported: list[str]) -> str:
    listed = "\n".join(f"- {claim}" for claim in unsupported[:6])
    return (
        "\n\nA fact-checker found that these statements in your previous attempt are NOT "
        f"supported by the passage:\n{listed}\n"
        "Write the response again using only what the passage states. Leave those "
        "statements out or correct them."
    )


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
