# C4 Intelligent Viva System: design docs

Owner: R. J. Vanderheyden (IT23212022). Service: `backend/services/viva-service` (port 8401).
Feature: `frontend/src/features/viva`. Schema: `viva`. Branches: `feature-c4-viva-system`, then `c4-viva-dev`.

These files are written so C4 can be **recreated from the start inside this repo**, matching its
structure and technology, by Claude Code or by a person, without copying the old standalone demo.

| File | What it defines |
|---|---|
| [spec-domain.md](spec-domain.md) | The research logic: bank items, six answer states, follow-up policy, AI wording rules, hesitation signals, gap rules v1.3, report, A/B/C evaluation |
| [spec-backend.md](spec-backend.md) | viva-service: technology, folders, `VIVA_` config, `viva` schema tables, API routes, integrations, tests |
| [spec-frontend.md](spec-frontend.md) | The viva feature: folders, screens, behaviour, style, acceptance |
| [migration-plan.md](migration-plan.md) | The step checklist (Steps 0 to 8) and progress log |

## What the recreation needs

| Input | Needed? | Where it is |
|---|---|---|
| These four docs | Yes, the main input | `docs/c4/` |
| The repo's own rules | Yes | `README.md`, `docs/architecture.md`, `docs/onboarding.md`, `docs/adr/`, `contracts/`, `_service-template`, `tutor-service` |
| The old demo source | Recommended, as reference for exact code and wording | `Desktop/Research Project/Astra Prototype/Astra version 2/adaptlearn-c4` (read it in place, never commit it) |
| The research handover | Recommended, for the proposal context | `adaptlearn-c4/AdaptLearn_C04_LLM_Handover.md`; copy into `docs/c4/` without keys |
| A project zip | No | Claude Code reads folders directly |
| API keys | Yes, at run time only | Your own `viva-service/.env` (Groq key, Gemini key). Never in git or in a prompt |
| Team Neon branch | Yes | Ask the leader; paste the pooled URL into `.env` |
| Tools | Yes | Python 3.11 through `uv`, Node 20+, pnpm 9 |

## Decisions already made (change them here first)

- Raters use the existing `lecturer` role.
- No C4 course upload. C3 owns content; C4 reads `content.v_verified_passages` (stubbed until C3 publishes it).
- Topics: `dsa.stack` and `dsa.queue` now. OOP and databases wait for new seed concept IDs.
- C2 cognitive load is a stub until a C2 to C4 contract exists.
- AI and speech: Groq first (`gpt-oss-120b`, then `gpt-oss-20b`), Gemini as backup, Groq Whisper and the Orpheus voice. Cloud use needs `VIVA_ALLOW_CLOUD_LLM=true`.
- The PP1 demo on 11 Oct runs from the old demo folder while the recreation continues.

## How to start a recreation with Claude Code

Open a terminal in the repo root, run `claude`, and paste:

```text
Read README.md, docs/architecture.md, docs/onboarding.md, docs/adr/*, contracts/*,
backend/services/_service-template, backend/services/tutor-service and frontend/src/features/tutor.
Then read docs/c4/README.md, docs/c4/spec-domain.md, docs/c4/spec-backend.md,
docs/c4/spec-frontend.md and docs/c4/migration-plan.md.
Recreate C4 from these specs on branch feature-c4-viva-system, following the repo's rules exactly.
The old demo at "C:\Users\MSII\Desktop\Research Project\Astra Prototype\Astra version 2\adaptlearn-c4"
is read-only reference for exact code and wording; never copy its .env. Only change
backend/services/viva-service, frontend/src/features/viva, research/c4-viva and docs/c4
(plus one line in frontend/src/app/router.tsx and the C4 line in .github/CODEOWNERS).
Work one step of migration-plan.md at a time, run the checks, tick the plan, show me the
result, and wait for my OK before the next step.
```
