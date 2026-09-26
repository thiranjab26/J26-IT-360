# Onboarding

Read this once, end to end, before writing code. It should take about 30 minutes including setup.

## 1. Understand the shape of the system

Read, in order:

1. [../README.md](../README.md) for the map and the five collaboration rules.
2. [architecture.md](architecture.md) Sections 1 to 6. These are not suggestions: CI and the review process enforce most of them.
3. The design doc for your own component under `docs/c<n>/` if one exists.

The one idea that explains every other rule: **four people share one database and one frontend app, so every boundary is made explicit.** Your service owns a Postgres schema and a frontend feature folder. Everything you expose to the others is a view or a documented payload in `contracts/`. Everything you consume from them is read through their view, behind a stub, so you are never blocked by their progress.

## 2. Claim your ownership

| You own | Where |
|---|---|
| One backend service | `backend/services/<your>-service/` |
| One frontend feature | `frontend/src/features/<your-feature>/` |
| One or more DB schemas | see the table in `architecture.md` Section 4 |
| Your research artefacts | `research/c<n>-<name>/` |

Add yourself to [../.github/CODEOWNERS](../.github/CODEOWNERS) in your first PR.

## 3. Install the toolchain

Follow **Prerequisites** and **First-time setup** in [../README.md](../README.md). Stop when `GET http://localhost:8080/api/v1/<your-service>/health` returns `{"status": "ok"}` through the gateway. That is the P0 exit criterion for you personally.

## 4. Get your own database

We share one Neon project, but each member develops on their **own Neon branch**, so a bad migration never breaks anybody else.

1. Ask the leader for access to the Neon project.
2. Create a branch named after you (for example `dev-tharindu`).
3. Copy its connection string into your service's `.env` as `DATABASE_URL`.
4. Run `uv run alembic upgrade head` inside your service. It migrates only your schema, using a version table inside that schema.

The shared `core` schema (users, roles, modules, topics, concepts) is migrated from `database/` by the leader. You read it; you do not write it.

## 5. Create your service from the template

Your service directory starts empty apart from a `.gitkeep`. The reference shape lives in `backend/services/_service-template/`, which documents every folder a service has: `app/api/v1/routes/`, `app/core/`, `app/domain/`, `app/models/`, `app/db/repositories/`, `app/integrations/`, `migrations/versions/`, `tests/unit/`, `tests/integration/`.

Copy it once, then rename four things: the service name, its DB schema, its env var prefix (`TUTOR_`, `CURRICULUM_`, ...) and its port.

Create the subfolders you actually need, when you need them. Do not commit empty directories full of `.gitkeep` files: an empty `repositories/` folder tells a reviewer nothing, and it makes the tree harder to read for everyone else.

## 6. Day-to-day workflow

```bash
git switch dev && git pull
git switch -c c3/feat/nli-gate          # <component>/feat/<topic>
# ... work, commit as feat(tutor): ...
git push -u origin c3/feat/nli-gate     # then open a PR into dev
```

Before pushing, run your service's checks:

```bash
uv run ruff check . && uv run ruff format . && uv run pytest    # Python service
pnpm --filter frontend lint && pnpm --filter frontend typecheck  # frontend work
```

CI is path filtered, so a change under `tutor-service/` only runs C3's pipeline.

## 7. When you need something from another component

Do **not** call their service and do **not** query their tables.

1. Check `contracts/views/` for an existing view that gives you the data.
2. If none fits, open a PR against `contracts/` describing the view you need, and tag the owner. The PR history is the changelog.
3. Build against a stub in your `app/integrations/` package with `INTEGRATION_MODE=stub` until the producing side is live.

Never add a second way to get the same data. One contract per flow.

## 8. What needs team approval

Propose and wait for the affected owners before touching:

- `contracts/` (view shapes, the load-signal schema)
- `database/core/` migrations and `database/seed/`
- `frontend/src/shared/`
- root config (`package.json`, `pnpm-workspace.yaml`, `.gitignore`, CI workflows other than your own)

## 9. Conventions you will be reviewed against

- Routes under `/api/v1/<service>`; internal-only routes under `/internal/*` and never exposed by the gateway.
- `GET /health` returns `{"status": "ok"}`.
- Errors: `{"error": {"code": "...", "message": "...", "details": {}}}`.
- Business logic in `app/domain/` (or your component's layer packages) with no FastAPI imports.
- Env vars prefixed per service (`TUTOR_`, `CURRICULUM_`, `LOAD_`, `VIVA_`) and listed in `.env.example`.
- JSON logs carrying the `request_id` forwarded by the gateway.
- Frontend features import other features only through their `index.ts`.
- No em dashes in docs, comments or UI copy.

## 10. Local AI assistant files

`CLAUDE.md`, `FIRST_PROMPT.md` and `.claude/` are gitignored. They are each member's personal context for AI tooling and are deliberately kept out of the repository so nobody's prompts end up in review. Keep your own copies locally; do not force-add them.

## 11. Stuck?

Post in the group channel with: what you ran, the full error, and your branch name. If it is a boundary question ("can I read X?"), the answer is almost always "through a view, behind a stub, after a contracts PR".
