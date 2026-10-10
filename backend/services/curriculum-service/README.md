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
| GET | `/api/v1/curriculum/graph?module=dsa` | signed in | Prerequisite graph: concepts with depth, edges, stats; a module view keeps its cross-module prerequisites | done |
| GET | `/api/v1/curriculum/me/mastery?module=prog` | signed in | My BKT mastery per concept (`null` = no evidence yet) | done |
| GET | `/api/v1/curriculum/me/recommendation?module=dsa` | signed in | Next concept, one-sentence explanation, locked concepts and their weak prerequisite (`rules-v1`); syllabus order for the comparison group | done |
| GET | `/api/v1/curriculum/me/tests?module=prog` | signed in | Current phase, which test is open, my results (never my group) | done |
| POST | `/api/v1/curriculum/me/tests/{pretest\|posttest}/start?module=prog` | signed in | Start or resume my test; questions without answers | done |
| POST | `/api/v1/curriculum/me/tests/{pretest\|posttest}/submit?module=prog` | signed in | Submit once, scored on the server; a repeat returns the stored result | done |
| GET | `/api/v1/curriculum/me/gain?module=prog` | signed in | My normalised gain overall, per topic and per concept | done |
| GET | `/api/v1/curriculum/study/{module}/overview` | lecturer, admin | Class progress per concept in syllabus order: learners, mastered, mean mastery; group sizes and test progress (counts only, no learner ids) | done |
| POST | `/api/v1/curriculum/graph/edits` | lecturer, admin | Add or remove a prerequisite link with a reason; refused if it creates a loop; new graph version (`v0-core+e1`, ...) | done |
| GET | `/api/v1/curriculum/graph/audit?limit=50` | lecturer, admin | Every graph change: who, when, what, why, previous version | done |
| GET, PUT | `/api/v1/curriculum/study/{module}/window` | lecturer, admin | Read or set the phase: closed, pretest, learning, posttest, finished | done |
| GET | `/api/v1/curriculum/study/{module}/gain` | lecturer, admin | Gain per learner and per group (mean g and class g) | done |
| GET | `/api/v1/curriculum/study/{module}/snapshot-validation` | lecturer, admin | Mastery at post-test start vs post-test answers: AUC, Brier, accuracy at 0.70 | done |
| GET | `/api/v1/curriculum/me/practice/next?concept=prog.loops` | signed in, stub mode only | C3 stand-in: my next practice question (least tried first, options in my own order, no answer) | done |
| POST | `/api/v1/curriculum/me/practice/hint` | signed in, stub mode only | Show the hint; logged on the server, so the answer then counts as wrong | done |
| POST | `/api/v1/curriculum/me/practice/answer` | signed in, stub mode only | Checked on the server, written with C3's contract columns, updates my mastery; reveals the right option | done |
| POST | `/api/v1/curriculum/dev/attempts` | signed in, dev + stub only | C3 stand-in: record one practice answer for me and update my mastery | done |

Arriving next: feedback, the lecturer cohort and graph-edit routes, GAT inference.

## Pre/post tests and gain

- `app/domain/assessment.py`: counterbalancing (2 groups x 2 form orders, each new
  learner fills a least-used cell at random; a learner keeps one group across modules
  and only the form order is chosen per module), option order shuffled per attempt
  (stable on resume; answers are mapped back to the original option before scoring and
  stored as the original index), scoring, normalised gain
  `g = (post - pre) / (100 - pre)` (`null` when pre = 100), BKT validity metrics,
  item bank checks.
- `app/domain/study.py`: the rules. A test opens only in its phase; one attempt per
  learner, module and kind; the post-test needs a submitted pre-test; starting the
  post-test freezes mastery in `mastery_snapshot` first. Answered items become BKT
  evidence (`source` = `pretest` or `posttest`, no learning step); blanks score as
  wrong but are not evidence.
- The DSA papers carry a PF prerequisite section (`section = prereq`). It is served
  only on the pre-test, sets starting mastery, and never counts towards a score or gain.
- Item banks contain answer keys, so they stay in `item_bank/` (gitignored);
  `item_bank/example.json` shows the format. Answer keys never leave the service.

## Mastery and recommendations

- `app/domain/mastery.py`: BKT. Practice answers get the learning step; pre-test
  and post-test answers do not (a test only measures). Correct = right on the
  first try without a hint.
- `app/db/mastery_store.py`: reads new attempts from `curriculum.stub_attempt_outcomes`
  (stub mode) or `tutor.v_attempt_outcomes` (live mode), stores every answer in
  `mastery_evidence` with mastery before and after, and keeps `concept_mastery`.
  Reads ingest the learner's new attempts first, so mastery is never stale.
- `app/domain/recommend.py`: `rules-v1`. Ready = every prerequisite mastered
  (>= 0.70); the ready concept with the lowest mastery comes next. When a module
  is blocked by another module (DSA by PF), the weak PF prerequisite comes first.
- Views for other components: `curriculum.v_mastery`, `v_topic_mastery`, `v_next_topic`.

## The prerequisite graph

`app/domain/graph.py` validates the graph (unknown concepts, self-loops,
cycles) and answers prerequisites, dependents, depth and learning order.
`app/domain/graph_loader.py` chooses the copy to use and keeps it in memory:

1. Neo4j, when `CURRICULUM_NEO4J_*` are set (the authoritative graph);
2. the last good copy in `curriculum.graph_snapshot` when Neo4j is unreachable;
3. `core.concept_prerequisites` when Neo4j is not configured or still empty.

`GET /graph` reports which one answered (`source`) and why a fallback happened
(`fallback_reason`).

Lecturer edits (`POST /graph/edits`, `app/domain/graph_edit.py`) build a new graph
that must validate (no loop, no self-link, known concepts), then store it in Neo4j
(when configured) and in `curriculum.graph_snapshot`, with a row in
`curriculum.graph_audit`. This service never writes `core`: without Neo4j the loader
reads the edited snapshot first and `core` only while nobody has edited.

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
cp .env.example .env          # pooled URL, direct URL for migrations, optional Neo4j
uv run alembic upgrade head --sql    # preview the SQL (writes nothing)
uv run alembic upgrade head          # create the curriculum schema (writes)
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8101
```

Through the gateway: `http://localhost:8080/api/v1/curriculum/health`.

Load the graph into Neo4j (needs the Neo4j settings and the migration above):

```bash
uv run python -m scripts.import_graph --dry-run      # validate core, write nothing
uv run python -m scripts.import_graph --version v0   # writes Neo4j, snapshot and audit row
```

Load practice questions for the C3 stand-in (added or updated by item id):

```bash
uv run python -m scripts.import_practice item_bank/practice.json --dry-run
uv run python -m scripts.import_practice item_bank/practice.json     # writes practice_item
```

Load test papers (refuses to replace a paper that learners have already sat):

```bash
uv run python -m scripts.import_tests item_bank/dsa.json --dry-run   # validate, write nothing
uv run python -m scripts.import_tests item_bank/dsa.json             # writes test_paper, test_item
```

## Tests

```bash
uv run pytest                                      # no database needed
uv run ruff check . && uv run ruff format .
```
