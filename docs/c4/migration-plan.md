# C4 migration plan: standalone demo into J26-IT-360

Owner: R. J. Vanderheyden (C4 Intelligent Viva System)
Branch: `feature-c4-viva-system`, merged into `c4-viva-dev` when stable, then a PR into `dev`.
Source (reference only, never committed): `Desktop/Research Project/Astra Prototype/Astra version 2/adaptlearn-c4`

## Goal

Bring the working C4 viva demo into this monorepo so it follows the repo's own structure and rules
(`README.md`, `docs/architecture.md`, `docs/onboarding.md`, `docs/adr/`, `contracts/`).
The research logic is kept as it is. Only the outer layer (login, database, config, routes,
integrations, frontend API calls) is rebuilt the way the repo requires.

## Boundaries

Only these paths may change:

- `backend/services/viva-service/`
- `frontend/src/features/viva/`
- `research/c4-viva/`
- `docs/c4/`
- one line in `frontend/src/app/router.tsx` to mount the viva routes (leader approval in the PR)
- the `@owner-c4` line in `.github/CODEOWNERS` (leader approval in the PR)

No other component's service, feature, schema or shared file is touched.
`.env` files and API keys are never copied or committed.

## Progress

Status key: `[ ]` not started, `[~]` in progress, `[x]` done and approved.

### Step 0. Prepare the toolchain

- [ ] Install `uv` (the repo's Python tool)
- [ ] Install Python 3.11 with `uv python install 3.11` (this laptop has 3.13; the repo pins 3.11)
- [ ] Run `pnpm install` in the repo root (frontend and gateway)
- [ ] Get access to the team Neon project and create a personal branch, then run the README's
      database setup so the `viva` schema exists

### Step 1. Scaffold `viva-service` from the template

- [ ] `pyproject.toml`, `.python-version`, `.env.example` (`VIVA_` prefix, `DATABASE_URL`, `INTEGRATION_MODE`)
- [ ] `app/main.py`, `app/config.py`, `app/core/deps.py`, `app/core/errors.py`, `app/core/logging.py`,
      `app/db/session.py`, `app/api/v1/router.py`, `app/api/v1/routes/health.py`, following `tutor-service`
- [ ] `README.md` for the service
- [ ] Check: `uv run pytest`, `uv run ruff check .`, and `GET /api/v1/viva/health` returns `{"status": "ok"}`

### Step 2. Port the research logic

- [ ] `app/domain/policy.py`: six answer states and the fixed follow-up policy
- [ ] `app/domain/gap.py`, `app/domain/hesitation.py`, `app/domain/report.py`: gap rules v1.3 and the report
- [ ] `app/domain/disfluency.py`, `app/domain/evaluation.py`: filler counting and A/B/C metrics
- [ ] `app/domain/seed_bank.py`: demo questions keyed by seed concept IDs (`dsa.stack`, `dsa.queue`)
- [ ] Port the logic tests to `tests/unit/` and confirm they pass with no change in behaviour

### Step 3. Database tables in the `viva` schema

- [ ] `app/db/tables.py`: question bank, sessions, turns, results, ratings, usage counters
- [ ] Alembic in the service with its version table in `viva`, migration `0001`
- [ ] User IDs are `uuid` values from `core.users`; no own users or tokens table

### Step 4. Integrations (stub and live)

- [ ] `app/integrations/llm.py`: Groq first, Gemini fallback, `VIVA_` keys
- [ ] `app/integrations/speech.py`: Groq Whisper and Silero pauses (optional dependency group)
- [ ] `app/integrations/mastery.py`: stub, or live from `curriculum.v_mastery` (0 to 1)
- [ ] `app/integrations/passages.py`: stub demo notes, or live from `content.v_verified_passages`
- [ ] `app/integrations/load.py`: stub only until a C2 to C4 contract exists

### Step 5. API routes under `/api/v1/viva`

- [ ] Sessions, answers, skip, finish, report, export
- [ ] Speech: transcribe and synthesize
- [ ] Question bank review (lecturer)
- [ ] Rater cases and metrics (lecturer)
- [ ] User from gateway headers (`X-User-Id`, `X-User-Role`); errors in the shared `ApiError` format
- [ ] Port the API tests using gateway headers instead of the demo's tokens

### Step 6. Student screens in `frontend/src/features/viva`

- [ ] `api/vivaApi.ts` with TanStack Query over `shared/api/client.ts`
- [ ] `pages/VivaSetupPage.tsx`, `pages/LiveVivaPage.tsx`, `pages/VivaReportPage.tsx`
- [ ] `components/Mascot.tsx`, `hooks/useSpeech.ts`, `viva.css`
- [ ] `routes.tsx` and `index.ts`; one line in `app/router.tsx`
- [ ] Check: `pnpm --filter frontend typecheck`

### Step 7. Docs and ownership

- [ ] Handover and gap-rule notes in `docs/c4/`
- [ ] `research/c4-viva/README.md` for the A/B/C evaluation material
- [ ] Replace `@owner-c4` in `.github/CODEOWNERS` with the real GitHub username

### Step 8. Verify and hand over

- [ ] `uv run ruff check . && uv run ruff format --check . && uv run pytest`
- [ ] `pnpm --filter frontend typecheck`
- [ ] `git diff --stat origin/dev` lists only the allowed paths above
- [ ] Push `feature-c4-viva-system`, merge into `c4-viva-dev`, open the PR into `dev`

## Decisions taken by default (change any of these)

| Topic | Default used in the port |
|---|---|
| Human raters | Use the existing `lecturer` role; no new role in auth-service |
| Course upload | Dropped. C3 owns course content; C4 reads `content.v_verified_passages` (stubbed for now) |
| Demo topics | Stacks and queues kept as `dsa.stack` and `dsa.queue`. OOP and databases need new seed concept IDs first (seed PR) |
| C2 cognitive load | Stub only; no contract exists for C4 yet |
| C1 review notification | Recorded in `viva`; publishing a `viva.v_review_flags` view needs a contracts PR |
| PP1 demo (11 Oct) | Run from the original `adaptlearn-c4` folder while the port continues |

## Log

| Date | Step | What happened |
|---|---|---|
| 2026-10-07 | Plan | Plan written. Branch `feature-c4-viva-system` checked out, identical to `dev`. `uv` and Python 3.11 not yet installed |
| 2026-10-07 | Specs | Recreation specs written: docs/c4/README.md, spec-domain.md, spec-backend.md, spec-frontend.md |

## Status after the recreation (2026-10-07)

The demo was recreated in one pass on `feature-c4-viva-system`. Nothing is committed or pushed.

Done:

- [x] `backend/services/viva-service` in the template layout (`app/api/v1/routes`, `core`, `db`, `domain`, `integrations`, `models`), routes under `/api/v1/viva`, port 8401
- [x] Settings prefixed `VIVA_` (shared `DATABASE_URL`, `ENVIRONMENT`, `LOG_LEVEL`, `INTEGRATION_MODE`), `.env.example`, and a local `.env` (gitignored)
- [x] All tables in the `viva` schema; Alembic with its version table in `viva` and migration `0001` (tested up and down)
- [x] Shared error format, JSON logging from tutor-service, `pyproject.toml` for Python 3.11, ruff clean
- [x] All 55 demo tests ported to `tests/unit` and `tests/integration`, passing
- [x] `frontend/src/features/viva` (`api/`, `pages/`, `components/`, `hooks/`, `styles/`, `routes.tsx`, `index.ts`), styles scoped to `.viva-app`, typecheck and build pass
- [x] Mounted at `/viva` in `frontend/src/app/router.tsx`; `lucide-react` added to `frontend/package.json`
- [x] `docs/c4/handover.md`, `docs/c4/demo-history/`, `research/c4-viva/README.md`, service `README.md`
- [x] Live check: health, login, topics, session start and one AI-marked answer against Neon

Kept on purpose (user decision):

- The viva's own participant and staff login (`app/core/auth.py`, `viva.users`, `viva.auth_tokens`). The frontend calls viva-service directly at `VITE_VIVA_API_URL` (default `http://localhost:8401`) because the gateway only accepts shared-login tokens. Replace with the shared login later.
- The course upload screen, the 4 demo topics (stacks, queues, oop, databases) and the HTTP adapters for C1 to C3, as in the demo.

Still to do:

- [ ] Install `uv`, then `uv sync --extra speech` and `uv lock` in viva-service (tests were run with the demo's Python environment)
- [ ] Team Neon branch: today `.env` points at the demo's own Neon database (a `viva` schema was created there)
- [ ] Replace `@owner-c4` in `.github/CODEOWNERS` with the GitHub username
- [ ] Later: shared login through the gateway, seed concept IDs for topics, contracts for C1, C2 and C3 views
