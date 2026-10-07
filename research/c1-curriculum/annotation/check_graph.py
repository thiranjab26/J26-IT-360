"""Step 3 of the graph construction: structural checks on candidate_edges.csv.

Runs on the CSVs only (no database, no extra libraries):

  - cycles: A before B before A cannot be followed by any learner
  - redundant edges: A -> C is redundant when A -> B -> C already exists, because
    the shortcut adds no ordering information and inflates attention weights
  - isolated concepts: no prerequisite and nothing depends on them
  - unknown ids: every edge endpoint must be in concept_inventory.csv
  - depth per module: the longest prerequisite chain

    python check_graph.py
"""

from __future__ import annotations

import csv
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load() -> tuple[dict[str, dict], list[tuple[str, str, str]]]:
    with (HERE / "concept_inventory.csv").open(encoding="utf-8") as handle:
        concepts = {row["concept_id"]: row for row in csv.DictReader(handle)}
    with (HERE / "candidate_edges.csv").open(encoding="utf-8") as handle:
        edges = [(r["edge_id"], r["prerequisite_id"], r["concept_id"]) for r in csv.DictReader(handle)]
    return concepts, edges


def reachable(start: str, succ: dict[str, set[str]], skip: tuple[str, str] | None = None) -> set[str]:
    seen: set[str] = set()
    stack = [start]
    while stack:
        node = stack.pop()
        for nxt in succ[node]:
            if skip == (node, nxt) or nxt in seen:
                continue
            seen.add(nxt)
            stack.append(nxt)
    return seen


def main() -> int:
    concepts, edges = load()
    problems = 0

    unknown = sorted({c for _, p, c in edges for c in (p, c) if c not in concepts})
    if unknown:
        problems += 1
        print("UNKNOWN concept ids in edges:", ", ".join(unknown))

    succ: dict[str, set[str]] = defaultdict(set)
    pred: dict[str, set[str]] = defaultdict(set)
    for _, p, c in edges:
        succ[p].add(c)
        pred[c].add(p)

    cyclic = sorted(cid for cid in concepts if cid in reachable(cid, succ))
    if cyclic:
        problems += 1
        print("CYCLE through:", ", ".join(cyclic))
        return 1

    redundant = [
        (eid, p, c) for eid, p, c in edges if c in reachable(p, succ, skip=(p, c))
    ]
    isolated = sorted(cid for cid in concepts if not succ[cid] and not pred[cid])

    depth: dict[str, int] = {}

    def depth_of(cid: str) -> int:
        if cid not in depth:
            depth[cid] = 1 + max((depth_of(p) for p in pred[cid]), default=-1)
        return depth[cid]

    print(f"{len(concepts)} concepts, {len(edges)} edges, no cycles")
    by_module: dict[str, list[str]] = defaultdict(list)
    for cid, row in concepts.items():
        by_module[row["module"]].append(cid)
    for module, ids in by_module.items():
        deepest = max(ids, key=depth_of)
        print(f"  {module}: {len(ids)} concepts, longest chain {depth_of(deepest)} (ends at {deepest})")

    print(f"\nRedundant edges (implied by a longer path): {len(redundant)}")
    for eid, p, c in redundant:
        print(f"  {eid}: {p} -> {c}")
    print(f"\nIsolated concepts: {len(isolated)}")
    for cid in isolated:
        print(f"  {cid}")

    print("\nRedundant edges are not errors: keep one only if the justification says")
    print("the direct dependency matters on its own; otherwise remove it before review.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
