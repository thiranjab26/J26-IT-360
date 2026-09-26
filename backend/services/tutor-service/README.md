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
| GET | `/api/v1/tutor/modules` | Modules the learner can study | P0 |
| GET | `/api/v1/tutor/modules/{module_id}/concepts` | Concepts grouped by topic, in teaching order | P0 |

Everything below needs an authenticated caller: identity arrives as `X-User-Id`
and `X-User-Role` from the gateway. This service never parses a JWT and never
holds the signing secret.

Arriving with later phases: sessions (start, next, answer, end, resume),
practicals, progress and XP, content admin, and the internal `/internal/load`
receiver for C2's signal.

## Schemas

This service owns two schemas, `content` and `tutor`, both migrated from inside
this service once it has tables of its own. There is no Alembic setup yet
because P0 adds no tables: the catalogue reads the shared `core` tables, which
`database/core` migrates.

Reading `core` directly is allowed. Architecture rule 4 makes `core` the one
exception to view-only access, because it is shared reference data nobody but the
leader writes.

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
