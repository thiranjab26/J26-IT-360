"""Step 4 of the graph construction: the blind review form for the two lecturers.

If reviewers only rated our own edges, almost every answer would be "yes" and
Cohen's kappa would be unstable (kappa needs both answers to occur). So the form
mixes three kinds of pair, shuffled, with nothing telling them apart:

  edge      a candidate edge                         (expected yes)
  reversed  a candidate edge turned around           (expected no)
  non_edge  two concepts with no ordering either way  (expected no)

Pairs where one concept is an indirect prerequisite of the other are never used
as non_edge items, because "yes" would be a reasonable answer to them.

Writes edge_review_form.csv (send this) and review_key.csv (keep this).

    python make_review_form.py --reversed 15 --non-edges 15
"""

from __future__ import annotations

import argparse
import csv
import random
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
QUESTION = "Must a student understand A before they can learn B?"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reversed", type=int, default=15)
    parser.add_argument("--non-edges", type=int, default=15)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    rng = random.Random(args.seed)

    with (HERE / "concept_inventory.csv").open(encoding="utf-8") as handle:
        concepts = {r["concept_id"]: r for r in csv.DictReader(handle)}
    with (HERE / "candidate_edges.csv").open(encoding="utf-8") as handle:
        edges = [(r["prerequisite_id"], r["concept_id"]) for r in csv.DictReader(handle)]

    succ: dict[str, set[str]] = defaultdict(set)
    for p, c in edges:
        succ[p].add(c)

    def descendants(node: str) -> set[str]:
        seen, stack = set(), [node]
        while stack:
            for nxt in succ[stack.pop()]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return seen

    below = {cid: descendants(cid) for cid in concepts}
    related = {(a, b) for a in concepts for b in below[a]} | {(b, a) for a in concepts for b in below[a]}

    items = [("edge", p, c) for p, c in edges]
    items += [("reversed", c, p) for p, c in rng.sample(edges, min(args.reversed, len(edges)))]

    # Plausible distractors: unrelated concepts, preferably from the same module.
    candidates = [
        (a, b)
        for a in concepts
        for b in concepts
        if a != b and (a, b) not in related
    ]
    candidates.sort(key=lambda ab: (concepts[ab[0]]["module"] != concepts[ab[1]]["module"], ab))
    same_module = [ab for ab in candidates if concepts[ab[0]]["module"] == concepts[ab[1]]["module"]]
    pool = same_module if len(same_module) >= args.non_edges else candidates
    items += [("non_edge", a, b) for a, b in rng.sample(pool, args.non_edges)]

    rng.shuffle(items)
    form, key = [], []
    for i, (kind, a, b) in enumerate(items, start=1):
        pair_id = f"P{i:03d}"
        form.append(
            {
                "pair_id": pair_id,
                "concept_a": concepts[a]["name"],
                "concept_b": concepts[b]["name"],
                "question": QUESTION,
                "answer_yes_no": "",
                "comment": "",
            }
        )
        key.append({"pair_id": pair_id, "kind": kind, "a_id": a, "b_id": b})

    for name, rows in (("edge_review_form.csv", form), ("review_key.csv", key)):
        with (HERE / name).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    counts = {k: sum(1 for kind, *_ in items if kind == k) for k in ("edge", "reversed", "non_edge")}
    print(f"wrote edge_review_form.csv ({len(form)} pairs: {counts}) and review_key.csv")


if __name__ == "__main__":
    main()
