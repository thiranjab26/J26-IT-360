# C4 Intelligent Viva System: To-do

Owner: R. J. Vanderheyden. Branch: `feature-c4-viva-system`, merged into `c4-viva-dev`, then a PR into `dev`.
Status key: `[ ]` open, `[~]` in progress, `[x]` done. Update this file in the same commit as the work.

## P0: Before the first commit

- [ ] Install `uv`, then in `backend/services/viva-service` run `uv sync --extra speech` and `uv lock`
- [ ] Run the checks with uv: `uv run ruff check . && uv run ruff format --check . && uv run pytest`
- [ ] Confirm `git status` lists no `.env` file and only C4 paths, plus `frontend/src/app/router.tsx`, `frontend/package.json` and `pnpm-lock.yaml`
- [ ] Commit in small steps with `feat(viva): ...` messages; do not push until reviewed

## P1: Before PP1 (complete by 20 Oct 2026; PP1 on 21 Oct)

The supervisor has changed the research scope; details pending. See [research-scope-change.md](research-scope-change.md).

- [ ] Record the supervisor's changes in research-scope-change.md, then update this list
- [ ] Run one full spoken session at http://localhost:5173/viva and fix anything confusing
- [x] Groq voice: the configured voice `tara` was invalid; now `diana` (8 Oct)
- [x] Guided editor replaces the JSON box for rubric points, misconceptions and follow-ups (8 Oct)
- [ ] Prepare a demo script that reliably shows a knowledge gap, a communication difficulty and a strong answer
- [ ] Decide whether PP1 is demonstrated from this repo or from the original prototype folder
- [ ] Pilot with at least 10 students (ethics approval and consent first)
- [ ] Calibrate the hesitation thresholds on pilot data; bump `GAP_VERSION` and add a test
- [ ] Measure and report results (do not measure on the students used to set the thresholds)

## P2: Fit the repository fully

- [ ] Switch `DATABASE_URL` to a personal branch of the team Neon project, then `uv run alembic upgrade head`
- [ ] Set `VIVA_CREATE_TABLES_ON_STARTUP=false` once migrations are in use
- [ ] Replace `@owner-c4` in `.github/CODEOWNERS` with the GitHub username
- [ ] Ask the leader to approve the `router.tsx` mount and the `lucide-react` dependency
- [ ] Push `feature-c4-viva-system`, merge into `c4-viva-dev`, open the PR into `dev` with the PR template completed

## P3: Integration (PP2)

- [ ] Replace the temporary login with the shared gateway login (`X-User-Id`, `X-User-Role`); route the frontend through `shared/api/client.ts`
- [ ] Map topics to seed concept IDs (`dsa.stack`, `dsa.queue`); propose seed concepts for OOP and databases
- [ ] Contracts PR: C4 as a consumer of `curriculum.v_mastery`; a C2 to C4 load read; a `viva.v_review_flags` view for C1
- [ ] Replace the course upload with `content.v_verified_passages` from C3
- [ ] Move integrations to `INTEGRATION_MODE=stub|live` view readers

## P4: Research readiness

- [ ] Expert review of the question bank, rubrics, misconceptions and probes
- [ ] Main study after the pilot (pilot and calibration moved to P1)
- [ ] Measure transcription accuracy on a sample, including fillers and technical terms
- [ ] Decide the unit of analysis (concept or session) and how to handle rare communication cases
- [ ] Ethics: document cloud processing (Groq, Neon) and the consent wording
- [ ] Collect feedback-usefulness ratings from students
- [ ] Optional: topic vocabulary hints for Whisper (proposal 6, deferred)

## Known issues

| Issue | Impact | Planned fix |
|---|---|---|
| Frontend calls viva-service directly | Bypasses the gateway | Shared login (P3) |
| Neon database is in US East | 0.3 s per query; session start about 1.6 s | Team Neon project in a closer region |
| Groq free tier: 8,000 tokens per minute per model | About 4 answers per minute before fallback | One student at a time, or a paid key for the study |
| `E501` ignored in ruff | Long prompt strings | Wrap when the code is next edited |

## Done

- [x] Prototype recreated in the repository layout: service, schema `viva`, Alembic, frontend feature, docs
- [x] 55 tests ported and passing; ruff clean; frontend typecheck and build pass
- [x] Live check against Neon: health, login, topics, session start, AI-marked answer
