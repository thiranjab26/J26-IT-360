# AdaptLearn

Personalized learning intelligence platform for higher education. Final-year group research project **J26-IT-360** (SLIIT). Four research components, four owners, one monorepo.

| Component | Owner | Service | Frontend feature | Port |
|---|---|---|---|---|
| C1 Adaptive Curriculum Engine | TBD | `backend/services/curriculum-service` | `features/curriculum` | 8101 |
| C2 Cognitive Load Detection | TBD | `backend/services/load-service` | `features/cognitive-load` | 8201 |
| C3 VeriTutor (faithfulness-verified AI tutor) | TBD | `backend/services/tutor-service` | `features/tutor` | 8301 |
| C4 Intelligent Viva System | TBD | `backend/services/viva-service` | `features/viva` | 8401 |
| Shared (leader) | TBD | `api-gateway`, `auth-service` | `features/auth`, `shared/` | 8080, 8001 |

Full design: [docs/architecture.md](docs/architecture.md). Start here: [docs/onboarding.md](docs/onboarding.md).

## How the pieces fit

```
Browser -> frontend (5173) -> api-gateway (8080) -> your service -> Neon Postgres (one schema per owner)
```

The browser only ever talks to the gateway. The gateway verifies the JWT and forwards `X-User-Id`, `X-User-Role` and `X-Request-Id`. Services never parse JWTs. Cross-component data is read through published `v_*` views, never another owner's raw tables. The only pushed API between components is the C2 load signal to C3.

## Prerequisites

| Tool | Version | Needed by |
|---|---|---|
| Git | any recent | everyone |
| Node.js | 20 LTS | everyone (frontend, gateway) |
| pnpm | 9.x (`npm i -g pnpm`) | everyone |
| Python | 3.11 | everyone (your service) |
| uv | latest ([install](https://docs.astral.sh/uv/getting-started/installation/)) | everyone |
| Neon account | free tier | everyone (your own DB branch) |
| Neo4j | Aura free or Desktop | C1 only |
| Ollama | latest | C3 only |
| Docker | latest | C3 only, from phase P4 (Piston code runner) |

Nothing else needs Docker. C3's Piston sandbox is the single exception and lives inside `backend/services/tutor-service/piston/`.

## First-time setup

```bash
git clone https://github.com/thiranjab26/J26-IT-360.git
cd J26-IT-360
pnpm install                      # frontend + gateway, one lockfile
```

**Database, once per Neon branch.** Ask the leader for Neon access and create
your own branch, then:

```bash
cp database/.env.example database/.env     # paste your branch's DIRECT url
cd database/core && uv run --with alembic --with sqlalchemy --with "psycopg[binary]" alembic upgrade head
cd ../.. && uv run --with sqlalchemy --with "psycopg[binary]" python database/seed/seed_concepts.py
```

That creates the `core` tables and seeds 2 modules, 12 topics, 25 concepts and
39 prerequisite edges from `database/seed/*.csv`. Check the CSVs
parse before touching the database with `python database/seed/seed_concepts.py --dry-run`.

**Each service you run** needs its own `.env` (copy its `.env.example` and paste
your Neon *pooled* url):

```bash
cd backend/services/<service>
uv sync
cp .env.example .env
uv run uvicorn app.main:app --reload --port <port>
```

## Running it

Nobody runs the whole platform. Today's screens need four processes:

```bash
pnpm --filter frontend dev                                      # 5173
pnpm --filter api-gateway dev                                   # 8080
cd backend/services/auth-service  && uv run uvicorn app.main:app --reload --port 8001
cd backend/services/tutor-service && uv run uvicorn app.main:app --reload --port 8301
```

Then open http://localhost:5173, register as a student, and you land on a
dashboard listing both modules; clicking one shows its concepts grouped by topic.

Once your own component has a service, that is the only extra process you run.
Services that are not running return a clean 503 from the gateway naming the
service and the command to start it. Other components' data comes from stubs
(`INTEGRATION_MODE=stub`) until the integration phase.

`api-gateway`'s `JWT_SECRET` must be byte-identical to `auth-service`'s
`AUTH_JWT_SECRET`, since auth signs the token the gateway verifies.

## What works today

| Area | State |
|---|---|
| `core` schema and concept seed | Live on Neon. 2 modules, 12 topics, 25 concepts, 39 prerequisite edges |
| `auth-service` | Register (student and lecturer, separate endpoints), login, `/me`. bcrypt + JWT |
| `api-gateway` | JWT verification, header forwarding, five proxy routes, 503 fallback, `/internal/*` blocked |
| `tutor-service` (C3) | Learner catalogue, plus the content pipeline: parses and chunks the Java course material (581 chunks) into `content.units` and `content.chunks`. Chunks are embedded locally into ChromaDB (`bge-small`). Retrieval with per-use access rules is next |
| `frontend` | Login, register, module picker (Programming open, DSA coming soon), quest-map view of a module's topics |
| C1, C2, C4 services | Not started. Directory placeholders, owned by their members |

The learner catalogue lives in **tutor-service** because C3's owner is also the
project leader, so the learner-facing basics sit with the component that builds
the learner experience. Nobody has touched another member's service.

## Repository map

Seven directories. That is the whole repository.

```
.github/     CI workflows (path filtered per service), CODEOWNERS, PR template
frontend/    one React app, one feature folder per owner
backend/     services/: api-gateway, auth-service, _service-template, four component services
database/    shared schemas, service roles, core migrations, concept seed data
contracts/   the agreed shape of everything that crosses a component boundary
research/    notebooks, labelling tools, experiments; never imported by a service
docs/        architecture, onboarding, ADRs, per-component design docs
```

Folders are created when code goes into them, so the tree stays readable. The full internal shape of a service is documented once, in `backend/services/_service-template/`; copy it when you start yours. Anything private to one service (C3's `.chroma/` vector store, its Piston runner) lives inside that service, not at the root.

Every environment variable is documented in the `.env.example` of the service that reads it. There is no central env file to keep in sync.

## The five rules that keep four people out of each other's way

1. Edit only your own service and your own frontend feature.
2. Write only to your own database schema. Read others through their `v_*` views.
3. Changes to `contracts/`, `database/core/`, `database/seed/` or `frontend/src/shared/` need approval from every affected owner. Propose, then wait. CODEOWNERS enforces it.
4. Concept IDs come only from `database/seed/`. Never invent one in code or content.
5. Branch from `dev` as `<component>/feat/<topic>` (for example `c3/feat/nli-gate`) and open a PR. `main` is demo-stable and tagged per milestone (`pp1`, `pp2`, `final`).

Commits follow conventional commits with the service as scope: `feat(tutor): add claim decomposer`.

## Project status

Phase **P0 Foundation**. The skeleton, shared conventions and view contracts exist; service code is being scaffolded. P0 is done for you personally when `GET http://localhost:8080/api/v1/<your-service>/health` returns `{"status": "ok"}` through the gateway, against your own Neon branch. See the phase table in [docs/architecture.md](docs/architecture.md).
