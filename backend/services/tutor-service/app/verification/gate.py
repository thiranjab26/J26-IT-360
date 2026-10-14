"""The faithfulness gate: nothing the tutor generates reaches a student unchecked.

Given a generated response and the course passage it was written from, the gate decides
PASS or BLOCK. A response passes only if every statement in it is supported:

    prose   split into claims (sentences or atomic claims); each claim must reach the
            entailment threshold against the passage
    code    every line must appear in the passage's own code

One unsupported claim blocks the whole response. That is deliberate, and it is also why
the per-claim threshold matters so much: a response of eight claims passes only if all
eight do, so a small per-claim false-block rate becomes a large per-response one. The
threshold is therefore a measured result (research/c3-RAG tutor), not a default.

Two granularities exist so the study can compare them. `claim` (the proposed method)
judges each claim on its own. `whole_response` (the baseline) judges the entire prose as
one hypothesis, which cannot say WHICH statement is wrong and tends to let a single bad
claim hide inside many good ones.

This module decides; it neither generates nor stores. The caller logs the result.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass

from app.retrieval.hybrid import tokens
from app.verification.claims import (
    Decomposer,
    SentenceDecomposer,
    passage_windows,
    split_parts,
    unsupported_code_lines,
)
from app.verification.nli import Entailment, NLIModel

CLAIM = "claim"
WHOLE_RESPONSE = "whole_response"
CODE_MODEL = "code-verbatim"


@dataclass(frozen=True)
class ClaimVerdict:
    text: str
    kind: str  # "claim" | "response" | "code"
    supported: bool
    p_entailment: float | None  # None for code lines, which are not scored by a model
    label: str | None  # the model's top label, for analysis only
    model: str


@dataclass(frozen=True)
class GateResult:
    passed: bool
    granularity: str
    threshold: float
    decomposition: str  # how the prose was split; "none" when there was no prose
    verdicts: tuple[ClaimVerdict, ...]
    decompose_ms: int
    verify_ms: int

    @property
    def unsupported(self) -> tuple[ClaimVerdict, ...]:
        return tuple(v for v in self.verdicts if not v.supported)

    @property
    def total_ms(self) -> int:
        return self.decompose_ms + self.verify_ms


MAX_PREMISES = 4


def score_against(
    nli: NLIModel,
    passage: str | Sequence[str],
    claims: list[str],
    windows: bool,
    max_premises: int = MAX_PREMISES,
) -> list[Entailment]:
    """Each claim's best score against the passage(s) and, if `windows`, short stretches of
    each. The stretch (or whole passage) that supports a claim most is the one that counts.

    With several passages, a claim is supported if ANY of them supports it: an explanation
    built from a main passage and the passages retrieved to help may draw on any of them.

    The cost is bounded. Judging every claim against every stretch of every passage is dozens
    of model calls per claim, minutes for one explanation. Each claim is instead judged
    against the `max_premises` candidates that share the most of its words, which is where
    its support is if it has any. With one passage that is nearly all of its stretches, so
    the calibration on single passages stands; with several it keeps the check interactive.
    """
    if not claims:
        return []
    passages = [passage] if isinstance(passage, str) else list(passage)
    premises: list[str] = []
    for text in passages:
        for premise in [text, *(passage_windows(text) if windows else [])]:
            if premise not in premises:
                premises.append(premise)

    premise_words = [set(tokens(p)) for p in premises]
    pairs: list[tuple[str, str]] = []
    chosen: list[int] = []  # how many premises each claim got
    for claim in claims:
        words = set(tokens(claim)) or {claim}
        ranked = sorted(
            range(len(premises)),
            key=lambda i: len(words & premise_words[i]) / len(words),
            reverse=True,
        )[:max_premises]
        chosen.append(len(ranked))
        pairs.extend((premises[i], claim) for i in ranked)

    scores = nli.score(pairs)
    results: list[Entailment] = []
    offset = 0
    for count in chosen:
        results.append(max(scores[offset : offset + count], key=lambda s: s.entailment))
        offset += count
    return results


class FaithfulnessGate:
    def __init__(
        self,
        nli: NLIModel,
        *,
        threshold: float,
        decomposer: Decomposer | None = None,
        granularity: str = CLAIM,
        windows: bool = False,
    ) -> None:
        if not 0.0 < threshold < 1.0:
            raise ValueError("the threshold is a probability strictly between 0 and 1")
        if granularity not in (CLAIM, WHOLE_RESPONSE):
            raise ValueError(f"unknown granularity {granularity!r}")
        self.nli = nli
        self.threshold = threshold
        self.decomposer = decomposer or SentenceDecomposer()
        self.granularity = granularity
        self.windows = windows

    def check(self, text: str, passage: str | Sequence[str]) -> GateResult:
        passages = [passage] if isinstance(passage, str) else list(passage)
        parts = split_parts(text)
        verdicts: list[ClaimVerdict] = []

        started = time.perf_counter()
        if self.granularity == CLAIM:
            decomposition = self.decomposer.decompose(parts.prose)
            hypotheses, method = list(decomposition.claims), decomposition.method
            kind = "claim"
        else:
            body = parts.prose.replace("[a code example]", " ").strip()
            hypotheses, method, kind = ([body] if body else []), "none", "response"
        decompose_ms = int((time.perf_counter() - started) * 1000)

        started = time.perf_counter()
        if hypotheses:
            scores = score_against(self.nli, passages, hypotheses, self.windows)
            for claim, score in zip(hypotheses, scores, strict=True):
                verdicts.append(
                    ClaimVerdict(
                        text=claim,
                        kind=kind,
                        supported=score.entailment >= self.threshold,
                        p_entailment=score.entailment,
                        label=score.label,
                        model=self.nli.name,
                    )
                )
        for line in unsupported_code_lines(parts.code_blocks, "\n\n".join(passages)):
            verdicts.append(
                ClaimVerdict(
                    text=line,
                    kind="code",
                    supported=False,
                    p_entailment=None,
                    label=None,
                    model=CODE_MODEL,
                )
            )
        verify_ms = int((time.perf_counter() - started) * 1000)

        return GateResult(
            passed=all(v.supported for v in verdicts),
            granularity=self.granularity,
            threshold=self.threshold,
            decomposition=method if hypotheses else "none",
            verdicts=tuple(verdicts),
            decompose_ms=decompose_ms,
            verify_ms=verify_ms,
        )
