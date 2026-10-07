# C4 spec 1 of 3: research logic (domain)

This file defines the behaviour that makes C4 a research artefact. Recreate it exactly.
Everything here lives in `backend/services/viva-service/app/domain/` with no FastAPI imports,
and every rule is covered by a unit test in `tests/unit/`.

Source of truth for the current behaviour: the standalone demo at
`Desktop/Research Project/Astra Prototype/Astra version 2/adaptlearn-c4`
(`backend/services/viva-service/app/logic.py`, `providers.py`, `disfluency.py`, `research.py`, `seed.py`).

Versions to record on every session: policy `c04-policy-1.3-skip-stop`, gap rules `c04-gap-1.3-verbal-signal`.

## 1. Research purpose

A weak viva answer can mean the student does not know the material (knowledge gap) or knows it
but struggles to express it (communication difficulty). C4 combines:

1. rubric-based answer assessment,
2. a deterministic follow-up policy (the AI never chooses the assessment path),
3. supplementary hesitation evidence (never decisive on its own),

and gives each concept one of three outcomes:

| Constant | Meaning |
|---|---|
| `LIKELY_KNOWLEDGE_GAP` | Key ideas still missing after follow-ups, or a misconception persists |
| `LIKELY_COMMUNICATION_DIFFICULTY` | Knowledge is shown, but expressing it was difficult |
| `MIXED_INSUFFICIENT_EVIDENCE` | Unclear or conflicting evidence, or no weakness to explain |

Hesitation, accent and voice quality are never used as correctness evidence.

## 2. Question bank item

| Field | Type | Notes |
|---|---|---|
| `id` | text | |
| `concept_id` | text | Must exist in `database/seed/` (for example `dsa.stack`). Never invent one |
| `concept` | text | Display name |
| `question` | text | Main question |
| `reference_answer` | text | |
| `rubric_points` | list | Each: `id`, `point`, `keywords` (1 to 30), `probe` (non-leading question for that point), `source_indices`, `evidence_quote` |
| `misconceptions` | list | Each: `id`, `description`, `keywords` |
| `follow_ups` | object | Stored fallback wording for `partial`, `superficial`, `incorrect`, `misconception_bearing`, `non_answer` |
| `sources` | list | Each: `source`, `page`, `chunk_id`, `text` (exact excerpt) |
| `status` | enum | `draft`, `approved`, `rejected`. Only approved items are used in sessions |
| `origin`, `review_notes`, `version` | | Audit fields. Any edit sets status back to `draft` |

Seed content to recreate (demo `seed.py`), keyed to existing seed concept IDs:

- `dsa.stack`: "LIFO" (rubric: LIFO order; example A then B gives B first; misconception "removes the oldest item first") and "Push and pop" (push adds to top; pop removes top; empty pop causes underflow; misconception "pop removes the bottom").
- `dsa.queue`: "FIFO" (FIFO order; example A before B leaves first; misconception "removes the most recent first") and "Enqueue and dequeue" (enqueue at rear; dequeue at front; arrival order supports scheduling; misconception "dequeue removes from the rear").
- The demo's OOP (encapsulation, inheritance) and databases (keys, normalization) items need new concept IDs in `database/seed/` first. That is a seed PR, so leave them out until it is approved.

Every rubric point has a hand-written probe. Examples: "What rule determines which item a stack removes next?",
"Suppose you push A and then B onto an empty stack. Trace two pops and explain your reasoning."

## 3. Answer assessment

The AI marks each rubric point `covered` true or false and picks one of six states.
The server then enforces these rules, whatever the model returned:

1. `rubric_hits` must contain exactly one entry per rubric point, using the bank's IDs (the JSON schema constrains IDs with an enum). Otherwise retry once, then fail.
2. Coverage carries forward: a point covered in an earlier answer stays covered unless the current answer contains a misconception.
3. `coverage = 100 * covered / total`, rounded to 1 decimal.
4. If coverage is 100 with no misconception and the state is `partial` or `superficial`, upgrade it to `complete`.
5. If the answer is a clear non-answer (see below), force `non_answer`.
6. `complete` with coverage below 100 or with a misconception is invalid. Reject it.

Clear non-answer: after removing fillers and hedges (`um`, `uh`, `erm`, `hmm`, `mmm`, `ah`, `so`, `like`, `well`, `okay`, `maybe`, `perhaps`, `I think`, `I guess`, `you know`), the text is empty or matches
"(i) don't know / not sure / no idea / have no idea / no clue / pass / skip / idk / cannot answer / can't answer / cannot remember / don't remember".
A bare "No." is **not** a non-answer, because it can answer a yes/no probe.

Instruction to the model (keep the meaning): assess only the provided rubric; credit every rubric point
the transcript demonstrates even if it answers a different part of the original question than the
current prompt asked; combine uncontradicted earlier evidence; judge misconceptions from the current
answer; use `non_answer` only when there is no substantive content; never choose an action; accept
paraphrases; never infer confidence from fluency.

The six states:

| State | Meaning |
|---|---|
| `complete` | All rubric points covered, no misconception |
| `partial` | Some points covered |
| `superficial` | Names the idea, explains nothing |
| `incorrect` | Wrong, no known misconception |
| `misconception_bearing` | Contains a listed misconception |
| `non_answer` | Empty, fillers only, or "I don't know" |

A demo-mode phrase matcher (`demo_assess`: keyword matching with nearby-negation handling) is kept for offline tests.

## 4. Deterministic follow-up policy

`policy(state, depth, max_depth, prior_turns)`:

| Condition (checked in order) | Action |
|---|---|
| state `complete` | `NEXT_CONCEPT` |
| `depth >= max_depth` | `DEPTH_LIMIT_NEXT_CONCEPT` |
| `non_answer` and an earlier turn for this concept was `non_answer` | `SIMPLIFY` |
| `non_answer` | `REPHRASE` |
| `partial` | `PROBE_MISSING_RUBRIC` |
| `superficial` | `ASK_REASONING_OR_EXAMPLE` |
| `misconception_bearing` | `PROBE_MISCONCEPTION` |
| `incorrect` | `ASK_SIMPLER_OR_PREREQUISITE` |

- `max_depth` defaults to 2. A C2 cognitive load of `high` reduces it to 1, and C2 never enters the gap rules.
- Sessions use one approved question per concept, at most 6 concepts.
- `PROBE_MISSING_RUBRIC` targets the first missing rubric point with a probe that has not been targeted yet for this concept, and records `target_rubric_id` on the turn.
- `SIMPLIFY` fallback text: "That is okay. Let us try one basic idea about {concept}: what does it do?"
- If the chosen prompt repeats an earlier question for this concept, use one fixed alternate ("Use a different concrete example to explain {concept}. Work through your reasoning step by step."); if that also repeats, use `REPEATED_PROMPT_NEXT_CONCEPT`.
- `ASK_SIMPLER_OR_PREREQUISITE` and `SIMPLIFY` turns are marked `scaffolded` (they may teach).
- Student skip: `SKIPPED_NEXT_CONCEPT`, recorded as a skipped turn with no AI call.
- Student says to stop ("stop the session", "I don't want to answer", "I want to quit", "no more questions"): the session finishes early without assessing that utterance (`STUDENT_ENDED_SESSION`).

## 5. Follow-up wording (AI, constrained)

The policy picks the action and target. The model only words the question.
To stay within about 2 to 3 seconds, assessment and wording happen in **one** call: the request includes, for every possible state, the action the policy would take and its purpose. The model assesses, then words the follow-up for the state it chose. The server re-runs the policy and uses the model's wording only if it fits the server's action and target. Otherwise it makes one separate wording call, and if that fails, it uses the stored probe or template. The source is recorded on the turn (`follow_up_phrasing.source`).

Purposes per action:

| Action | Purpose |
|---|---|
| `PROBE_MISSING_RUBRIC` | Build on something specific the student said; ask them to explain the missing idea; never state or hint at it |
| `ASK_REASONING_OR_EXAMPLE` | Refer to what they said; ask why, or for a concrete example |
| `PROBE_MISCONCEPTION` | Refer to their claim; ask them to test it on a small case; never say it is wrong |
| `ASK_SIMPLER_OR_PREREQUISITE` | One simpler, more basic question on the same concept |
| `REPHRASE` | Short kind reassurance ("That is okay."), then the original question in plainer words |
| `SIMPLIFY` | Short reassurance, then one very easy entry question |

Wording rules: plain English for a second-year undergraduate, at most 25 words, exactly one question
ending with "?", quote a few of the student's own words when the answer had content, adapt the reviewed
probe's meaning, no praise or judgement, no answer hints, nothing beyond the original question.

Server checks (reject and retry once, then fall back):

1. Exactly one "?", at the end. At most 35 words.
2. Not a repeat of an earlier question for this concept.
3. For actions other than `REPHRASE` and `SIMPLIFY`, when the latest answer has content: it shares at least one content word (4+ letters, not a stopword) with the latest answer.
4. No leaked answer terms: no rubric keyword that is absent from the student's own words, the original question, the concept name, the reviewed probe and the stored follow-ups.

## 6. Hesitation signals

Measured only on spoken answers. Typed answers never get acoustic values.

| Signal | Counts when |
|---|---|
| `latency` | First word at or after 3,000 ms, measured from pressing record |
| `pauses` | Average internal pause at least 1,500 ms, or 3 or more pauses longer than 2,000 ms |
| `fillers` | At least 8 per 100 words (`um`, `uh`, `erm`, `er`, `hmm`, `mmm`, `ahh`, with elongations) |
| `restarts` | At least 2 ("I mean", "sorry", "let me start again") |
| `hedges` | At least 2 ("maybe", "perhaps", "I think", "I guess", "I'm not sure") |

- Pauses come from Silero VAD: internal gaps of at least 400 ms between speech intervals, merging overlaps and excluding leading and trailing silence. Record `pause_count`, `total_pause_ms`, `average_pause_ms`, `long_pause_count` (pauses of 2,000 ms or more) and `audio_duration_ms`.
- "like", "so", "well" and "you know" are counted separately as ambiguous markers, not fillers.
- `high_hesitation`: 2 or more signals.
- `audible_hesitation`: `high_hesitation` and at least one of `fillers`, `hedges` or `restarts`.

All thresholds are prototype hypotheses to calibrate on pilot data.

## 7. Gap rules (`differentiate(turns, condition)`)

Skipped turns are removed first. `condition` is `A`, `B` or `C`.
Evidence: `A` uses the first answer only; `B` and `C` use all answers. The first matching rule decides:

1. No evidence: `MIXED` ("skipped" or "no answer evidence").
2. Condition C, first answer complete, last answer complete with coverage 80 or more and no scaffolded follow-up, and `audible_hesitation(first)`: `COMMUNICATION`.
3. First answer complete: `MIXED`, no weakness (shown to the student as "No gap identified").
4. Condition A: first state `incorrect`, `misconception_bearing` or `non_answer` gives `KNOWLEDGE`; anything else gives `MIXED`.
5. Only one answer: `MIXED`.
6. The same misconception in the last two substantive (non-`non_answer`) answers: `KNOWLEDGE`.
7. The last two substantive answers are both below 50% coverage, in a weak state: `KNOWLEDGE`.
8. The last answer is complete (80%+) but a follow-up was scaffolded: `MIXED`.
9. Recovered (last answer complete, 80%+), 3 or more answers, and the last two are each at least 66% coverage in `partial` or `complete`: `COMMUNICATION`.
10. Recovered, condition C, and `high_hesitation(first)`: `COMMUNICATION`.
11. Recovered otherwise: `MIXED`.
12. Anything else: `MIXED`.

Session outcome: `KNOWLEDGE` only if every concept is knowledge, `COMMUNICATION` only if every concept is communication, otherwise `MIXED`. The student report uses condition C. A, B and C are all stored for evaluation.

## 8. Report

| Field | Content |
|---|---|
| `outcome`, `explanation` | Condition C session result and per-concept reasons |
| `strong_answers` | True when every concept is a no-weakness case. The stored outcome stays `MIXED`; only the student-facing headline changes to "No gap identified: strong answers" |
| `rubric_coverage` | Mean of the concepts' final coverage. Labelled "rubric coverage", never a confidence score |
| `concepts[]` | `concept`, `outcome`, `explanation`, `initial_state`, `final_state`, `rubric_coverage`, `turn_count`, `no_weakness`, `signal_details` (each signal's label, value, threshold, counted) |
| `strengths`, `missing_concepts` | From the final rubric hits |
| `hesitation` | Aggregated latency, pauses, fillers, hedges and restarts |
| `improvement_plan`, `plan_summary`, `plan_provider` | AI-personalised plan for the fixed outcome, with a rule-based fallback: knowledge means study steps, communication means explanation practice |
| `review_resources` | From C3 (stub until live) |
| `evidence_conditions` | The A, B and C outcomes |
| `mastery_mismatch` | C1 mastery 80 or more and any knowledge-gap concept. Records a review flag; C4 never changes mastery |
| `limitations` | Fixed list: research prototype, AI marking can be wrong, thresholds are unvalidated, A/B/C is a retrospective ablation |

## 9. Evaluation (A/B/C)

- Blinded rater cases per completed concept. Condition A shows only the first answer, B shows all answers, and C adds hesitation. The system's own prediction is never shown to raters. C1 mastery is shown as reference only.
- A rating holds the answer state, the gap outcome, follow-up appropriateness 1 to 5 (not allowed for A), feedback usefulness 1 to 5, and notes. One rating per rater, case and condition.
- Metrics per condition: accuracy, macro F1 over all 6 states and all 3 outcomes (absent classes score 0), and Cohen's kappa (null when undefined). Inter-rater agreement is the mean pairwise kappa, plus the disagreement count. Use scikit-learn.
- The export is pseudonymised (rater codes are hashed).
