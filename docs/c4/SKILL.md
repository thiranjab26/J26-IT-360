---
name: c4-viva
description: Work on the AdaptLearn C4 Intelligent Viva System (viva-service and features/viva) in the J26-IT-360 monorepo. Use for any change to the viva backend, its research rules, its frontend screens, or its docs.
---

# Working on C4 Intelligent Viva System

## When to use

Any task touching `backend/services/viva-service`, `frontend/src/features/viva`,
`research/c4-viva` or `docs/c4`.

## Read first

1. `README.md`, `docs/architecture.md`, `docs/onboarding.md` for the repository rules.
2. `docs/c4/ARCHITECTURE.md` for the component design.
3. The spec for the area you change: `docs/c4/spec-domain.md`, `spec-backend.md` or `spec-frontend.md`.
4. `docs/c4/TODO.md` for current priorities.

## Boundaries

- Change only `backend/services/viva-service/`, `frontend/src/features/viva/`, `research/c4-viva/` and `docs/c4/`.
- Shared files (`frontend/src/app/router.tsx`, `frontend/package.json`, `.github/CODEOWNERS`, `contracts/`, `database/`) need the owner's request and the leader's approval.
- Write only to the `viva` schema. Read other components only through their published views, behind a stub.
- Never read, print, copy or commit `.env` files or API keys.
- Never commit or push unless asked.

## Research invariants (do not change without an explicit request)

- Six answer states: `complete`, `partial`, `superficial`, `incorrect`, `misconception_bearing`, `non_answer`.
- The follow-up action is chosen by the deterministic `policy()`; the model may only word it.
- Three outcomes: `LIKELY_KNOWLEDGE_GAP`, `LIKELY_COMMUNICATION_DIFFICULTY`, `MIXED_INSUFFICIENT_EVIDENCE`.
- Hesitation is supporting evidence only. High hesitation needs 2 signals, and a complete answer needs at least one verbal signal (fillers, hedges, restarts) to count as a communication difficulty.
- Accent, pronunciation and voice quality are never used.
- Any change to the rules bumps `POLICY_VERSION` or `GAP_VERSION` in `app/domain/logic.py` and adds a test.

## Conventions

| Area | Rule |
|---|---|
| Python | 3.11, uv, ruff (line length 100), pytest |
| Routes | `/api/v1/viva/*`; errors as `{"error": {"code", "message", "details"}}` |
| Settings | `VIVA_` prefix; shared `DATABASE_URL`, `ENVIRONMENT`, `LOG_LEVEL`, `INTEGRATION_MODE`; list each in `.env.example` |
| Domain code | No network calls; unit tested |
| Tests | Mock every external call (`httpx.AsyncClient.post`, `httpx.post`); never use real keys |
| Frontend | Feature-local files only; strict TypeScript; styles scoped under `.viva-app` |
| Text | Plain English; no em dashes in docs, comments or UI copy |
| Commits | Conventional commits, scope `viva`, for example `fix(viva): ...` |

## Commands

```bash
# backend
cd backend/services/viva-service
uv sync --extra speech
uv run ruff check . && uv run ruff format --check . && uv run pytest
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8401

# frontend (repository root)
pnpm --filter frontend typecheck
pnpm --filter frontend dev          # http://localhost:5173/viva
```

## Definition of done

- Tests added or updated for the behaviour changed, and all tests pass.
- ruff and the frontend typecheck pass.
- `git diff --stat origin/dev` shows only allowed paths.
- `docs/c4/TODO.md` and any affected spec are updated.
- No secrets in the diff.
