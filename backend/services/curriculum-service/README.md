# curriculum-service (C1)

**C1 Adaptive Curriculum Engine**: explainable, prerequisite-aware topic
sequencing. It keeps a directed prerequisite graph of concepts, a Bayesian
Knowledge Tracing (BKT) mastery estimate for every learner and concept, ranks
what each learner is ready to study next with a Graph Attention Network (GAT),
and explains each recommendation by naming the weak prerequisite behind it. It
also owns the pre-test and post-test instruments and the normalised learning
gain calculation.

Owner: Abeyrathne E.D.V.N (IT23265110). Research code and notebooks live in
`research/c1-curriculum/`; nothing there is imported by this service.

## Routes

| Method | Path | Who | Purpose | Status |
|---|---|---|---|---|
| GET | `/health`, `/api/v1/curriculum/health` | public | Liveness | done |

Arriving next: graph, mastery, recommendations, assessments, gain, feedback,
and the lecturer cohort and graph-edit routes.

## Security rules

- Identity arrives as `X-User-Id` and `X-User-Role` from the gateway
  (`app/core/deps.py`). This service never parses a JWT.
- A learner's own data is only reachable through `/me` routes that take the user
  id from those headers, never from the URL or body.
- Staff routes declare `Depends(require_role("lecturer", "admin"))`.
- Development-only routes exist only when `ENVIRONMENT` is not `production` and
  `INTEGRATION_MODE=stub`. Production also hides `/docs` and `/openapi.json`.
- Bind to `127.0.0.1` (uvicorn's default). Anyone who can reach this port
  directly could forge the identity headers, so only the gateway may call it.
- Errors always use `{"error": {"code", "message", "details"}}`; unexpected
  exceptions are logged with a traceback and answered with a generic 500.
- Logs are JSON with the gateway's `request_id`; they never contain names,
  emails, answers or tokens.

## Data ownership

- Writes only the `curriculum` schema; reads `core` directly.
- Publishes `curriculum.v_mastery` and `curriculum.v_next_topic` (see
  `contracts/views/`). Other services read those views, never the tables.
- The prerequisite graph lives in Neo4j; a copy is kept in Postgres so a Neo4j
  outage cannot stop recommendations.

## Run it

```bash
uv sync
cp .env.example .env          # paste your Neon pooled connection string
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8101
```

Through the gateway: `http://localhost:8080/api/v1/curriculum/health`.

## Tests

```bash
uv run pytest                                      # no database needed
uv run ruff check . && uv run ruff format .
```
