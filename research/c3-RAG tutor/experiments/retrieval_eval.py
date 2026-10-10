"""Retrieval quality experiment (C3, phase P1 step 5).

Question: which retrieval setup surfaces the right course material for a student's
question, and does an embedding model beat plain keyword matching at all?

Queries    The 143 authored practice questions, each used as a student's question.
           In tutoring mode the exercises are not in the searchable pool, so a query
           can never retrieve itself: the set is held out by construction.
Truth      A question belongs to one concept. A result is *relevant* if it comes from
           that concept (strict), or from it or one of its direct prerequisites
           (relaxed, because a loops question about `%` is legitimately answered by
           the operators concept).
Pool       What the tutor may retrieve: theory, examples, misconceptions and facts,
           through the real Retriever, so the access rules are part of what is tested.
Arms       bge-small (512-token window), MiniLM as shipped (256), MiniLM with its
           window forced to 512, and BM25 as a keyword baseline.
Metrics    Hit@k (query level: did the right concept appear in the top k; this is the
           "recall" of the methodology), Precision@k, MRR@10. Means carry 95%
           bootstrap confidence intervals over queries, and arms are compared with a
           paired bootstrap, because 143 queries is a small sample.

Limits, stated so they travel with the numbers: ground truth is concept level, not
chunk level; the queries are practice questions, not free student phrasing; one
module, one author. Results are about this content, not retrieval in general.

Run from the repo root:
    uv run --project backend/services/tutor-service \\
        python "research/c3-RAG tutor/experiments/retrieval_eval.py"
"""

# ruff: noqa: E501  (analysis script: long report strings are clearer unwrapped)
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SERVICE = REPO / "backend" / "services" / "tutor-service"
RESULTS = HERE.parent / "results"

# The service reads .env relative to its own folder, and its code is importable
# only from there. This script is research tooling, not part of the service.
os.chdir(SERVICE)
sys.path.insert(0, str(SERVICE))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

from app.config import get_settings  # noqa: E402
from app.content.chunker import chunk_unit  # noqa: E402
from app.content.embedder import SentenceTransformerEmbedder  # noqa: E402
from app.content.indexer import embed_text, index_module, open_store, truncated_chunks  # noqa: E402
from app.content.loader import load_content  # noqa: E402
from app.retrieval.access import RetrievalMode, searchable_sections  # noqa: E402
from app.retrieval.hybrid import BM25, tokens  # noqa: E402
from app.retrieval.retriever import Retriever  # noqa: E402

MODULE = "prog"
K_MAX = 10
K_FUSE = 60  # depth kept for the keyword baseline (the production retriever uses its own)
PROSE_MIN_WORDS = 12
KS = (1, 3, 5, 10)
BOOTSTRAP = 4000
SEED = 20261005

# Questions the course does not answer. Used only to look at how far away a wrong
# answer sits, to choose a cut-off. Two groups: plainly unrelated, and Java topics
# that are real but outside this module.
UNRELATED = [
    "what is the capital of France",
    "how do I train a neural network",
    "explain the French revolution",
    "how do I center a div in CSS",
    "what is photosynthesis",
    "how do I make a pizza",
]
JAVA_NOT_COVERED = [
    "how do I use Java streams to filter a list",
    "what is a lambda expression in Java",
    "explain inheritance and polymorphism",
    "how do generics work in Java",
    "how do I read a file in Java",
    "what is multithreading and how do I start a thread",
]


# --------------------------------------------------------------------------- data
@dataclass(frozen=True)
class Query:
    chunk_id: str
    concept_id: str
    level: int
    text: str


class Window512(SentenceTransformerEmbedder):
    """MiniLM with its input window forced from 256 to 512 tokens.

    Not how the model was trained, so this arm asks whether simply lifting the limit
    rescues it, or whether a model built for long input is needed.
    """

    def __init__(self) -> None:
        super().__init__("sentence-transformers/all-MiniLM-L6-v2")
        self.name = "sentence-transformers/all-MiniLM-L6-v2@512tok"

    def _load(self):  # noqa: ANN202
        # `name` is the collection label here, so load the real model by its own id.
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
            self._model.max_seq_length = 512
        return self._model


class BgeNoInstruction(SentenceTransformerEmbedder):
    """bge-small queried without its retrieval instruction.

    The instruction is meant for short queries. Ours are long and contain code, so it
    may be hurting. Same `name`, so it searches the same collection as the bge arm and
    only the query embedding differs.
    """

    def __init__(self) -> None:
        super().__init__("BAAI/bge-small-en-v1.5")
        self._query_prefix = ""


CODE_FENCE = re.compile(r"```.*?```", re.S)
QUESTION_HEADER = re.compile(r"^\*\*Q\d+\.[^*]*\*\*\s*")


def build_queries(chunks) -> list[Query]:
    queries = []
    for chunk in chunks:
        if chunk.section_type == "exercise":
            queries.append(
                Query(
                    chunk_id=chunk.chunk_id,
                    concept_id=chunk.concept_id,
                    level=chunk.level,
                    text=QUESTION_HEADER.sub("", chunk.text).strip(),
                )
            )
    return queries


# ------------------------------------------------------------------------- metrics
def relevance_flags(ranked_concepts: list[str], relevant: set[str]) -> list[bool]:
    return [c in relevant for c in ranked_concepts]


def per_query_metrics(flags: list[bool]) -> dict[str, float]:
    row: dict[str, float] = {}
    for k in KS:
        top = flags[:k]
        row[f"hit@{k}"] = float(any(top))
        row[f"p@{k}"] = sum(top) / k
    row["mrr"] = next((1 / (i + 1) for i, f in enumerate(flags[:K_MAX]) if f), 0.0)
    return row


def bootstrap_mean(values: np.ndarray, rng: np.random.Generator) -> tuple[float, float, float]:
    idx = rng.integers(0, len(values), (BOOTSTRAP, len(values)))
    means = values[idx].mean(axis=1)
    return float(values.mean()), float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def paired_difference(
    a: np.ndarray, b: np.ndarray, rng: np.random.Generator
) -> tuple[float, float, float]:
    return bootstrap_mean(a - b, rng)


def fmt(point_lo_hi: tuple[float, float, float]) -> str:
    p, lo, hi = point_lo_hi
    return f"{p:.3f} [{lo:.3f}, {hi:.3f}]"


# --------------------------------------------------------------------------- runner
def provenance(units, chunks, pool, n_queries: dict[str, int]) -> dict:
    def git(*args: str) -> str:
        try:
            return subprocess.run(
                ["git", *args], cwd=REPO, capture_output=True, text=True, timeout=10
            ).stdout.strip()
        except Exception:  # noqa: BLE001
            return "unknown"

    return {
        "date": date.today().isoformat(),
        "git_commit": git("rev-parse", "--short", "HEAD"),
        "git_dirty": bool(git("status", "--porcelain")),
        "content_hash": hashlib.sha256("".join(u.content_hash for u in units).encode()).hexdigest()[
            :16
        ],
        "units": len(units),
        "chunks_total": len(chunks),
        "chunks_in_tutoring_pool": len(pool),
        "query_sets": n_queries,
        "k_max": K_MAX,
        "bootstrap_resamples": BOOTSTRAP,
        "seed": SEED,
    }


def prose_only(queries: list[Query]) -> list[Query]:
    """Practice questions with the code removed, keeping those that still say something.

    A student asks in words. A question that is mostly a program ("what does this
    print?") is matched on code boilerplate, which is not what we want to measure.
    """
    kept = []
    for q in queries:
        words = re.sub(r"\s+", " ", CODE_FENCE.sub(" ", q.text)).strip()
        if len(words.split()) >= PROSE_MIN_WORDS:
            # A distinct ID: this is a different query text for the same question, and the
            # rankings are stored by ID. Sharing the ID with the as-written question made
            # the two sets overwrite each other.
            kept.append(Query(f"{q.chunk_id}@prose", q.concept_id, q.level, words))
    return kept


def load_student_queries(path: Path) -> list[Query]:
    """Optional hand-written, natural questions: [{concept: prog.loops, text: ...}]."""
    import yaml

    if not path.exists():
        return []
    rows = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    return [
        Query(f"student#{i:03d}", row["concept"], 0, str(row["text"]).strip())
        for i, row in enumerate(rows, start=1)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--no-save", action="store_true", help="print only, write no files")
    parser.add_argument(
        "--student-queries",
        type=Path,
        default=HERE / "student_queries.yaml",
        help="optional hand-written natural questions (default: student_queries.yaml)",
    )
    args = parser.parse_args()

    units = load_content(get_settings().content_root, MODULE)
    chunks = [c for u in units for c in chunk_unit(u)]
    allowed = set(searchable_sections(RetrievalMode.TUTORING))
    pool = [c for c in chunks if c.section_type in allowed]
    prereqs = {u.concept_id: set(u.all_prerequisites) for u in units if u.concept_id}
    concept_size = Counter(c.concept_id for c in pool)

    practice = build_queries(chunks)
    query_sets: dict[str, list[Query]] = {
        f"practice questions as written (n={len(practice)})": practice,
    }
    prose = prose_only(practice)
    query_sets[f"practice questions, code removed (n={len(prose)})"] = prose
    student = load_student_queries(args.student_queries)
    if student:
        query_sets[f"student-style, hand written (n={len(student)})"] = student

    everything = {q.chunk_id: q for qs in query_sets.values() for q in qs}
    # Rankings are keyed by this ID, so two different queries must never share one.
    assert len(everything) == sum(len(qs) for qs in query_sets.values()), "query ids collide"
    print(
        f"{len(pool)} chunks in the tutoring pool (avg {len(pool) / len(concept_size):.0f} per "
        f"concept) | query sets: "
        + ", ".join(f"{name.split(' (')[0]} {len(qs)}" for name, qs in query_sets.items())
        + "\n"
    )

    store = open_store(RESULTS / "chroma-eval")
    arms: dict[str, dict] = {}

    # ---- dense arms, through the real retriever so the access rules are exercised
    for label, embedder in (
        (
            "bge-small-en-v1.5 (512-token window)",
            SentenceTransformerEmbedder("BAAI/bge-small-en-v1.5"),
        ),
        ("bge-small-en-v1.5, no query instruction", BgeNoInstruction()),
        (
            "all-MiniLM-L6-v2 (256-token window, as shipped)",
            SentenceTransformerEmbedder("sentence-transformers/all-MiniLM-L6-v2"),
        ),
        ("all-MiniLM-L6-v2 (window forced to 512)", Window512()),
    ):
        started = time.perf_counter()
        index_module(store, embedder, MODULE, chunks)
        cut = truncated_chunks(embedder, pool)
        retriever = Retriever(store, embedder)

        ranked: dict[str, list[tuple[str, str, float]]] = {}
        top1: list[float] = []
        for q in practice:
            found = retriever.search(
                q.text, mode=RetrievalMode.TUTORING, module_id=MODULE, k=K_FUSE, method="dense"
            )
            ranked[q.chunk_id] = [(p.chunk_id, p.concept_id, p.distance) for p in found]
            top1.append(found[0].distance)
        for q in everything.values():
            if q.chunk_id not in ranked:
                found = retriever.search(
                    q.text, mode=RetrievalMode.TUTORING, module_id=MODULE, k=K_FUSE, method="dense"
                )
                ranked[q.chunk_id] = [(p.chunk_id, p.concept_id, p.distance) for p in found]

        oos = {
            name: [
                retriever.search(
                    t, mode=RetrievalMode.TUTORING, module_id=MODULE, k=1, method="dense"
                )[0].distance
                for t in group
            ]
            for name, group in (("unrelated", UNRELATED), ("java_not_covered", JAVA_NOT_COVERED))
        }
        arms[label] = {
            "ranked": ranked,
            "retriever": retriever,
            "truncated": len(cut),
            "pool": len(pool),
            "top1_in_scope": top1,
            "top1_oos": oos,
            "seconds": time.perf_counter() - started,
        }
        print(f"  done: {label} ({arms[label]['seconds']:.0f}s, {len(cut)} pool chunks cut off)")

    # ---- keyword baseline over the same pool, the same text the dense models embed
    bm25 = BM25([tokens(embed_text(c)) for c in pool])
    ranked = {}
    for q in everything.values():
        order = bm25.rank(tokens(q.text), limit=K_FUSE)
        ranked[q.chunk_id] = [(pool[i].chunk_id, pool[i].concept_id, 0.0) for i in order]
    arms["BM25 keyword baseline"] = {"ranked": ranked, "truncated": 0, "pool": len(pool)}

    # ---- hybrids: the production retriever's default method, so what is measured here
    # is exactly the code the service runs. Keyword matching wins when a question shares
    # code and vocabulary with the content, embeddings win on natural phrasing, and
    # fusing the two rankings by rank needs no tuning of scores against distances.
    for dense in (
        "bge-small-en-v1.5 (512-token window)",
        "all-MiniLM-L6-v2 (256-token window, as shipped)",
    ):
        retriever = arms[dense]["retriever"]
        hybrid_ranked = {}
        for q in everything.values():
            found = retriever.search(
                q.text, mode=RetrievalMode.TUTORING, module_id=MODULE, k=K_MAX, method="hybrid"
            )
            hybrid_ranked[q.chunk_id] = [(p.chunk_id, p.concept_id, 0.0) for p in found]
        arms[f"hybrid: {dense.split(' (')[0]} + BM25"] = {
            "ranked": hybrid_ranked,
            "truncated": arms[dense]["truncated"],
            "pool": len(pool),
        }
    print("  done: BM25 keyword baseline and two hybrids (production retriever)\n")

    rng = np.random.default_rng(SEED)
    base_label = next(iter(arms))
    out: list[str] = []
    emit = out.append

    def score(qs: list[Query], relevance: str) -> dict[str, dict[str, np.ndarray]]:
        result: dict[str, dict[str, list[float]]] = {}
        for label, arm in arms.items():
            columns: dict[str, list[float]] = defaultdict(list)
            for q in qs:
                concepts = [c for _, c, _ in arm["ranked"][q.chunk_id]]
                relevant = {q.concept_id}
                if relevance == "relaxed":
                    relevant |= prereqs.get(q.concept_id, set())
                for metric, value in per_query_metrics(relevance_flags(concepts, relevant)).items():
                    columns[metric].append(value)
            result[label] = {m: np.array(v) for m, v in columns.items()}
        return result

    emit(f"# Retrieval quality, {MODULE} module\n")
    prov = provenance(units, chunks, pool, {name: len(qs) for name, qs in query_sets.items()})
    emit("Provenance: " + ", ".join(f"{k}={v}" for k, v in prov.items()) + "\n")

    # ---- every query set, strict and relaxed
    primary_name = next(iter(query_sets))
    strict_by_set: dict[str, dict] = {}
    for set_name, qs in query_sets.items():
        for relevance, blurb in (
            ("strict", "relevant = a chunk from the question's own concept"),
            ("relaxed", "relevant = its concept or one of its direct prerequisites"),
        ):
            sc = score(qs, relevance)
            if relevance == "strict":
                strict_by_set[set_name] = sc
            emit(f"## {set_name}: {relevance}\n")
            emit(f"{blurb}. Mean with 95% bootstrap interval.\n")
            emit("| Arm | Hit@1 | Hit@3 | Hit@5 | Hit@10 | P@5 | MRR@10 |")
            emit("|---|---|---|---|---|---|---|")
            for label in arms:
                cells = [
                    fmt(bootstrap_mean(sc[label][m], rng))
                    for m in ("hit@1", "hit@3", "hit@5", "hit@10", "p@5", "mrr")
                ]
                emit(f"| {label} | " + " | ".join(cells) + " |")
            emit("")

        sc = strict_by_set[set_name]
        emit(
            f"### Paired differences vs {base_label.split(' (')[0]} ({set_name.split(' (')[0]}, strict)\n"
        )
        emit(
            "Positive = the arm beats bge-small. An interval that excludes 0 is unlikely to be noise.\n"
        )
        emit("| Arm | Hit@5 | P@5 | MRR@10 |")
        emit("|---|---|---|---|")
        for label in list(arms)[1:]:
            cells = [
                fmt(paired_difference(sc[label][m], sc[base_label][m], rng))
                for m in ("hit@5", "p@5", "mrr")
            ]
            emit(f"| {label} | " + " | ".join(cells) + " |")
        emit("")

    # ---- truncation
    emit("## Chunks the model cannot read in full\n")
    emit("| Arm | Tutoring-pool chunks over the window |")
    emit("|---|---|")
    for label, arm in arms.items():
        emit(f"| {label} | {arm['truncated']} of {arm['pool']} |")
    emit("")

    # ---- by question level on the primary set
    qs = query_sets[primary_name]
    sc = strict_by_set[primary_name]
    levels = sorted({q.level for q in qs})
    emit(f"## By question level ({primary_name.split(' (')[0]}, strict Hit@5)\n")
    emit(
        "| Arm | "
        + " | ".join(f"L{lv} (n={sum(q.level == lv for q in qs)})" for lv in levels)
        + " |"
    )
    emit("|---|" + "---|" * len(levels))
    for label in arms:
        cells = [f"{sc[label]['hit@5'][[q.level == lv for q in qs]].mean():.2f}" for lv in levels]
        emit(f"| {label} | " + " | ".join(cells) + " |")
    emit("")

    # ---- by concept, bge arm
    emit(f"## By concept: {base_label} ({primary_name.split(' (')[0]}, strict)\n")
    emit("| Concept | Queries | Hit@5 | P@5 |")
    emit("|---|---|---|---|")
    for concept in sorted({q.concept_id for q in qs}):
        mask = np.array([q.concept_id == concept for q in qs])
        s = sc[base_label]
        emit(
            f"| {concept} | {mask.sum()} | {s['hit@5'][mask].mean():.2f} | {s['p@5'][mask].mean():.2f} |"
        )
    emit("")

    # ---- misses
    misses = [q for q, h in zip(qs, sc[base_label]["hit@5"], strict=True) if h == 0]
    emit(f"## Strict misses at k=5, {base_label}: {len(misses)} of {len(qs)}\n")
    for q in misses[:10]:
        got = ", ".join(
            c.split("#")[0].split(".")[1] for c, _, _ in arms[base_label]["ranked"][q.chunk_id][:5]
        )
        emit(f"- `{q.chunk_id}` (L{q.level}) wanted `{q.concept_id}`, got: {got}")
    emit("")

    # ---- distance to the nearest passage, for choosing a cut-off
    emit("## Distance to the nearest passage: in scope vs not covered by the course\n")
    emit(
        "Lower is closer. A cut-off that keeps 95% of real questions rejects this share of "
        "questions the course does not answer.\n"
    )
    emit(
        "| Arm | In-scope median | Cut-off (95% kept) | Unrelated: median, rejected | "
        "Java-not-covered: median, rejected |"
    )
    emit("|---|---|---|---|---|")
    for label, arm in arms.items():
        if "top1_in_scope" not in arm:
            continue
        cut = float(np.percentile(arm["top1_in_scope"], 95))
        un, jv = arm["top1_oos"]["unrelated"], arm["top1_oos"]["java_not_covered"]
        emit(
            f"| {label} | {np.median(arm['top1_in_scope']):.3f} | {cut:.3f} | "
            f"{np.median(un):.3f}, {sum(d > cut for d in un)}/{len(un)} | "
            f"{np.median(jv):.3f}, {sum(d > cut for d in jv)}/{len(jv)} |"
        )
    emit("")

    report = "\n".join(out)
    print(report)

    if not args.no_save:
        RESULTS.mkdir(parents=True, exist_ok=True)
        stamp = date.today().isoformat()
        (RESULTS / f"retrieval-eval-{stamp}.md").write_text(report, encoding="utf-8")
        raw = {
            "provenance": prov,
            "queries": {qid: q.__dict__ for qid, q in everything.items()},
            "rankings": {
                label: {qid: [list(r) for r in rows] for qid, rows in arm["ranked"].items()}
                for label, arm in arms.items()
            },
        }
        (RESULTS / f"retrieval-eval-{stamp}.json").write_text(json.dumps(raw), encoding="utf-8")
        print(f"\nsaved to {RESULTS.relative_to(REPO)}/retrieval-eval-{stamp}.(md|json)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
