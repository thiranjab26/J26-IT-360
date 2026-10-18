# tutor-service (C3)

**C3 VeriTutor**: faithfulness-verified, gamified, cognitive-load-aware AI tutor.
Owned by the C3 member, who is also the project leader, so this service carries
the learner-facing basics (module catalogue, dashboard data) as well as the
research pipeline.

Design docs: `docs/c3/Implementation-plan.md`, `docs/c3/dsa-module-plan.md`,
`docs/c3/research-methodology.md`, `docs/c3/ui-design-brief.md`.

**Current phase: P2, guided sessions work end to end with authored text; the language model and the faithfulness gate come next.**

## Routes

| Method | Path | Purpose | Phase |
|---|---|---|---|
| GET | `/health` | Liveness | P0 |
| GET | `/api/v1/tutor/modules` | Modules, each `available` or `coming_soon` | P0 |
| GET | `/api/v1/tutor/modules/{module_id}/concepts` | Concepts grouped by topic, in teaching order. `409 module_coming_soon` for a module with no content yet | P0 |
| POST | `/api/v1/tutor/sessions` | Start a session on `{concept_id}`, or return the one already in progress for it. Starting a different concept puts the old session down (`student_ended`, resumable). `403 concept_locked` lists what is unmet | P2 |
| GET | `/api/v1/tutor/sessions/{id}` | Where the session is now: the hook, an explanation part, an open question, feedback, a re-teach, or the summary | P2 |
| POST | `/api/v1/tutor/sessions/{id}/continue` | Move on from the hook, an explanation, feedback or a re-teach | P2 |
| POST | `/api/v1/tutor/sessions/{id}/answer` | Body `{answer}`. Marked, recorded, and the next state returned. An unreadable answer uses no try | P2 |
| POST | `/api/v1/tutor/sessions/{id}/end` | The student stops. Resumable for 48 hours | P2 |
| POST | `/api/v1/tutor/sessions/{id}/resume` | Pick up after the last passed checkpoint (`student_ended`, `load_exit`, `timeout` only) | P2 |
| GET | `/api/v1/tutor/progress?module_id=prog` | XP, mastery per concept, what is unlocked and why not, the suggested next concept | P2 |
| GET | `/api/v1/tutor/profile` | Level, XP towards the next level, streak and every badge (earned or locked) | P5 |
| GET | `/api/v1/tutor/leaderboard?limit=10` | Top students by XP, names shortened to a first name and an initial, plus the caller's own rank if outside the top | P5 |

The session routes are for students only (`403 students_only` otherwise), and a session is visible only to the student who started it. The answer key never appears in a response before the student has answered: a wrong gating answer gets no explanation, so the retry means something. Two settings shape them: `TUTOR_SESSION_POLICY` (`mastery_gated` or `points_only`, the two study conditions) and `TUTOR_ENFORCE_UNLOCKS` (`false` opens every concept, handy for demos).

Everything below needs an authenticated caller: identity arrives as `X-User-Id`
and `X-User-Role` from the gateway. This service never parses a JWT and never
holds the signing secret.

Arriving with later phases: sessions (start, next, answer, end, resume),
practicals, progress and XP, content admin, and the internal `/internal/load`
receiver for C2's signal.

## Course content

`content/prog/` holds the authored Java 21 course material for Programming Fundamentals: a module introduction and 13 concept files. Each concept file has the same sections, marked with `<!-- section: ... -->` comments (objectives, theory, examples, misconceptions, key facts, practice questions, solutions, rubrics). The markers are what the chunker splits on, and the section type decides which jobs may retrieve a chunk: solutions and rubrics are for grading only and never reach the tutor or chatbot.

The frontmatter `concept_id` values must exist in `core.concepts`, and the frontmatter prerequisites must match `core.concept_prerequisites`. The programming seed CSV is generated from this frontmatter, so the content is the source of truth. DSA content comes later, in `content/dsa/`.

### Turning content into chunks

`app/content/` reads the markdown and cuts it into retrievable chunks (about 580 for the Programming module):

| Section | One chunk per |
|---|---|
| theory | run of small blocks, merged up to 200 words |
| example | worked example |
| misconception | misconception |
| exercise, solution | question |
| rubric | rubric entry (it can cover several questions) |
| objectives, prerequisites, facts, overview | block |
| further_practice | not indexed |

```bash
uv run python -m app.content.cli check            # parse, chunk, validate against core; writes nothing
uv run python -m app.content.cli check --no-db    # same without the database comparison
uv run python -m app.content.cli sync             # check, then write content.units and content.chunks
```

### Embedding and the vector store

```bash
uv run python -m app.content.cli index            # sync to Postgres, then embed into ChromaDB
```

`index` is incremental: it embeds only chunks that are new or whose text or heading changed, so re-running on unedited content embeds nothing (0.1 s) and a full first run takes about 20 s on a laptop CPU. The vectors live in `.chroma/` (gitignored, private to this service), in one collection per module and model, for example `content_prog__all-minilm-l6-v2`.

The default model is `sentence-transformers/all-MiniLM-L6-v2` (`TUTOR_EMBEDDING_MODEL`). It reads 256 tokens, so 63 of the 220 chunks the tutor searches are longer than it reads and their ends are not embedded. That looked like a reason to prefer a 512-token model, so we measured it: on the Programming module, forcing MiniLM's window to 512 changed nothing, and MiniLM matched or beat `bge-small-en-v1.5` on both query sets run so far (strict Hit@5 0.83 against 0.76 on the 143 practice questions, a difference whose interval excludes zero; closer on the code-free subset), while a plain keyword baseline was competitive. The experiment, its limits and how to re-run it are in `research/c3-RAG tutor/README.md`.

`index` reports how many chunks exceed the model's window every time, so the figure stays visible. Changing the model makes `index` build a second collection beside the first rather than overwriting it, which is how the comparison was run.

Run `check` after editing any markdown file. It fails on a question with no solution, a free-form question with no rubric, a prerequisite taught later than the concept, or a concept ID or prerequisite list that disagrees with `core`. `sync` refuses to write while any of those are open, and only rewrites units whose file actually changed.

## Retrieval and who may see what

`app/retrieval/` finds course material for a question. It reads only the local ChromaDB, so it works with the database down, and a search takes about 20 ms (embedding the query dominates).

The default method is **hybrid**: the embedding ranking and a BM25 keyword ranking, fused by reciprocal rank. Measured on this course, embeddings alone were weak on questions that contain pasted code and keyword search alone collapsed on natural phrasing; the fusion was not significantly worse than the best single method on any query set, and ranked the right concept first significantly more often than embeddings alone on the practice questions (numbers and intervals in `research/c3-RAG tutor/README.md`). `method="dense"` gives the embedding ranking alone. The keyword index is built only from the sections the mode may see, so it cannot return anything the embedding search could not.

The rule it enforces is in `app/retrieval/access.py`, because it protects both the student and the research. Practice questions have authored solutions and rubrics in the same files as the theory; if the tutor could retrieve them, pasting a practice question into the chat would hand back its answer.

| Mode | May search | Never |
|---|---|---|
| `tutoring` (teaching, chatbot, hints) | theory, example, misconception, facts | solutions, rubrics, exercises |
| `practical` (generating questions) | theory, facts, misconception, exercise (as style examples) | solutions, rubrics |
| `grading` | solution, rubric, facts, theory, **only for the named concept** | searching answer keys across a module |

Callers can narrow a mode's sections (the question generator searches theory for grounding and exercises for style separately) but can never widen it: asking for a forbidden type raises an error. Grading also has an exact lookup, `question_materials`, which returns one authored question with its solution and the rubric entry covering it.

Checked against the real index with every one of the 143 practice questions pasted verbatim as the query: 0 answer keys returned in tutoring or question generation, 0 cross-concept results in grading, and all 143 questions resolve to their solution and (when free-form) their rubric.

```bash
uv run python -m app.retrieval.cli search "difference between while and do-while"
uv run python -m app.retrieval.cli search "..." --mode practical --concept prog.loops
uv run python -m app.retrieval.cli search "..." --method dense         # embeddings only
uv run python -m app.retrieval.cli question prog.loops 8      # question + solution + rubric
```

Not yet exposed over HTTP: a `/retrieve` route would need its own authorisation so a student can never reach `grading` mode.

## Questions, grading and sessions

The pieces of a guided session, built as plain logic first so each rule is testable without a model. None of them touch the database yet.

| Module | What it does |
|---|---|
| `app/domain/questions.py` | Turns the 143 authored practice questions into structured questions and answer keys. A `Question` is what a student may see; an `AnswerKey` holds the answer, the explanation and the rubric and is server-side only. Also shuffles multiple-choice options at presentation time (the authored answers are B or C in 92% of cases) and leaves alone any question whose text names a letter |
| `app/grading/deterministic.py` | Marks multiple choice and "what does this program print" exactly, from the authored key, with no model: 77 of the 143 questions. An unreadable answer ("E", an empty box) is asked for again and never costs an attempt |
| `app/sessions/state_machine.py` | The session loop: hook, teach, checkpoint, judge, branch. First miss on a gating checkpoint gives a hint, the second re-teaches, the third ends the session as `struggling`. Multiple-choice pulse checks never block or count towards finishing. Six typed exits; `load_exit`, `student_ended` and `timeout` can be resumed within 48 hours |
| `app/sessions/plan.py` | Builds a session's steps for a concept: a hook, each part of the explanation with quick checks spread evenly between, then the gating checkpoints. Unseen questions come first |
| `app/sessions/service.py` | Runs a session over HTTP: loads and saves it through a repository, marks answers, awards XP, applies the unlock rules, ends a silent session as `timeout`, shuffles multiple-choice options from a seed (session + question) so a refresh shows the same order. Holds no rules of its own. Mastery needs two gating results (one if a concept ever has only one gating question) |
| `app/sessions/repository.py` | The session store: a SQL implementation on the `tutor` tables, with a unique index so a student can have only one active session even if two requests race |
| `app/sessions/catalog.py` | The authored course, loaded once: concept order, prerequisites, explanation parts, question bank |
| `app/gamification/` | XP per checkpoint passed (`xp.py`), a stand-in mastery estimate behind the interface C1's real one will use (`mastery.py`), and the unlock rules for the study's two conditions (`rules.py`): mastery-gated against points-only, identical except for what opens the next concept |

`content check` flags a question that cannot be turned into structured data as an error, and a level-2 question with no expected-output block as a warning, because it then needs a model to mark it. There are none today: every concept has at least two questions the platform can mark exactly, which mastery needs.

### Trying a session in the terminal

The session routes above serve the same engine to a browser (a screen for them is still to be built). To watch it work in a terminal now there is a demo that plays a real session on the course content, using the real state machine, question bank, marking, XP and unlock rules. It cannot write the teaching (that needs the model), so where the tutor would explain it prints the authored course passage.

```bash
uv run python -m app.sessions.demo prog.loops                       # you play it
uv run python -m app.sessions.demo prog.loops --auto                # a scripted perfect student
uv run python -m app.sessions.demo prog.loops --auto --misses 1     # a hint, then a pass
uv run python -m app.sessions.demo prog.loops --auto --misses 2     # a re-teach, then a pass
uv run python -m app.sessions.demo prog.loops --auto --misses 3     # fails: ends as `struggling`
```

It ends by showing what the session opens under each of the study's two conditions, mastery-gated and points-only, for the same student with the same XP.

## LLM providers

`TUTOR_LLM_PROVIDER` selects `gemini` (cloud) or `ollama` (local fallback). Put your key in `TUTOR_GEMINI_API_KEY` in `.env`; it is held as a secret value, so it cannot appear in logs or in a printed settings object, and an empty value counts as not configured. Check `TUTOR_GEMINI_MODEL` against the models Google AI Studio currently offers. The Ollama fallback defaults to `qwen2.5-coder:7b`; on a CPU-only machine generation is slow (the 1.5B model measured 2.6 tokens per second), which matters for the offline-fallback claim. The provider layer (`app/llm/providers.py`) reads these settings: Gemini first, optionally Ollama after it (`TUTOR_LLM_FALLBACK_PROVIDER=ollama`), each with a timeout (`TUTOR_LLM_TIMEOUT_SECONDS`), and a provider that just failed is skipped for a minute. `app/sessions/writer.py` uses it to write explanations, hints and re-teaches from one authored course passage; no prompt ever contains an answer key, and a hint that states the expected output is replaced by a generic one. If no key is set, or a call fails, the session shows the authored course text instead and never breaks. Whatever was shown at each point is saved in `tutor.session_texts` (so a refresh shows the same words, and the faithfulness gate in P3 has the exact text to check). Generated text is labelled in the API (`text_source: generated`) and in the interface until that gate exists.

## Gamification

Levels, bonus XP, badges, streaks and topic quests sit on top of the checkpoint points. Every value is in `app/gamification/progression.py` and written up, with the rules behind them, in [`docs/c3/gamification-spec.md`](../../../docs/c3/gamification-spec.md); a unit test fails if the two disagree. The rewards are identical in both study conditions (mastery-gated and points-only): only what XP may unlock differs.

| Piece | What it does |
|---|---|
| `app/gamification/progression.py` | Pure rules: the ten levels, the five bonuses, the ten badges, streak counting, what makes a run flawless |
| `app/sessions/rewards.py` | Applies them to a real student's history after an answer or the end of a session, and pays each bonus once |
| `tutor.xp_events` | Bonus XP. `(user_id, kind, ref)` is unique, so a replayed request can never pay twice |
| `tutor.user_badges` | Which badges a student holds and when they earned them |

Answer and continue responses carry a `rewards` object (XP gained, bonuses, badges, level, level-up) so the screen can celebrate exactly what was earned; a finished session's summary lists them again. A "day" for streaks follows `TUTOR_TIMEZONE`.

## Practicals

The authored code questions (39 of them) are also offered as hands-on practicals: the student writes a Java program, runs it against the sample, and submits it to be marked against hidden tests.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/tutor/practicals?module_id=prog` | Every practical with whether it is ready and how the student stands |
| GET | `/api/v1/tutor/practicals/{id}` | The statement, starter code, visible samples and the student's last submission |
| POST | `/api/v1/tutor/practicals/{id}/run` | Compile and run the code on the student's own input. Nothing is recorded |
| POST | `/api/v1/tutor/practicals/{id}/submit` | Run against every test, record the attempt, and pay the practical bonus once on a first pass |

How it works:

- Programs read stdin and print to stdout. The tests come from the question's reference solution: the sample inputs from the statement plus a few extra inputs proposed by the model (the model only proposes inputs, never expected answers). Expected output is whatever the reference solution prints, so a wrong test cannot be invented.
- `app/practicals/runner.py` defines `CodeRunner`. `LocalJavaRunner` compiles and runs with the JDK on the machine, in a throwaway folder, with time, memory and output limits, and kills the whole process tree on a timeout. **It is a development runner, not a sandbox**: student code runs as the user who started the service. The isolated Piston runner (phase P4) replaces it behind the same interface.
- Build the tests once, then check them: `uv run python -m app.practicals.cli build-tests` and `uv run python -m app.practicals.cli status`.
- Settings: `TUTOR_PRACTICALS_RUNNER` (`local` or `off`) and `TUTOR_PRACTICALS_RUN_TIMEOUT` (seconds per run). Tables: `tutor.practical_tests` and `tutor.practical_attempts` (migration 0008).
- Not built yet: free-text (explain) grading, generated practicals, and feeding practical attempts into `tutor.v_attempt_outcomes`.

## Lecturer-managed practicals

Lecturers can replace the code practicals students see, without editing the course Markdown. This covers only the Practicals section: the questions inside guided sessions are untouched.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/tutor/author/practicals?concept_id=` | What students see now, drafts waiting for a decision, and the history of replaced or rejected ones |
| GET | `/api/v1/tutor/author/practicals/{id}` | One practical in full: statement, reference solution, every test, and its history |
| POST | `/api/v1/tutor/author/drafts` | Add a draft (`replaces` names the practical it would take the place of) and check it |
| POST | `/api/v1/tutor/author/drafts/{id}/edit` | Change a draft and check it again |
| POST | `/api/v1/tutor/author/drafts/{id}/approve` | Replace the practical in that place with the draft |
| POST | `/api/v1/tutor/author/drafts/{id}/reject` | Turn a draft down, with a note |
| POST | `/api/v1/tutor/author/practicals/{id}/restore` | Bring a replaced practical back |
| POST | `/api/v1/tutor/author/generate` | Ask the model for `count` (1 to 6) drafts of a concept, optionally aimed at named practicals and steered by a `hint`. Returns a job at once (202) |
| GET | `/api/v1/tutor/author/jobs/{id}` | Progress of a generation job and the drafts it has made so far (`/jobs` lists recent ones) |
| POST | `/api/v1/tutor/author/drafts/bulk-approve`, `bulk-reject` | Decide on many drafts at once; each is judged on its own, so one that cannot be approved does not stop the rest |

Lecturers only (`403 lecturers_only`), and any lecturer may approve. These responses carry reference solutions and hidden tests, so no student route returns them.

- **Replacing, not adding.** The authored course stays the source of truth. A row in `tutor.assessment_items` (migration 0009) overlays it, and `app/practicals/catalog.py` merges the two into the same `BankEntry` objects the student screens already use, so listing, running, marking and rewards needed no special case.
- **Nothing is lost.** When an authored practical is replaced it is copied into the database first, with who replaced it and when. Its tests and every attempt stay where they were.
- **Places ("slots").** Each practical fills a slot, named by the authored question's id, and replacements join that slot. A student who cleared a practical keeps that credit when it is replaced, and the practical bonus is paid once per slot, so nobody is paid twice. The database allows one approved item per slot.
- **Checks before approval** (`app/practicals/authoring.py`): the solution is a runnable program; it uses no file, network, process or reflection APIs (such a solution is never run); it compiles; it prints exactly the sample shown in the statement; hidden tests exist; and it gives the same answers when run twice. A failed check blocks approval; a warning does not.
- **Generating drafts** (`app/practicals/generator.py`, `generation.py`, `jobs.py`). The model is given the concept's course text, the practicals that already exist, and an optional lecturer hint, and returns a task description, one sample INPUT, a reference solution and the skills the task needs. It is never asked for the sample output: that is produced by running the solution, so a wrong number written by the model cannot reach a student. The draft then gets the checks above plus three more: `taught_scope` (each needed skill is checked by the faithfulness gate's NLI model against what the course teaches for this concept and what it builds on), `constructs` (Java features the course has not introduced yet, such as streams or collections) and `duplicate` (word overlap with the concept's other practicals). These three are warnings for the lecturer to weigh, except that a task whose skills are nearly all missing from the course fails. The NLI threshold is the gate's, which was measured on explanation text and not on task skills, so expect some false alarms.
- **Background jobs.** A request becomes a job (`tutor.assessment_jobs`, migration 0010) that makes one draft at a time and saves each as soon as it is ready; a job lost in a restart is reported as failed after 45 minutes. One worker thread runs them in turn. A draft takes about half a minute and a few model requests, so a batch of six can use a noticeable share of a free daily quota. If the model cannot be reached the job keeps the drafts it already made and stops.
- **Command line.** `uv run python -m app.practicals.cli generate --concept prog.loops --count 2` shows drafts and their checks without saving; add `--save` to keep them as drafts for a lecturer.
- **Lecturer screens.** The Practical studio (`/studio`, lecturers only) generates drafts, shows each with its checks and a preview of the task, solution and tests, and approves or rejects one at a time or in bulk. It also lists what is live now, and the history with a Restore button.
- **Safety.** The local runner is not a sandbox, so generated code is checked for dangerous APIs before it is run, only lecturers can start generation, and nothing reaches students until a lecturer approves it. The Piston runner should still come before wide use.
- **Not built yet:** generated predict-the-output and multiple-choice questions, and checking generated tests against deliberately wrong solutions.

## Live and cached explanations

`TUTOR_EXPLANATION_MODE` decides how a student's explanations are made. It is read when the service starts.

| | `live` (default) | `cached` |
|---|---|---|
| Where text comes from | Written for that student, when they ask for the part or just before, while they read the part before | The shared, checked explanations that `prebuild` fills |
| Shared between students | Never. A job and its text belong to one session | Yes, by passage |
| Model calls per part | 3 to 9, per student | None when the cache has it |
| Giving up | After the gate has blocked 3 texts or the model has failed 5 times | After 1 try and 1 rewrite |

**Live mode.**
- **Counting.** A round is one model call and its check, including the step that cuts the failing sentences and checks what is left. A round the gate rejects is a block (`TUTOR_GATE_MAX_BLOCKS`, 3). A failed model call, or an empty or over-long reply, is a failure (`TUTOR_LLM_MAX_FAILURES`, 5). The two are counted apart. Failures wait 1, 2, 4, 8 seconds between tries (`TUTOR_LLM_RETRY_BACKOFF_SECONDS`).
- **Quota.** If the model says its daily quota is used up, trying again cannot help, so it stops at once and the course text is shown. A per-minute limit is retried like any other failure.
- **When it gives up** the student sees the authored course text, kept for the rest of the session. It is labelled as rejected only when the gate was the reason, not when the model could not be reached.
- **Prefetch.** While a student reads one part, the next is written for them and stored in their own session, so the click usually finds it ready. No other student can ever be shown it. Nothing is read from or written to the shared cache.
- **Stubborn passages.** A passage the gate keeps rejecting is left alone for `TUTOR_FAILURE_MEMORY_SECONDS` (30 minutes) for every student, so each one does not wait through three rounds. An unreachable model is retried after 2 minutes and a used-up quota after 10.
- **Waiting.** A click waits up to `TUTOR_FILL_WAIT_SECONDS` (240) and shows a progress card meanwhile.
- **Cost.** Every student pays for every part, so a free daily quota (500 requests) is used up quickly. Plan for a paid key.

**Cached mode** is the earlier behaviour, unchanged: the shared cache is read first, a miss is written once for everyone, and `prebuild` can fill it ahead of time. The cache table and `prebuild` stay in live mode so the two can be compared; `prebuild` always uses its own "so many tries" rule whatever the mode.

The gate, its threshold and the retrieval of related passages are the same in both modes. Every verdict is logged to `tutor.gate_events` in both.

## Faithfulness gate

Generated text is checked against the course passage it came from before a student sees it (`app/verification/`). The method, the numbers behind the settings and their limits are in `research/c3-RAG tutor/README.md`; this is how to run it.

| Piece | What it does |
|---|---|
| `claims.py` | Splits a response into claims (model-written atomic claims, or sentences if the model fails) and checks that any code lines come from the passage's own code. `passage_windows` gives the short stretches of a passage used as extra evidence |
| `nli.py` | The NLI model (`TUTOR_NLI_MODEL`, a DeBERTa-v3 fact-verification model, forced to float32). Loaded in the background at start-up |
| `gate.py` | PASS only if every claim reaches `TUTOR_GATE_THRESHOLD` on P(entailment). One unsupported claim blocks the response |
| `cli.py` | `prebuild` and `status`, below |

What a student sees (`text_check` in the session API): `verified` (generated and passed), `blocked` (the model's wording failed twice, so this is the course text), `unchecked` (generated while the gate is off), or null (authored course text). Every verdict is logged to `tutor.gate_events`, and a passed explanation or re-teach is shared with every later session through `tutor.verified_explanations`, keyed on the passage text, prompt, model and gate settings.

**Explanations are built with retrieval.** An explanation of one part is not written from that part alone. `app/sessions/grounding.py` asks the hybrid retriever (the index the evaluation measured) for the course material most related to it within the concept, and the best three passages, such as an example, a common mistake or the quick facts, go to the model as support. The gate accepts a claim that the main passage or any retrieved one supports, and the screen shows what the text was built from ("Built from the course index"). If the index is not available on a machine, the explanation falls back to the main passage alone.

**Clicking Continue prepares the part, and it is shown only when it has passed.** If no verified explanation exists yet for the next part, the request retrieves the related passages, has the model write the explanation and checks it, then returns the finished text. While that runs the screen shows a progress card (finding passages, writing, checking); it never shows course text first and swaps it later. To keep the wait short, the next part is prepared in the background while the student reads the current one (`app/verification/fill.py`), so a click is usually instant and only a quick reader waits. A part the checker rejects after two attempts and a trim shows the course text, labelled as such, and a part that just failed is not retried for ten minutes. A session can also be read backwards: `GET /sessions/{id}/history` returns the parts already read, as the student saw them, without moving the session.

**A failed check removes the failing sentence, not the whole explanation.** After the regeneration also fails, the sentences that carry the unsupported claims are cut and what remains is checked again by the same gate; it is shown only if it passes. If a claim cannot be matched to a sentence, too much would go, or the text contains code that is not in the course, the explanation is dropped instead.

**Run `prebuild` before real use.** Checking one explanation takes about 20 s on a CPU and a model call or two, and a strict gate passes only some first attempts, so doing it while a student waits is slow and rate-limit-prone. Prebuild does it once, ahead of time, with up to four attempts per passage:

```bash
uv run python -m app.verification.cli prebuild --attempts 4 --pause 3   # resumable
uv run python -m app.verification.cli status                            # what is still missing
```

A change to the course text, the prompt, the model, the retrieval or any gate setting changes the cache key, so run `prebuild` again afterwards. Passages the gate keeps blocking are reported and left uncached; students then see the authored text for them. Changing the threshold, windows, prompt, decomposer or model changes the cache key, so run `prebuild` again afterwards. The Gemini free tier allows 500 requests a day; a full prebuild is about two requests per attempt, so it can take more than one day on the free tier.

## Schemas and migrations

This service owns two schemas: `content` (indexed course material: `units`, `chunks`) and `tutor` (runtime data: `gate_events`, `sessions`, `checkpoint_attempts`, `session_texts`, and the published view `v_attempt_outcomes`). Both are migrated from here, with the Alembic version table in `tutor`:

```bash
uv run alembic upgrade head     # apply
uv run alembic check            # fails if app/db/tables.py and the migrations disagree
```

Migrations use `TUTOR_MIGRATION_DATABASE_URL` (Neon's direct endpoint) when set, otherwise `DATABASE_URL`.

`content` concept IDs are plain text, not foreign keys into `core.concepts`: the indexer rejects unknown IDs, and a foreign key would also stop the seed script pruning a renamed concept.

Reading `core` directly is allowed. Architecture rule 4 makes `core` the one exception to view-only access, because it is shared reference data nobody but the leader writes.

## What the catalogue deliberately does not do

It computes no mastery, decides no unlock order and derives no prerequisite
structure. Mastery belongs to C1 and is consumed from `curriculum.v_mastery`
from phase P7; until then a concept carries its seeded prerequisite IDs and
nothing about the learner's progress. `app/domain/catalogue.py` says so at the
top, so nobody later mistakes it for the unlock logic.

## Run it

```bash
uv sync
cp .env.example .env          # paste your Neon pooled connection string
uv run uvicorn app.main:app --reload --port 8301
```

The `core` data the catalogue reads comes from `database/`:

```bash
cd database/core && alembic upgrade head
python database/seed/seed_concepts.py
```

## Tests

```bash
uv run pytest                                      # no database needed
uv run ruff check . && uv run ruff format .
```

## Build phases

P0 foundation, P1 content and retrieval, P2 generation and sessions, P3
faithfulness gate (PP1, Jan 2027), P4 practicals and grading, P5 gamification
and dashboard, P6 evaluation and experiments (PP2, Mar 2027), P7 integrations,
P8 hardening. Integrations with C1, C2 and C4 are deliberately last; stubs until
then, selected by `INTEGRATION_MODE`.
