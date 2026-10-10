"""Keyword ranking and rank fusion, for hybrid retrieval. Pure Python, no I/O.

Why hybrid: measured on the Programming module, an embedding model alone did well on
questions phrased in words and poorly on pasted programs, while plain keyword matching
did the reverse (it found the concept by the code and vocabulary it shares with the
course, and collapsed on natural phrasing). Fusing the two rankings was not
significantly worse than the best single method on any query set and ranked the right
concept first significantly more often than the embedding alone. The evidence, with
intervals, is in research/c3-RAG tutor/README.md.

Rank fusion uses only ranks, so nothing has to be tuned about how a keyword score
compares with a cosine distance.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence

# The standard reciprocal-rank-fusion constant. Larger flattens the contribution of
# the very top ranks; 60 is the value the literature and most implementations use.
RRF_C = 60


def tokens(text: str) -> list[str]:
    """Lower-case words and numbers. Code punctuation is dropped, identifiers kept."""
    return re.findall(r"[a-z0-9]+", text.lower())


class BM25:
    """Okapi BM25 over a fixed set of documents, written out so nothing is hidden."""

    def __init__(self, documents: Sequence[Sequence[str]], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self._lengths = [len(d) for d in documents]
        self._average = (sum(self._lengths) / len(self._lengths)) if self._lengths else 0.0

        self._postings: dict[str, dict[int, int]] = defaultdict(dict)
        for index, document in enumerate(documents):
            for term, count in Counter(document).items():
                self._postings[term][index] = count

        n = len(documents)
        self._idf = {
            term: math.log(1 + (n - len(docs) + 0.5) / (len(docs) + 0.5))
            for term, docs in self._postings.items()
        }

    def scores(self, query: Sequence[str]) -> dict[int, float]:
        """Score of every document that shares at least one term with the query."""
        result: dict[int, float] = defaultdict(float)
        for term in set(query):
            idf = self._idf.get(term)
            if idf is None:
                continue
            for index, frequency in self._postings[term].items():
                norm = self.k1 * (1 - self.b + self.b * self._lengths[index] / self._average)
                result[index] += idf * frequency * (self.k1 + 1) / (frequency + norm)
        return result

    def rank(
        self, query: Sequence[str], *, allowed: Iterable[int] | None = None, limit: int
    ) -> list[int]:
        """Document indexes, best first. Only documents that match a query term appear.

        A document sharing no term with the query has no keyword evidence either way,
        so it is left out rather than placed in an arbitrary order.
        """
        scores = self.scores(query)
        if allowed is not None:
            keep = set(allowed)
            scores = {i: s for i, s in scores.items() if i in keep}
        return sorted(scores, key=lambda i: (-scores[i], i))[:limit]


def reciprocal_rank_fusion(rankings: Sequence[Sequence[str]]) -> list[str]:
    """Merge several best-first lists of IDs. An ID near the top of any list rises."""
    score: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            score[item] += 1 / (RRF_C + rank)
    # Ties broken by first appearance, so the result is deterministic.
    first_seen = {item: n for n, item in enumerate(i for r in rankings for i in r)}
    return sorted(score, key=lambda i: (-score[i], first_seen[i]))
