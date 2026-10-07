# viva-service (C4 Intelligent Viva System)

Adaptive spoken technical viva. It marks answers against a rubric, chooses follow-up questions
with a fixed rule-based policy, measures hesitation as supporting evidence only, and reports
whether weak performance more likely shows a knowledge gap or a communication difficulty.
Design: [docs/c4/](../../../docs/c4/README.md).

| | |
|---|---|
| Port | 8401 |
| Routes | `/api/v1/viva/*`, health at `/health` and `/api/v1/viva/health` |
| Schema | `viva` (all tables), role `svc_viva` |
| Env prefix | `VIVA_` (plus shared `DATABASE_URL`, `ENVIRONMENT`, `LOG_LEVEL`, `INTEGRATION_MODE`) |
| Login | **Temporary:** the viva's own participant code and staff access keys (`app/core/auth.py`). The frontend calls this service directly at `VITE_VIVA_API_URL` (default `http://localhost:8401`). It moves to the shared gateway login later |

## Run

```bash
cd backend/services/viva-service
uv sync --extra speech          # Python 3.11; drop --extra speech to skip audio packages
cp .env.example .env            # fill in DATABASE_URL and the VIVA_ keys
uv run alembic upgrade head     # creates the viva schema tables (Neon DIRECT url)
uv run uvicorn app.main:app --reload --port 8401
```

Then run the frontend (`pnpm --filter frontend dev`) and open http://localhost:5173/viva.
For quick local use without Alembic, `VIVA_CREATE_TABLES_ON_STARTUP=true` creates the schema and
tables at startup.

Staff sign-in uses the keys in `VIVA_ADMIN_ACCESS_KEYS` (question bank, courses) and
`VIVA_EVALUATOR_ACCESS_KEYS` (blinded rating).

## Checks

```bash
uv run ruff check . && uv run ruff format --check . && uv run pytest
```

Tests use a temporary SQLite database and blank every provider key, so they never call a real
service.

## Layout

| Path | Contents |
|---|---|
| `app/main.py` | App factory, request budgets middleware, CORS, error handlers |
| `app/config.py` | Every setting, read from `.env` |
| `app/api/v1/routes/` | `auth`, `topics`, `sessions`, `speech`, `courses`, `bank`, `evaluation`, `health` |
| `app/core/` | Shared error format, JSON logging, the temporary local login, request and LLM budgets |
| `app/domain/` | Research logic: `logic.py` (states, policy, hesitation, gap rules v1.3, report), `disfluency.py`, `research.py` (A/B/C metrics), `seed.py` (demo bank) |
| `app/integrations/` | `llm.py` (Groq then Gemini, assessment, follow-up wording, plan), `speech.py` (Groq Whisper, Silero pauses, voice), `context.py` (C1, C2, C3 stub or HTTP), `notifications.py` (C1 review) |
| `app/db/` | `tables.py` (viva schema), `session.py` (engine), `repositories/materials.py` (course material) |
| `app/models/schemas.py` | Request and response models |
| `migrations/` | Alembic, version table inside `viva` |

## Environment variables

Every variable, with defaults and comments, is in [.env.example](.env.example). The main groups:

| Group | Variables |
|---|---|
| Shared | `DATABASE_URL`, `ENVIRONMENT`, `LOG_LEVEL`, `INTEGRATION_MODE` |
| Service | `VIVA_PORT`, `VIVA_DB_SCHEMA`, `VIVA_CREATE_TABLES_ON_STARTUP`, `VIVA_DEV_MODE`, `VIVA_ALLOWED_ORIGINS`, `VIVA_SEED_DEMO_BANK` |
| Temporary login | `VIVA_ADMIN_ACCESS_KEYS`, `VIVA_EVALUATOR_ACCESS_KEYS`, `VIVA_TOKEN_HOURS` |
| AI | `VIVA_ASSESSMENT_PROVIDER`, `VIVA_GENERATION_PROVIDER`, `VIVA_LLM_*`, `VIVA_FALLBACK_LLM_*`, `VIVA_ALLOW_CLOUD_LLM`, `VIVA_DEMO_FALLBACK`, `VIVA_LLM_FOLLOW_UP_PHRASING` |
| Speech and voice | `VIVA_SPEECH_*`, `VIVA_TTS_MODEL`, `VIVA_TTS_VOICE`, `VIVA_WHISPER_*`, `VIVA_MAX_AUDIO_BYTES` |
| Budgets | `VIVA_API_REQUESTS_PER_MINUTE`, `VIVA_AUTH_REQUESTS_PER_MINUTE`, `VIVA_LLM_REQUESTS_PER_MINUTE`, `VIVA_LLM_DAILY_*`, `VIVA_SPEECH_DAILY_CALLS`, `VIVA_SPEECH_USER_DAILY_CALLS` |
| Other components | `VIVA_C01_API_URL`, `VIVA_C02_API_URL`, `VIVA_C03_API_URL`, `VIVA_C01_REVIEW_URL`, `VIVA_INTEGRATION_API_TOKEN` |
