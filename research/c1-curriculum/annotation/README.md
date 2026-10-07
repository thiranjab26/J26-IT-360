# PF + DSA prerequisite graph construction (Objective 1)

The method behind the claim "the directed prerequisite graph for Programming
Fundamentals (Java) and Data Structures and Algorithms was validated by two
subject lecturers with Cohen's kappa of at least 0.70".

## Workflow

| Step | Command / action | Output |
|---|---|---|
| 1. Inventory | `uv run --with sqlalchemy --with "psycopg[binary]" python export_graph.py --env ../../../backend/services/curriculum-service/.env` (read-only) | `concept_inventory.csv` |
| 2. Edges | same command | `candidate_edges.csv` |
| 1b. Trace to syllabus | Fill `syllabus_week`, `source_document`, `learning_outcome` for every concept from the official PF and DSA module outlines; list missing concepts in `notes` | edited inventory |
| 2b. Justify | Fill `strength` (essential / helpful) and one-sentence `justification` for every edge | edited edges |
| 3. Check | `python check_graph.py` | cycles, redundant edges, isolated concepts, depth |
| 4. Form | `python make_review_form.py` (rerun after any edge change) | `edge_review_form.csv` (send), `review_key.csv` (keep) |
| 5. Review | Each lecturer fills `answer_yes_no` independently; save as `reviewer_a.csv` and `reviewer_b.csv` | reviewer files |
| 6. Agreement | `python kappa.py` | kappa, disagreements, per-reviewer confirmation rates |
| 7. Resolve | Discuss each disagreement; record the outcome and date in `resolution.md` | final edge list |
| 8. Publish | Edge changes go to the team as a seed PR; then `python -m scripts.import_graph --version v1` in curriculum-service | graph v1 in Neo4j |

`export_graph.py` never overwrites existing CSVs (your annotations would be
lost) unless you pass `--force`.

## Why the review form contains pairs that are not edges

Kappa measures agreement beyond chance, so both answers must occur. A form of
only our own edges would be answered "yes" almost everywhere and kappa would be
unstable. The form therefore mixes the candidate edges with reversed edges and
unrelated pairs, shuffled, so reviewers cannot tell which is which. Pairs where
one concept is an indirect prerequisite of the other are never used as
distractors, because "yes" would be a fair answer to them.

## Current state (7 Oct 2026)

- 25 concepts (13 PF, 12 DSA), 39 edges (9 cross-module), no cycles, no isolated concepts.
- Longest chains: PF 7 (ends at Tracing Program Execution), DSA 13 (ends at Binary search trees, running through PF).
- 4 redundant edges to decide on before review: E08, E17, E29, E31.
- The review form in this folder is a **draft**: regenerate it after the justifications and the redundant-edge decisions.

## Privacy

Reviewer files hold only the pair answers and an A/B label: no names. These CSVs
are small and are committed, as the evidence behind the kappa result.
