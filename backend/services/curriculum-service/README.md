# curriculum-service (C1)

C1 Adaptive Curriculum Engine.

> **P0 scaffold, created by the project leader so the student dashboard has real
> data to render.** This service belongs to C1. The current routes are a
> read-only catalogue over the shared `core` tables and compute nothing: no
> concept graph, no BKT mastery, no next-topic decision. C1 replaces and extends
> them, and owns every file here from now on.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/api/v1/curriculum/modules` | Modules with topic and concept counts |
| GET | `/api/v1/curriculum/modules/{module_id}/concepts` | Concepts grouped by topic, in teaching order |

Reading `core` directly is allowed: architecture rule 4 makes `core` the one
exception to view-only access. Anything C1 *derives* (mastery, ordering) belongs
in the `curriculum` schema and is published to C3 as `v_mastery` and
`v_next_topic`.

## Run it

```bash
uv sync
cp .env.example .env          # paste your Neon pooled connection string
uv run uvicorn app.main:app --reload --port 8101
```

The `core` data these routes read is created and seeded from `database/`:

```bash
cd database/core && alembic upgrade head
python database/seed/seed_concepts.py
```

## Still to build (C1)

- `curriculum` schema and its own Alembic setup
- Concept graph in Neo4j, built from `content.v_unit_manifest`
- BKT mastery from `tutor.v_attempt_outcomes`
- Published views `curriculum.v_mastery` and `curriculum.v_next_topic`
