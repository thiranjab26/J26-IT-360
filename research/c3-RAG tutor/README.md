# C3 VeriTutor research

Experiments for component 3. Nothing here is imported by a running service.

## Retrieval quality (`experiments/retrieval_eval.py`)

Which retrieval setup surfaces the right course material, and does an embedding model beat plain keyword matching at all?

```bash
# from the repository root, after `uv run python -m app.content.cli index` has been run once
uv run --project backend/services/tutor-service \
    python research/c3-veritutor/experiments/retrieval_eval.py
```

It takes about a minute. Output goes to `results/retrieval-eval-<date>.md` (the tables) and `.json` (every ranking, so any number can be recomputed). `results/` is gitignored, so copy the numbers you report into the write-up along with the provenance line at the top of the file (date, git commit, content hash).

**Design.** Each query is scored against the real `Retriever` in tutoring mode, so the access rules are part of what is tested. Truth is the concept a question belongs to. A result is *relevant* if it is from that concept (strict), or from it or a direct prerequisite (relaxed). Metrics are Hit@k (did the right concept appear in the top k), Precision@k and MRR@10, with 95% bootstrap intervals over queries and paired bootstrap differences between arms. The bootstrap is seeded, so reruns give identical numbers.

**Arms.** bge-small-en-v1.5; bge-small without its query instruction; all-MiniLM-L6-v2 as shipped (256-token window); MiniLM with its window forced to 512; BM25 as a keyword baseline.

**Query sets.**
1. The 143 practice questions as written. Held out by construction: in tutoring mode the exercises are not in the searchable pool.
2. The same questions with code removed (those left with at least 12 words of prose).
3. Optional `experiments/student_queries.yaml`: natural questions written by hand, the closest thing to real student phrasing. Write about 3 per concept, in your own words and without looking at the course text, so the wording is not copied from it. Re-run and it is scored as a third set.

**Limits to state with the numbers.** Truth is concept level, not chunk level. Practice questions are a proxy for student queries, and some are pasted programs whose concept cannot be recovered from their text. The same author wrote the questions and the theory, so shared vocabulary may favour keyword matching. One module, one author, a few hundred queries at most: report intervals, not just means.
