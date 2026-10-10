# tutor-service (C3)

**C3 VeriTutor**: faithfulness-verified, gamified, cognitive-load-aware AI tutor.
Owned by the C3 member, who is also the project leader, so this service carries
the learner-facing basics (module catalogue, dashboard data) as well as the
research pipeline.

Design docs: `docs/c3/Implementation-plan.md`, `docs/c3/dsa-module-plan.md`,
`docs/c3/research-methodology.md`, `docs/c3/ui-design-brief.md`.

**Current phase: P0 Foundation.**

## Routes

| Method | Path | Purpose | Phase |
|---|---|---|---|
| GET | `/health` | Liveness | P0 |
| GET | `/api/v1/tutor/modules` | Modules, each `available` or `coming_soon` | P0 |
| GET | `/api/v1/tutor/modules/{module_id}/concepts` | Concepts grouped by topic, in teaching order. `409 module_coming_soon` for a module with no content yet | P0 |

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
| `app/gamification/` | XP per checkpoint passed (`xp.py`), a stand-in mastery estimate behind the interface C1's real one will use (`mastery.py`), and the unlock rules for the study's two conditions (`rules.py`): mastery-gated against points-only, identical except for what opens the next concept |

`content check` flags a question that cannot be turned into structured data as an error, and a level-2 question with no expected-output block (one today: `java_intro` Q6) as a warning, because it then needs a model to mark it.

## LLM providers

`TUTOR_LLM_PROVIDER` selects `gemini` (cloud) or `ollama` (local fallback). Put your key in `TUTOR_GEMINI_API_KEY` in `.env`; it is held as a secret value, so it cannot appear in logs or in a printed settings object, and an empty value counts as not configured. Check `TUTOR_GEMINI_MODEL` against the models Google AI Studio currently offers. The Ollama fallback defaults to `qwen2.5-coder:7b`; on a CPU-only machine generation is slow (the 1.5B model measured 2.6 tokens per second), which matters for the offline-fallback claim. The provider layer that reads these settings is the next P2 piece.

## Schemas and migrations

This service owns two schemas: `content` (indexed course material: `units`, `chunks`) and `tutor` (runtime data: `gate_events` now, sessions and attempts from P2). Both are migrated from here, with the Alembic version table in `tutor`:

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
