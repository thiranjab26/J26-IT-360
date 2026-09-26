## What and why

<!-- One or two sentences. Link the phase or task this belongs to. -->

## Component

<!-- Tick one. A PR should touch one component's service and feature, plus tests and docs. -->

- [ ] Shared (gateway, auth, frontend shell, database core, CI)
- [ ] C1 Adaptive Curriculum Engine
- [ ] C2 Cognitive Load Detection
- [ ] C3 VeriTutor
- [ ] C4 Intelligent Viva System

## Boundary check

- [ ] I only changed my own service and my own frontend feature.
- [ ] I write only to my own database schema.
- [ ] Any data I read from another component comes from its published `v_*` view, behind a stub.
- [ ] I did not invent a concept ID. All concept IDs exist in `database/seed/`.
- [ ] If this touches `contracts/`, `database/core/`, `database/seed/` or `frontend/src/shared/`, I tagged every affected owner and added a `contracts/CHANGELOG.md` entry where relevant.

## Verification

<!-- Paste the commands you ran and the result. -->

- [ ] `uv run ruff check . && uv run ruff format --check .`
- [ ] `uv run pytest`
- [ ] `pnpm lint && pnpm typecheck` (if frontend or gateway changed)
- [ ] Migrations run clean on my own Neon branch (`alembic upgrade head`)

## Notes for reviewers

<!-- Anything non-obvious: a trade-off you made, something you want a second opinion on, follow-up work you are deliberately leaving out. -->
