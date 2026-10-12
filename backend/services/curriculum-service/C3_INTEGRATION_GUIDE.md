# C1 Adaptive Curriculum Engine: integration guide for C3

**To:** Bandara H.M.T.L (C3 owner, project leader)
**From:** Abeyrathne E.D.V.N (C1 owner, IT23265110)
**Date:** 12 Oct 2026 (C1 feature freeze 14 Oct, PP1 22 Oct)

This note explains what C1 has built, what C1 needs from C3 so the two components work together, and the rules that keep the C1 evaluation valid. The most important requests are in section 4; section 3 explains how practice in a module drives BKT and GAT. A short checklist is at the end.

---

## 1. C1 in one paragraph

C1 decides **what each learner should study next and why**. It holds the PF + DSA prerequisite graph, keeps a mastery estimate per learner and concept (Bayesian Knowledge Tracing, BKT), and ranks the concepts the learner is ready for with a Graph Attention Network (GAT). Each recommendation comes with one plain sentence that names the weak prerequisite. C1 also runs the pre-test and post-test for each module and computes learning gain for the research study.

C1 does **not** teach. Teaching, checkpoints and practicals belong to C3. C1 needs C3's answer outcomes as evidence, and C3 can use C1's mastery and next-concept views to gate and order its sessions.

```
C3 tutor (answers) ──► tutor.v_attempt_outcomes ──► C1 BKT mastery ──► C1 GAT ranking
                                                         │                    │
                       C3 unlock / ordering ◄── curriculum.v_mastery   curriculum.v_next_topic
```

---

## 2. What C1 has built (status on 12 Oct)

All code is in `backend/services/curriculum-service/` (port **8101**, gateway prefix `/api/v1/curriculum`), `frontend/src/features/curriculum/` and `research/c1-curriculum/`. C1 writes only to the `curriculum` schema and never writes `core`.

### 2.1 Backend

| Area | What exists |
|---|---|
| Prerequisite graph | 25 Java concepts, 39 edges, 9 cross-module (PF to DSA), validated as a DAG. Read from Neo4j when configured, otherwise from Postgres (`curriculum.graph_snapshot`, then `core.concept_prerequisites`). **Neo4j is optional; you never need it to run C1.** Lecturer edits are logged in `curriculum.graph_audit` |
| Mastery (BKT) | One estimate per learner and concept, parameters fitted on the Junyi dataset (`bkt-junyi-v1`). An answer counts as correct only on the **first try with no hint**. Starting mastery comes from the pre-test |
| Recommendation | Graph constraint first (a concept is ready when all its prerequisites are mastered, >= 0.70), then the GAT (`gat-v2`, numpy inference, SHA-256 checked) picks the ready concept with the highest predicted success. Falls back to `rules-v1` if the model is missing |
| Explanation | One sentence naming the weak prerequisite (for example "Strengthen Arrays first (42% mastered), because Linked Lists builds on it.") |
| Pre/post tests | Per module (PF, DSA), two parallel forms A/B with twin items, counterbalanced form order, options shuffled per student, server-side scoring, one attempt, idempotent submit, no answer keys sent to the browser. Lecturer controls the study window |
| Learning gain | g = (post - pre) / (100 - pre), overall, per topic and per concept; adaptive group vs comparison group (fixed syllabus order) |
| Question editor API | Lecturers create, edit and retire questions; papers go draft -> published -> locked (locked once anyone has taken it) |
| Practice (C3 stand-in) | A small temporary practice API so the BKT/GAT loop can be demonstrated **until C3 publishes its view**. Exists only in `INTEGRATION_MODE=stub` and will be deleted afterwards. It is not meant to replace C3's tutor |
| Security | Identity only from the gateway headers, students reach only `/me` routes, staff routes need `lecturer` or `admin`, `/dev/*` disabled in production, parameterised SQL and Cypher only |
| Tests | 214 unit tests; all migration SQL verified on a throwaway Postgres |

### 2.2 API (all under `/api/v1/curriculum`, through the gateway)

| Route | Who | Purpose |
|---|---|---|
| `GET /graph?module=` | any signed-in user | Prerequisite graph (nodes, edges, depth) |
| `GET /me/mastery?module=` | student | My mastery per concept |
| `GET /me/recommendation?module=` | student | My next concept, readiness and explanation |
| `GET /me/tests?module=` | student | Which test is open, my results |
| `POST /me/tests/{pretest|posttest}/start?module=` | student | Start or resume a test |
| `POST /me/tests/{pretest|posttest}/submit?module=` | student | Submit once |
| `GET /me/gain?module=` | student | My learning gain |
| `GET/PUT /study/{module}/window` | lecturer, admin | Open or close test phases |
| `GET /study/{module}/overview`, `/gain`, `/snapshot-validation` | lecturer, admin | Class-level results |
| `/papers...` | lecturer, admin | Question editor |
| `POST /graph/edits`, `GET /graph/audit` | lecturer, admin | Edit the graph with an audit log |
| `/me/practice/next|hint|answer` | student | C3 stand-in, stub mode only |

### 2.3 Database (schema `curriculum`, Alembic migrations 0001 to 0005)

Published views for other components:

| View | Grain | Use |
|---|---|---|
| `curriculum.v_mastery` | user x concept | `mastery_score`, `is_mastered` (>= 0.70), `evidence_count`, `needs_reassessment`, `updated_at` |
| `curriculum.v_topic_mastery` | user x topic | Topic mastery = minimum over its concepts, `concepts_total`, `concepts_mastered` |
| `curriculum.v_next_topic` | user | `next_concept_id`, `next_topic_id`, `target_concept_id`, `weak_prerequisite_id`, `readiness`, `explanation`, `reason`, `model_version`, `updated_at` |

Full column definitions are in `contracts/views/curriculum.*.md` (status: proposed v1).

### 2.4 Frontend (`frontend/src/features/curriculum/`, all routes under `/curriculum`)

| Route | Page |
|---|---|
| `/curriculum` | Module choice (PF, DSA) with phase and progress |
| `/curriculum/:moduleId` | Test card and mastery dashboard |
| `/curriculum/:moduleId/roadmap` | Prerequisite roadmap coloured by mastery |
| `/curriculum/:moduleId/test/:kind` | Pre-test / post-test |

No shared files were changed: no edits to `app/`, `shared/`, `index.css` or `package.json`, and no new npm packages. Recommendation card, gain report and lecturer screens follow on 13 Oct.

### 2.5 Research results (Junyi, 6,000 test students, 1,168,144 identical answers)

| Model | AUC | Accuracy |
|---|---|---|
| **GAT v2 (C1)** | **0.7931** | 85.50% |
| GKT | 0.7885 | |
| DKT | 0.7877 | |
| BKT | 0.7804 | 85.10% |
| Majority class | | 83.48% |

GAT v2 beats every baseline in 10 of 10 student groups (paired t, p <= 0.0005).

---

## 3. How practice in a module drives BKT and GAT

C3 teaches and grades; C1 turns each graded answer into mastery (BKT) and picks the next concept (GAT). This section shows exactly how one module runs end to end, so C3's sessions line up with C1.

### 3.1 The learner journey in one module

| Step | Owner | What happens | What C1 records |
|---|---|---|---|
| 1 | C1 (lecturer) | Lecturer sets the study window to `pretest` | `curriculum.study_window` |
| 2 | C1 | Learner takes the pre-test: 24 Java MCQs (DSA also has 4 to 6 PF background items) | Each answer becomes evidence `source=pretest`; BKT update **without** the learning step, so it only measures. This is the learner's **starting mastery** |
| 3 | C1 (lecturer) | Lecturer sets the window to `learning` | |
| 4 | C1 | C1 recommends the next concept with one sentence of explanation | Row in `curriculum.recommendation`, visible in `v_next_topic` |
| 5 | **C3** | **Tutoring session on that concept: teaching, checkpoints, practicals, hints** | **C3 writes one row per graded answer to `tutor.v_attempt_outcomes`** |
| 6 | C1 | On the next C1 call, C1 reads the new rows | Evidence `source=practice`; BKT update **with** the learning step; `concept_mastery` updated, visible in `v_mastery` |
| 7 | C1 | GAT re-ranks the ready concepts | New recommendation; back to step 5 |
| 8 | C1 (lecturer) | Lecturer sets the window to `posttest`; learner takes the post-test (the other form) | Mastery snapshot first (BKT validity check), then evidence `source=posttest` |
| 9 | C1 | Learning gain per learner, topic and concept | `GET /me/gain`, `GET /study/{module}/gain` |

Steps 4 to 7 repeat for the whole learning phase. **Step 5 is the only C3 step**, and it is where all practice evidence comes from.

### 3.2 The practice loop

```
            ┌──────────────────────────── C1 ────────────────────────────┐
            │                                                            │
 v_next_topic.next_concept_id                              GAT ranks ready concepts
            │                                                            ▲
            ▼                                                            │
 ┌──────── C3 ─────────┐                                       BKT updates mastery
 │ tutoring session    │                                                 ▲
 │ checkpoint answered │──► tutor.v_attempt_outcomes ──► C1 ingests (first try per item)
 └─────────────────────┘
```

### 3.3 Which answers count as evidence

C1 applies one rule everywhere (research data and live system): **an answer is correct only on the first try at that question and with no hint.**

| What happens in C3 | Row C3 writes | What BKT sees |
|---|---|---|
| First try at a question, correct, no hint | `correct=true, hints_used=0` | Correct |
| First try, correct after seeing a hint | `correct=true, hints_used=1` | **Wrong** (needed help) |
| First try, wrong | `correct=false` | Wrong |
| Second try at the same question (same `item_id`) | another row | **Ignored**, already counted |
| Same question shown again in a later session | another row, same `item_id` | **Ignored** |
| A different question on the same concept | new `item_id` | Counted |
| A checkpoint that tests two concepts | two rows, one per `concept_id` | Counted on each concept |
| Free chat, explanations, ungraded turns | no row | Nothing |

Because only first tries count, **C3 needs a pool of several different questions per concept** for mastery to keep moving. Retrying the same question helps the learner but does not change C1 mastery.

### 3.4 BKT: what one answer does to mastery

BKT keeps P(L), the probability that the learner knows the concept. Parameters were fitted on 24,000 Junyi students (research notebook 03) and are the same for every concept:

| Parameter | Value | Meaning |
|---|---|---|
| `p_init` | 0.4404 | Mastery before any evidence |
| `p_learn` | 0.0801 | Chance of learning the concept from one practice opportunity |
| `p_guess` | 0.25 | Chance of a correct answer without knowing it (four-option MCQ) |
| `p_slip` | 0.1268 | Chance of a wrong answer despite knowing it |
| Version | `bkt-junyi-v1` | Stored on every evidence row |

For each counted answer:

1. **Bayes step:** correct raises P(L), wrong lowers it, weighted by guess and slip.
2. **Learning step (practice only):** P(L) += (1 - P(L)) x 0.0801. Tests skip this step because they only measure.
3. **Mastered** when P(L) >= 0.70 (platform-wide threshold).

**Worked example** (one concept, computed with the service code):

| # | Answer | Source | Mastery before | Mastery after | Mastered? |
|---|---|---|---|---|---|
| 0 | (no evidence) | | | 0.4404 | No |
| 1 | Correct | pretest | 0.4404 | 0.7332 | Yes |
| 2 | Wrong | pretest | 0.7332 | 0.3173 | No |
| 3 | Correct | practice | 0.3173 | 0.6493 | No |
| 4 | Correct **after a hint** (counts as wrong) | practice | 0.6493 | 0.2994 | No |
| 5 | Correct | practice | 0.2994 | 0.6310 | No |
| 6 | Correct | practice | 0.6310 | 0.8681 | **Yes** |

Early answers move mastery a lot; `evidence_count` in `v_mastery` shows how much evidence is behind a score. Mastery for an answer is visible on the next C1 call, well within the 2 s target (NFR-02).

**Note for C3 practicals:** `p_guess = 0.25` assumes four-option MCQs. For open-ended or code practicals the real guess rate is lower, so a correct answer there is stronger evidence than BKT assumes and BKT is slightly cautious. That is safe, and it does not need any change from C3.

### 3.5 GAT: how the next concept is chosen

| Stage | What happens |
|---|---|
| 1. Graph constraint | Only concepts in the module that are **not yet mastered** and whose **every prerequisite is mastered** (>= 0.70) are "ready". This rule is the same with or without the model |
| 2. Features | For every concept, C1 builds the features below from the learner's mastery and history |
| 3. GAT scoring | `gat-v2` predicts P(correct next answer) for each concept, attending over its prerequisites. Runs in numpy inside C1, about 0.1 ms per learner |
| 4. Pick | The ready concept with the **highest predicted P(correct)** is recommended (`readiness` in `v_next_topic`) |
| 5. Explain | One sentence (see 3.6) naming a prerequisite chosen by attention x (1 - mastery) |
| 6. Nothing ready | If every open concept waits on an unmastered prerequisite (for example DSA waiting on PF), C1 walks down to the weakest prerequisite and recommends that, with `target_concept_id` set to the concept it unlocks |
| 7. Fallback | If the model file is missing or fails its SHA-256 check, `rules-v1` picks the ready concept with the lowest mastery. `model_version` says which one ran |
| 8. Comparison group | Learners in the comparison group get the fixed syllabus order (`reason=fixed_order`, `explanation` null). C3 does not need to know the group |

GAT input features (all graph-agnostic, which is why a model trained on Junyi math transfers to Java):

| Feature | Level | Comes from |
|---|---|---|
| `mastery` | concept | BKT P(L) |
| `log_evidence` | concept | Number of counted answers on the concept |
| `log_depth` | concept | Longest prerequisite chain below the concept |
| `log_prereq_count` | concept | Number of direct prerequisites |
| `mean_prereq_mastery` | concept | Mean BKT mastery of its prerequisites |
| `bkt_p_correct` | concept | BKT prediction of the next answer; GAT learns a correction on top |
| `overall_correct_rate` | learner | Smoothed share of all counted answers that were correct |
| `recent_correct_rate` | learner | Smoothed share of the last 5 counted answers |
| `previous_correct` | learner | Was the last counted answer correct |

So every answer C3 reports changes the concept's mastery **and** the learner features, which is why the recommendation can change after a single checkpoint.

### 3.6 Explanation sentences (shown to the learner as is)

| Situation | Sentence |
|---|---|
| Ready, no prerequisites | "Variables and Data Types has no prerequisites, so it is a good place to start." |
| Ready, one prerequisite | "You are ready for Loops because you have mastered Conditionals." |
| Ready, several prerequisites | "You are ready for Linked Lists because you have mastered its prerequisites, and Arrays is the one to review if you get stuck." |
| Prerequisite to fix first | "Strengthen Arrays first (42% mastered), because Linked Lists builds on it." |
| Comparison group | none (`explanation` is null) |

(Concept names come from `core.concepts`; the examples are illustrative.)

### 3.7 Where the data lives

| Table or view | Written by | Holds |
|---|---|---|
| `tutor.v_attempt_outcomes` | **C3** | Raw graded answers (input to C1) |
| `curriculum.stub_attempt_outcomes` | C1 stand-in | Same columns, used only until C3's view exists |
| `curriculum.mastery_evidence` | C1 | One row per counted answer: `source` (pretest, practice, posttest), `correct_raw`, `hints_used`, `correct` (after the rule), `mastery_before`, `mastery_after`, `params_version`. Unique on (`source`, `source_ref`) so an answer is never counted twice |
| `curriculum.concept_mastery` | C1 | Current P(L) and `evidence_count` per learner and concept |
| `curriculum.recommendation` | C1 | Latest recommendation per learner and module, with `model_version` and `graph_version` |
| `curriculum.v_mastery`, `v_topic_mastery`, `v_next_topic` | C1 | Published read-only views for C3 |

Every number is traceable: for any mastery value C1 can list the exact answers, the rule applied and the before/after values, which matters for the viva and for the study.

### 3.8 What C3 should do in a session so it lines up with C1

| Do | Why |
|---|---|
| Start the session on `v_next_topic.next_concept_id` (the default "Continue" button) | Keeps the adaptive vs fixed comparison valid |
| Tag every checkpoint and practical question with its `concept_id` and a stable `item_id` | C1 counts first tries per question and concept |
| Keep several different questions per concept | Only first tries count, so repeats do not move mastery |
| Record hints shown before the answer in `hints_used` | A hinted answer counts as wrong for BKT |
| Write the row as soon as the answer is graded | C1 can update mastery on the next call |
| After the session, call `GET /api/v1/curriculum/me/recommendation?module=...` once | Ingests the new answers and refreshes `v_mastery` and `v_next_topic` |
| Gate unlocks with `v_mastery.is_mastered` / `v_topic_mastery.is_mastered` | Same 0.70 threshold as C1, never recomputed |
| Let learners open other unlocked concepts if they choose | Allowed; their answers still count as evidence. Only the default order must come from C1 |

---

## 4. What C1 needs from C3

### 4.1 Publish `tutor.v_attempt_outcomes` (most important)

This is the only data C1 needs from C3. Without it, C1 mastery only changes from the pre-test and the C1 stand-in. The contract is `contracts/views/tutor.v_attempt_outcomes.md`:

| Column | Type | Meaning |
|---|---|---|
| `user_id` | uuid | `core.users` |
| `concept_id` | text | `core.concepts`, the concept the checkpoint or practical tests |
| `item_id` | text | Identifier of the **question**, not of the attempt |
| `correct` | boolean | Raw graded outcome |
| `hints_used` | smallint | Hints shown before answering, 0 or more |
| `attempted_at` | timestamptz | Server time of the answer |

How C1 reads it (please keep these properties):

1. **One row per attempt, append only.** Never update or delete rows; C1 keeps its own processed copy and ignores duplicates.
2. **`item_id` must be stable and identify the question.** C1 counts only the **first try per learner and item**, so a retry of the same question does not count again. If the same question appears in two sessions, use the same `item_id`.
3. **One concept per row.** If a checkpoint covers two concepts, write two rows (or tag it with the main concept). `concept_id` must exist in `core.concepts`; rows with unknown concepts are skipped.
4. **Send the raw `correct` and the real `hints_used`.** Do not pre-apply any rule. C1 applies "correct = first try and no hint" itself, which is the same rule used on the research data.
5. **Only graded answers.** Free chat turns or ungraded explanations should not appear.
6. The C1 service connects with the same database user as the other services. If you use a separate role, please `GRANT SELECT ON tutor.v_attempt_outcomes` to it.

When the view exists, C1 switches with one setting (`INTEGRATION_MODE=live`). No C1 code changes, and the C1 stand-in practice routes disappear.

### 4.2 Use C1's views instead of computing mastery or order

| Rule | Why |
|---|---|
| Read `v_mastery.is_mastered` (or `v_topic_mastery.is_mastered`) for unlocks; do not recompute from `mastery_score` | Keeps C1's roadmap and C3's unlocks identical. The threshold 0.70 is platform-wide |
| A missing row in `v_mastery` means "no evidence yet", treat it as not mastered | The view only has rows for concepts with evidence |
| **Follow `v_next_topic.next_concept_id` as is; do not add C3's own ordering on top** | The C1 study compares the adaptive order with the fixed syllabus order. If C3 reorders, both groups get the same order and the study is invalid |
| Show `v_next_topic.explanation` exactly as given (it can be null) | Null means the learner is in the comparison group; nothing should reveal the group |
| Do not show or infer the study group anywhere | Learners must stay blind to their group |

**Freshness:** C1 processes new attempts when it is asked about a learner. After a tutoring session, call `GET /api/v1/curriculum/me/recommendation?module=<prog|dsa>` once (through the gateway, with the learner's token) before reading `v_next_topic` or `v_mastery`. That one call ingests the new answers, updates mastery and writes a fresh recommendation. If you would prefer C1 to refresh on a timer instead, tell me and I will add it.

### 4.3 Frontend: two lines in files you own

`frontend/src/app/` is yours, so C1 does not edit it. Please add:

```tsx
// frontend/src/app/router.tsx
import { authRoutes } from '@/features/auth';
import { curriculumRoutes } from '@/features/curriculum';   // above tutor, so it does not clash with the viva import
import { tutorRoutes } from '@/features/tutor';
...
          ...tutorRoutes,
          ...curriculumRoutes,
```

And, when you finish the new `StudentLayout`, a nav tab such as **"Learning path"** linking to `/curriculum`. C1 uses no other route prefix.

### 4.4 Merge the Java concept seed into `dev`

The live database has the Java concept list (25 concepts, 39 edges) from your branch `feature-RAG-tutoring-engine` (commit `c687f8f`), but `dev` still has the old CSVs in `database/seed/`. Please open a PR with the Java CSVs. Until then nobody should run `seed_concepts.py` against a shared database, because it deletes and re-inserts every edge. C1 reads concepts only from `core`, so C1 itself is safe. For PP1, C1 runs on my Neon branch `dev-vishwa`, which already has the Java list.

### 4.5 Contracts PR

I will raise one PR to `contracts/` for your review:

- `curriculum.v_mastery`, `v_topic_mastery`, `v_next_topic`: proposed v1 (already implemented in C1).
- `tutor.v_attempt_outcomes`: please confirm the columns in 4.1, or tell me what you need changed **before** you build it.
- `tutor.v_session_exits`: drafted earlier as optional. C1 does not read it today and does not need it for PP1.
- **Withdrawn by C1:** the C2 load signal (`load.v_current_load`) and C4 review flags (`viva.v_review_flags`) are no longer used by C1, because C1's proposal does not cover them. In C1's views, `reason` never becomes `revision_high_load` and `needs_reassessment` stays false.

**Proposed addition (your opinion please):** `v_next_topic` is currently one row per learner, the most recent recommendation across modules. If C3 runs PF and DSA sessions side by side, a `module_id` column (one row per learner and module) would be clearer. It is additive and I can add it on 13 Oct if you want it.

### 4.6 Coordinate the two studies

C3 plans a mastery-gated vs points-only study; C1 runs an adaptive-order vs fixed-order study with a pre-test and post-test per module. If the same students take part in both, the results can interfere. Can we agree on one of:

1. Separate cohorts or modules for each study, or
2. A crossed design, recorded so each analysis controls for the other group.

C1 assigns its group once per student for the whole study; C1 can share the assignment table if C3 needs it.

---

## 5. Running C1 locally (no Neo4j needed)

```powershell
cd backend/services/curriculum-service
uv sync
copy .env.example .env      # set DATABASE_URL to the Neon POOLED url, INTEGRATION_MODE=stub
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8101
```

- The gateway already routes `/api/v1/curriculum/*` to `http://localhost:8101` (`CURRICULUM_SERVICE_URL`).
- **Migrations:** the `curriculum` schema has its own Alembic history (version table inside `curriculum`). Run `uv run alembic upgrade head` in the service folder against the DIRECT url. It never touches `core`.
- The GAT model file (`models/gat-v2.npz`) is not in git. Without it C1 runs `rules-v1`, which is fine for development.
- **Tests:** `uv run pytest` (no database needed).

---

## 6. Checklist for C3

| # | Action | Needed by |
|---|---|---|
| 1 | Confirm the `tutor.v_attempt_outcomes` columns (4.1) in the contracts PR | 14 Oct |
| 2 | Publish `tutor.v_attempt_outcomes` from checkpoint and practical results | as soon as C3 grading exists; before the study in Feb 2027 at the latest |
| 3 | Add the C1 router line and a "Learning path" nav tab (4.3) | 14 Oct (for PP1) |
| 4 | PR the Java concept CSVs into `dev` (4.4) | before anyone else reseeds |
| 5 | Gate unlocks with `is_mastered`, follow `v_next_topic` without reordering, call C1 after each session (4.2) | when C3 starts reading C1 |
| 6 | Decide on `module_id` in `v_next_topic` (4.5) | 13 Oct if wanted |
| 7 | Agree how the C1 and C3 studies share students (4.6) | before the study design is final |

Thank you. Questions to me any time; I can pair on the view definition or the unlock logic.
