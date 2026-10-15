# C3 VeriTutor research

Experiments for component 3. Nothing here is imported by a running service.

## Retrieval quality (`experiments/retrieval_eval.py`)

Which retrieval setup surfaces the right course material, and does an embedding model beat plain keyword matching at all?

```bash
# from the repository root, after `uv run python -m app.content.cli index` has been run once
uv run --project backend/services/tutor-service \
    python "research/c3-RAG tutor/experiments/retrieval_eval.py"
```

It takes about a minute. Output goes to `results/retrieval-eval-<date>.md` (the tables) and `.json` (every ranking, so any number can be recomputed). `results/` is gitignored, so copy the numbers you report into the write-up along with the provenance line at the top of the file (date, git commit, content hash).

**Design.** Each query is scored against the real `Retriever` in tutoring mode, so the access rules are part of what is tested. Truth is the concept a question belongs to. A result is *relevant* if it is from that concept (strict), or from it or a direct prerequisite (relaxed). Metrics are Hit@k (did the right concept appear in the top k), Precision@k and MRR@10, with 95% bootstrap intervals over queries and paired bootstrap differences between arms. The bootstrap is seeded, so reruns give identical numbers.

**Arms.** bge-small-en-v1.5; bge-small without its query instruction; all-MiniLM-L6-v2 as shipped (256-token window); MiniLM with its window forced to 512; BM25 as a keyword baseline; and two hybrids that fuse an embedding ranking with BM25 by reciprocal rank. The hybrid arms call the production `Retriever` (`method="hybrid"`) and the baseline uses the production BM25 class, so what is measured is the code the service runs.

**Query sets.**
1. The 143 practice questions as written. Held out by construction: in tutoring mode the exercises are not in the searchable pool.
2. The same questions with code removed (those left with at least 12 words of prose).
3. `experiments/student_queries.yaml`: 39 natural questions written by hand (3 per concept), without looking at the course text, so the wording is not copied from it. Typos are kept, since students make them. This is the closest thing to real student phrasing and the set that matters most; it is also the smallest, so its intervals are wide.

### Results (2026-10-10, Programming module, tutoring-mode pool of 220 chunks)

Strict MRR@10 / Hit@5 (did the right concept appear in the top 5), means over queries:

| Arm | Practice questions as written (n=143) | Code removed (n=117) | Student-style (n=39) |
|---|---|---|---|
| bge-small | 0.626 / 0.755 | 0.716 / 0.846 | **0.918** / 0.974 |
| MiniLM | 0.684 / 0.832 | 0.778 / 0.897 | 0.853 / 0.974 |
| BM25 keyword | 0.717 / **0.888** | 0.737 / 0.889 | 0.603 / 0.795 |
| **Hybrid: MiniLM + BM25** | **0.761** / 0.853 | **0.813** / **0.906** | 0.861 / 0.974 |
| Hybrid: bge-small + BM25 | 0.705 / 0.818 | 0.769 / 0.872 | 0.881 / **1.000** |

What the paired bootstrap supports (95% intervals, `*` marks an interval that excludes 0; the generated report has the full tables):

- **No single method wins everywhere.** Keyword search has the best Hit@5 on the practice questions (0.888) and collapses on natural phrasing (Hit@5 0.795, MRR -0.315 against bge-small [-0.445, -0.187] *). Of the embedding models, MiniLM is significantly better than bge-small on the practice questions (Hit@5 +0.077 [0.028, 0.133] *), while bge-small is nominally ahead on natural phrasing without the difference being distinguishable from noise at n=39.
- **The hybrid is the most robust.** Hybrid MiniLM + BM25 is not significantly worse than the best single method on any of the three sets. Against MiniLM alone it ranks the right concept first more often on practice questions (Hit@1 +0.098 [0.028, 0.175] *, MRR +0.077 [0.030, 0.128] *) and ties on natural phrasing (MRR +0.008 [-0.078, 0.096]). Against keyword search alone it is clearly better on natural phrasing (MRR +0.258 [0.129, 0.385] *) and on the code-removed questions (Hit@1 +0.111 [0.034, 0.197] *), and statistically tied on practice questions.
- **bge-small versus MiniLM is not settled on natural phrasing.** bge-small leads on Hit@1 (0.87 against 0.77) but the interval includes zero [-0.23, 0.03], and several "wrong" answers are ambiguous labels (infinite loops inside nested loops fits both `loops` and `nested_loops`).
- **Truncation did not matter.** MiniLM cuts off 63 of the 220 pool chunks, yet forcing its window to 512 changed nothing.
- **The query instruction helps bge-small**: without it, strict Hit@5 on practice questions fell from 0.755 to 0.720.

Decision taken: the service uses **all-MiniLM-L6-v2 with hybrid retrieval** as the default. `TUTOR_EMBEDDING_MODEL` is one line if more student-style data later shows bge-small ahead on natural phrasing, and hybrid works with either.

**A caution about reruns.** An earlier version of this script gave the code-removed questions the same IDs as the originals, so the two sets overwrote each other's rankings and some arms were scored on the wrong text. It is fixed (IDs are distinct and the script asserts it), but any figure produced before 2026-10-10 evening for the keyword baseline, the hybrids or the code-removed set should be discarded in favour of the table above.

**Limits to state with the numbers.** Truth is concept level, not chunk level. Practice questions are a proxy for student queries, and some are pasted programs whose concept cannot be recovered from their text. The same author wrote the questions and the theory, so shared vocabulary may favour keyword matching. One module, one author, a few hundred queries at most: report intervals, not just means.

## NLI feasibility spike (`experiments/nli_spike.py`)

A probe run before building the faithfulness gate, on the machine it will run on (14 CPU threads, no GPU). It asks whether checking a claim is fast enough to be interactive and whether an off-the-shelf model gives sensible verdicts on course claims. **It is a probe, not the evaluation**: 10 claims that I labelled by hand against passages from one concept, so it can rule options out and point a direction but supports no reported accuracy. The real comparison runs on the labelled evaluation set (phase P6).

**Speed is not the problem.** A DeBERTa-v3 base model checks one claim against a ~140-token passage in about 200 ms, a ~350-token premise in about 360 ms and a ~650-token premise in about 550 ms (cost grows roughly linearly with premise length, which is what premise windowing is for). A batch of 8 claims, a typical tutor answer, takes about 1.1 s, or 140 ms per claim. The small model is about twice as fast.

**The decision rule is the problem.** Taking the model's top label ("argmax") treats a supported paraphrase as unsupported far too often: given "if the condition is false at the start, the body runs zero times", the cross-encoder model calls "a while loop can run zero times" neutral with probability 0.98. In a gate that blocks unsupported claims that means rejecting correct explanations, the over-blocking that the methodology says precision must guard against.

| Model (all base size) | Correct 3-way labels | Supported-or-not at argmax | Best threshold on P(entailment) | P(entailment) of the 4 supported claims |
|---|---|---|---|---|
| cross-encoder/nli-deberta-v3-base | 6/10 | 7/10 | 10/10, but only at 0.01 | 0.01, 0.07, 0.02, 1.00 |
| MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli | 7/10 | 8/10 | 10/10 at 0.21 | 0.39, 0.92, 0.22, 0.99 |
| cross-encoder/nli-deberta-v3-small | 4/10 | not computed | not computed | not computed |

What this points to, to be checked on the real evaluation set:

- Use the **probability of entailment against a calibrated threshold**, not the top label. The threshold is a result to report, chosen on labelled data.
- The model trained on fact verification (MNLI, FEVER and ANLI) separates supported from unsupported claims with usable margins (supported 0.22 to 0.99, unsupported at most 0.14). The plain MNLI cross-encoder gives supported claims probabilities of 0.01 to 0.07, which no threshold can use reliably.
- **Force float32.** The fact-verification checkpoint loads as float16, which on a CPU made it nine times slower (1.65 s per claim) until converted. The verifier wrapper must convert explicitly.
- HHEM was not tested here: it needs custom model code that may not work with the installed `transformers` version. It stays in the P3 comparison as planned.

> **Update (P3, 2026-10-13).** The probe above was later tested on 1,003 labelled claims (next section). Two of its pointers did not hold: the 0.21 threshold blocked only 82% of unsupported claims (not the clean separation 10 claims suggested), and the top-label rule performed about the same as a tuned threshold, so it was not shown to over-block. The model choice and the float32 finding stand.

## Faithfulness gate (P3, `experiments/gate_eval.py`)

Everything the tutor generates is checked against the course passage it was written from before a student sees it. The gate (service code in `app/verification/`) splits a response into claims, asks an NLI model whether the passage supports each, and blocks the response if any claim falls below a threshold on P(entailment). Code in a response is not language, so each code line must instead appear in the passage's own code. A blocked text is regenerated once, told which statements failed; if that is blocked too, the student sees the authored passage. Every verdict, passed or blocked, is logged to `tutor.gate_events`.

### How it was measured

`gate_eval.py` has three stages, all importing the production gate code.

1. **build.** For each of 69 theory passages a language model wrote statements the passage supports, statements it contradicts, and statements it neither states nor implies. An independent second call judged every statement against the passage and only items where the judge agreed with the construction were kept: **1,003 claims (428 supported, 280 contradiction, 295 addition)**. Three passages produced unusable output and were skipped.
2. **calibrate.** The threshold is chosen on the claims of 7 concepts (dev) and reported on the other 6 (test). The split is by concept so near-duplicate statements about one passage cannot sit on both sides.
3. **audit.** 40 real tutor explanations (one per passage, random order) were run through the gate at several thresholds.

### Results

| | Whole passage as premise | Plus short stretches of it ("windows") |
|---|---|---|
| AUROC, supported vs unsupported (test) | 0.948 | **0.961** |
| AUROC, supported vs contradictions only (test) | 0.931 | 0.939 |
| Threshold: lowest that blocks at least 90% of unsupported claims on dev | 0.67 | **0.77** |
| Supported claims passed (test) | 80.5% | **87.7%** |
| Unsupported claims blocked (test) | 93.9% | 91.3% |
| Contradictions / additions blocked (test) | 90.0% / 97.7% | 85.4% / 97.0% |

- **Model.** The fact-verification model (MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli) is clearly better than the plain NLI cross-encoder (AUROC 0.86, and no threshold gave it a usable pass rate).
- **Windows.** Judging a claim against each paragraph as well as the whole passage lifts the share of supported claims passed by about 7 to 10 points at a matched block rate (checked two ways: the full set above, and a fixed 300-claim subset run both ways). A whole passage that covers several topics makes a model call a true claim about one of them a contradiction, for example "Text written between double quotes is a string literal" scored 0.13 against the whole passage and 1.00 against its paragraph. Windows make each check about eight times slower (about 20 s for a 10-claim response on this CPU).
- **The cost of strictness.** One unsupported claim blocks the whole response, so a per-claim false-block rate compounds. On real tutor explanations (mean 10.5 claims) the first-try pass rate at threshold 0.77 was **40%** with windows (32% with sentence splitting, 18% to 28% without windows). A response-level rule that tolerates one low claim would let a single injected error through, so it was not adopted. The practical answer is to generate explanations offline with up to four attempts (each told what failed) and serve the verified text from a shared cache: `uv run python -m app.verification.cli prebuild`.
- **Claim-level against whole-response checking.** At the same threshold, judging the whole response as one hypothesis passed **95%** of real explanations, against 40% for claim-level checking. It cannot say which statement is wrong, and the injected-error test above is exactly where it is weak. This is the ablation the project's third claim needs; the per-claim comparison on injected errors is still to be run on person-labelled data.
- **What the gate catches in practice.** The model repeatedly adds general-knowledge claims that are not in the passage (for example "writing raw machine instructions would be very difficult for humans" for a passage that never says it), re-adding them even after being told they were unsupported. The gate blocks these, which is the behaviour the design intends, and those passages stay uncached and show the course text.
- **Contradictions are the weak spot.** About 15% of constructed contradictions still pass at 0.77. No combination of the entailment and contradiction probabilities improved on the single entailment threshold (tested: entailment with a contradiction ceiling, their difference, and their ratio).

### Limits (read before quoting any number)

- **The labels are not human labels.** They come from construction plus a language-model judge. The judge agreed with the construction on 99.5% of items, which says the set is easy and the judge shares the generator's blind spots; it does not say the labels are correct. Treat the figures as calibration, not as the gate's accuracy.
- **Recall is optimistic.** The false statements were written by a language model that was asked to write plausible false statements, which is easier to catch than the subtle errors a tutor model makes unprompted.
- **The audit's flagged claims have not been checked by a person.** Many look like false alarms on true statements, but that is my reading, not a result. `audit` wrote `results/gate-human-labels-*.csv` (60 claims, shuffled so the gate decision is not visible to the labeller, with a blank `human_label` column). Labelling it is what turns these numbers into a reportable precision and recall.
- **One module, one language, one model family.** The threshold is for this course's style of text and this tutor prompt. Changing the prompt, the model or the passage text changes what was measured; the cache key includes all three for that reason.
- **HHEM was not compared** (it needs custom model code). The model comparison here is two NLI cross-encoders.

### First human-checked result (2026-10-15)

One person (the project owner) labelled 60 claims taken from 30 real tutor explanations, blind to the gate's decision (a page showed only the claim and its passage; the gate's verdicts were kept in a separate key). Half the sample was claims the gate flagged at 0.77 and half it passed. Labels: supported, contradicted, not supported, unsure; 3 unsure were left out. The files are in `labels/`; this command reproduces the numbers: `uv run --project backend/services/tutor-service python "research/c3-RAG tutor/experiments/label_tool.py" score "research/c3-RAG tutor/labels/gate-human-labels-2026-10-15.csv" --key "research/c3-RAG tutor/labels/gate-human-labels-2026-10-15.key.json"`.

| | Truly unsupported | Supported |
|---|---|---|
| Gate flagged (27 used) | 4 | 23 |
| Gate passed (30) | 1 | 29 |

* Real tutor text is mostly faithful: 5 of 57 claims (9%) were unsupported.
* Of the claims the gate flagged, **15%** were truly unsupported (95% range 6% to 32%). The other 85% were false alarms.
* Of the claims it passed, **97%** were truly supported (95% range 83% to 99%).
* Scaled to all 419 claims in the audit, the gate wrongly flagged about **12%** of the supported ones. That matches the calibration (88% of supported claims accepted), so the calibration of the false-alarm rate holds on real text.
* The low share of flags that were right is explained by the base rate, not by a broken checker. When 91% of claims are good, even a 12% false-flag rate means most flags are false alarms. The calibration set was about 40% unsupported, which hides this.
* **Recall cannot be measured from this sample.** It holds only 5 unsupported claims, so the rough scaled estimate (42%) rests on one missed claim and must not be quoted. Measuring recall needs more unsupported claims, which is what the induced-hallucination conditions in the methodology (degraded retrieval) are for.
* The unsupported claims were of two kinds: invented colour (a dictionary analogy, "one of the best parts of passing arrays", "variables are like storage boxes") and plausible-sounding additions. The one that got through scored 0.96.

Limits: one annotator and no repeat labelling yet, so no agreement figure; 30 claims per group, so wide ranges; the claims came from explanations written before retrieval support was added (single passage), and were scored with all windows rather than the four-best shortcut used now; the sample is half flagged by design, so threshold sweeps within it overstate false alarms and are not a basis for changing the threshold.
