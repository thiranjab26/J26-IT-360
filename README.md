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

# 1. JS side (frontend + gateway), from the repo root
pnpm install

# 2. Your own Python service
cd backend/services/<your>-service
uv sync
cp .env.example .env          # paste your own Neon branch connection string
uv run alembic upgrade head   # migrates only your schema
uv run uvicorn app.main:app --reload --port <your port>
```

Nobody runs the whole platform. Each member runs exactly three processes:

```bash
pnpm --filter frontend dev                                   # http://localhost:5173
pnpm --filter api-gateway dev                                # http://localhost:8080
uv run uvicorn app.main:app --reload --port <your port>       # your service
```

Services that are not running return a clean 503 from the gateway. Other components' data comes from stubs (`INTEGRATION_MODE=stub`) until the integration phase.

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
