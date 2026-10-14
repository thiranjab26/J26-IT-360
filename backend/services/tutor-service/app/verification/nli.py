"""Natural language inference: does a passage support a claim?

The faithfulness gate asks one question of every statement the tutor makes: given the
course passage it was written from, is this statement supported? An NLI model answers
with three probabilities (entailment, neutral, contradiction). The gate uses the
probability of ENTAILMENT against a calibrated threshold, not the model's top label:
the top label rejects too many correct paraphrases (see research/c3-RAG tutor/README.md,
NLI section).

`DebertaNLI` runs the model in this process on the CPU. Two lessons from the spike are
built in: the fact-verification checkpoint ships in half precision, which is about nine
times slower on a CPU until it is converted, so the weights are forced to float32; and
the premise is truncated, never the claim, so a long passage cannot cut the statement
being judged.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

DEFAULT_MODEL = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"


@dataclass(frozen=True)
class Entailment:
    """The model's three probabilities for one (premise, claim) pair. They sum to 1."""

    entailment: float
    neutral: float
    contradiction: float

    @property
    def label(self) -> str:
        """The top label. Reported for analysis; the gate decides on `entailment` alone."""
        best = max(
            (self.entailment, "entailment"),
            (self.neutral, "neutral"),
            (self.contradiction, "contradiction"),
        )
        return best[1]


class NLIModel(Protocol):
    name: str

    def score(self, pairs: Sequence[tuple[str, str]]) -> list[Entailment]:
        """One result per (premise, claim) pair, in order."""
        ...


def _canonical(label: str) -> str:
    label = label.lower()
    for key, name in (
        ("entail", "entailment"),
        ("contradict", "contradiction"),
        ("neutral", "neutral"),
    ):
        if key in label:
            return name
    raise ValueError(f"unrecognised NLI label {label!r}")


class DebertaNLI:
    """A DeBERTa-v3 NLI cross-encoder, loaded on first use and shared across requests."""

    def __init__(self, model_name: str = DEFAULT_MODEL, batch_size: int = 8) -> None:
        self.name = model_name
        self._batch = batch_size
        self._lock = threading.Lock()
        self._tokenizer = None
        self._model = None
        self._order: list[str] = []

    def load(self) -> None:
        """Load the weights now. Safe to call repeatedly; called at start-up to keep the
        first student's request from paying for it."""
        with self._lock:
            if self._model is not None:
                return
            # Imported here so that importing this module (and running the unit tests)
            # does not load torch.
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            tokenizer = AutoTokenizer.from_pretrained(self.name)
            model = AutoModelForSequenceClassification.from_pretrained(self.name).eval().float()
            self._order = [
                _canonical(model.config.id2label[i]) for i in range(model.config.num_labels)
            ]
            self._tokenizer, self._model = tokenizer, model

    def score(self, pairs: Sequence[tuple[str, str]]) -> list[Entailment]:
        if not pairs:
            return []
        self.load()
        import torch

        results: list[Entailment] = []
        for start in range(0, len(pairs), self._batch):
            chunk = pairs[start : start + self._batch]
            encoded = self._tokenizer(
                [premise for premise, _ in chunk],
                [claim for _, claim in chunk],
                padding=True,
                truncation="only_first",  # never cut the claim, only a long premise
                max_length=512,
                return_tensors="pt",
            )
            with torch.no_grad():
                probabilities = torch.softmax(self._model(**encoded).logits, dim=-1)
            for row in probabilities:
                by_label = {name: float(row[i]) for i, name in enumerate(self._order)}
                results.append(
                    Entailment(
                        entailment=by_label["entailment"],
                        neutral=by_label["neutral"],
                        contradiction=by_label["contradiction"],
                    )
                )
        return results


def timed(model: NLIModel, pairs: Sequence[tuple[str, str]]) -> tuple[list[Entailment], int]:
    """Scores and the time taken in milliseconds."""
    started = time.perf_counter()
    scores = model.score(pairs)
    return scores, int((time.perf_counter() - started) * 1000)
