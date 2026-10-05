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

`index` is incremental: it embeds only chunks that are new or whose text or heading changed, so re-running on unedited content embeds nothing (0.1 s) and a full first run takes about 20 s on a laptop CPU. The vectors live in `.chroma/` (gitignored, private to this service), in one collection per module and model, for example `content_prog__bge-small-en-v1-5`.

The default model is `BAAI/bge-small-en-v1.5` (`TUTOR_EMBEDDING_MODEL`). It reads 512 tokens per chunk; `all-MiniLM-L6-v2` reads only 256 and measured 13% of our chunks over that, including 44% of theory and 77% of facts, so their ends would have been silently unsearchable. `index` warns if any chunk exceeds the model's window, so a longer unit or a model swap cannot reintroduce this unnoticed. Because collections are per model, a second model can be indexed alongside the first for the evaluation.

Run `check` after editing any markdown file. It fails on a question with no solution, a free-form question with no rubric, a prerequisite taught later than the concept, or a concept ID or prerequisite list that disagrees with `core`. `sync` refuses to write while any of those are open, and only rewrites units whose file actually changed.

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
