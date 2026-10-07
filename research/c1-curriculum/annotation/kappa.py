"""Step 6 of the graph construction: agreement between the two lecturers.

Reads reviewer_a.csv and reviewer_b.csv (each a copy of edge_review_form.csv with
answer_yes_no filled in) and review_key.csv, then reports:

  - Cohen's kappa between the reviewers (Objective 1 target: >= 0.70)
  - raw percentage agreement
  - every pair they disagree on, for discussion
  - how each reviewer's answers compare with the proposed graph

    python kappa.py
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = 0.70


def answers(name: str) -> dict[str, bool]:
    result: dict[str, bool] = {}
    with (HERE / name).open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            value = row["answer_yes_no"].strip().lower()
            if value not in {"yes", "no", "y", "n"}:
                sys.exit(f"{name} {row['pair_id']}: answer must be yes or no, got {value!r}")
            result[row["pair_id"]] = value.startswith("y")
    return result


def cohen_kappa(a: list[bool], b: list[bool]) -> tuple[float, float]:
    n = len(a)
    observed = sum(x == y for x, y in zip(a, b, strict=True)) / n
    p_a, p_b = sum(a) / n, sum(b) / n
    expected = p_a * p_b + (1 - p_a) * (1 - p_b)
    kappa = 1.0 if expected == 1 else (observed - expected) / (1 - expected)
    return kappa, observed


def main() -> int:
    a, b = answers("reviewer_a.csv"), answers("reviewer_b.csv")
    if a.keys() != b.keys():
        sys.exit("The two reviewer files do not cover the same pairs.")
    with (HERE / "review_key.csv").open(encoding="utf-8") as handle:
        key = {r["pair_id"]: r for r in csv.DictReader(handle)}

    ids = sorted(a)
    kappa, observed = cohen_kappa([a[i] for i in ids], [b[i] for i in ids])
    verdict = "meets" if kappa >= TARGET else "is below"
    print(f"Pairs rated: {len(ids)}")
    print(f"Cohen's kappa: {kappa:.3f} ({verdict} the {TARGET} target)")
    print(f"Raw agreement: {observed:.1%}")

    disagreements = [i for i in ids if a[i] != b[i]]
    print(f"\nDisagreements to resolve: {len(disagreements)}")
    for i in disagreements:
        k = key[i]
        print(f"  {i} [{k['kind']}] {k['a_id']} -> {k['b_id']}: A={a[i]}, B={b[i]}")

    for name, ratings in (("Reviewer A", a), ("Reviewer B", b)):
        edges = [i for i in ids if key[i]["kind"] == "edge"]
        others = [i for i in ids if key[i]["kind"] != "edge"]
        confirmed = sum(ratings[i] for i in edges)
        rejected = sum(not ratings[i] for i in others)
        print(
            f"\n{name}: confirmed {confirmed}/{len(edges)} proposed edges, "
            f"rejected {rejected}/{len(others)} reversed or unrelated pairs"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
