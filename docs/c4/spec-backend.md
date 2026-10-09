# C4 spec 2 of 3: viva-service (backend)

How to build `backend/services/viva-service` so it matches this repo. Read with
`docs/architecture.md` sections 4 and 5, `docs/onboarding.md`, ADR 0002 and `tutor-service`,
which is the working example of every pattern below.

## 1. Technology (must match the repo)

| Concern | Use | Not |
|---|---|---|
| Language | Python 3.11 (`requires-python = ">=3.11,<3.12"`, `.python-version` = 3.11) | Python 3.13 |
| Tooling | uv, `pyproject.toml`, `uv.lock`, ruff (line length 100, rules E F I UP B SIM), pytest | `requirements.txt`, pip, venv scripts |
| Framework | FastAPI, Pydantic v2, pydantic-settings | |
| Database | SQLAlchemy 2, psycopg 3, Alembic, Neon Postgres, schema `viva`, role `svc_viva` | `create_all` at startup, own Neon project |
| Auth | Gateway headers `X-User-Id`, `X-User-Role` via `app/core/deps.py` | Own users, tokens, passwords or staff keys |
| Errors | `ApiError` in `{"error": {"code", "message", "details"}}` | `{"detail": ...}` |
| Logs | JSON logs with the gateway `request_id` (`app/core/logging.py`) | |
| Run | `uv run uvicorn app.main:app --reload --port 8401` | `scripts/run.py`, Docker |

Dependencies: `fastapi`, `uvicorn[standard]`, `pydantic`, `pydantic-settings`, `sqlalchemy`, `psycopg[binary]`,
`alembic`, `httpx`, `scikit-learn`, `python-multipart`. Optional group `speech`: `av`, `numpy`, `faster-whisper`
(Silero VAD ships with it). Dev group: `pytest`, `httpx`, `ruff`.

## 2. Folder layout

```text
backend/services/viva-service/
├── app/
│   ├── main.py                     # create_app(), API_PREFIX = "/api/v1/viva", health at /health and prefix/health
│   ├── config.py                   # Settings, every variable listed in .env.example
│   ├── api/v1/router.py
│   ├── api/v1/routes/
│   │   ├── health.py
│   │   ├── sessions.py             # start, list, get, answers (incl. skip and spoken stop), finish, report, export
│   │   ├── speech.py               # transcribe, synthesize
│   │   ├── bank.py                 # lecturer: list, generate, edit, review
│   │   └── evaluation.py           # lecturer: cases, ratings, metrics, export
│   ├── core/  deps.py  errors.py  logging.py  limits.py
│   ├── domain/  policy.py  assessment.py  hesitation.py  gap.py  report.py  disfluency.py  evaluation.py  seed_bank.py
│   ├── models/                      # Pydantic request and response schemas
│   ├── db/  session.py  tables.py  repositories/
│   └── integrations/  llm.py  speech.py  mastery.py  passages.py  load.py
├── migrations/  env.py  versions/0001_viva_initial.py
├── alembic.ini
├── tests/unit/  tests/integration/
├── .python-version  pyproject.toml  uv.lock  .env.example  README.md
```

Create folders only when they hold code (onboarding section 5).

## 3. Configuration (`.env.example`)

Shared: `DATABASE_URL` (Neon pooled), `ENVIRONMENT`, `LOG_LEVEL`, `INTEGRATION_MODE` (`stub` or `live`).

Service (all `VIVA_`):

| Variable | Default | Purpose |
|---|---|---|
| `VIVA_PORT` | 8401 | |
| `VIVA_DB_SCHEMA` | viva | |
| `VIVA_ASSESSMENT_PROVIDER` / `VIVA_GENERATION_PROVIDER` | demo | `demo`, `openai` (OpenAI-compatible) or `ollama` |
| `VIVA_LLM_BASE_URL` / `VIVA_LLM_MODEL` / `VIVA_LLM_API_KEY` | | Primary: Groq `https://api.groq.com/openai/v1`, `openai/gpt-oss-120b` |
| `VIVA_LLM_FALLBACK_MODELS` | | Same provider, for example `openai/gpt-oss-20b` |
| `VIVA_FALLBACK_LLM_BASE_URL` / `_MODEL` / `_API_KEY` / `_OUTPUT_MODE` | | Second provider: Gemini `https://generativelanguage.googleapis.com/v1beta/openai`, `gemini-3.8-flash` |
| `VIVA_LLM_OUTPUT_MODE` | json_schema | Or `prompt_json` |
| `VIVA_ALLOW_CLOUD_LLM` | false | Must be true to send any text or audio to a cloud provider |
| `VIVA_DEMO_FALLBACK` | false | Never true in a study |
| `VIVA_LLM_FOLLOW_UP_PHRASING` | true | AI wording of follow-ups and the plan |
| `VIVA_LLM_TIMEOUT_SECONDS`, `VIVA_LLM_OPERATION_TIMEOUT_SECONDS`, `VIVA_LLM_MAX_ATTEMPTS`, `VIVA_LLM_MAX_OUTPUT_TOKENS` | 45, 90, 3, 4096 | |
| `VIVA_LLM_REQUESTS_PER_MINUTE`, `VIVA_LLM_DAILY_CALLS`, `VIVA_LLM_USER_DAILY_CALLS`, `VIVA_LLM_DAILY_TOKEN_BUDGET` | 30, 500, 50, 2000000 | Budgets, stored in `viva.usage_counters` |
| `VIVA_SPEECH_PROVIDER` | disabled | `groq`, `faster_whisper` or `disabled` |
| `VIVA_SPEECH_BASE_URL` / `VIVA_SPEECH_API_KEY` / `VIVA_SPEECH_MODEL` | Groq, `whisper-large-v3-turbo` | |
| `VIVA_TTS_MODEL` / `VIVA_TTS_VOICE` | `canopylabs/orpheus-v1-english` / `tara` | Needs the model's terms accepted once in the Groq console |
| `VIVA_WHISPER_MODEL`, `_DEVICE`, `_COMPUTE_TYPE`, `_CPU_THREADS`, `_BEAM_SIZE`, `_LANGUAGE` | base.en, cpu, int8, 4, 1, en | Local fallback |
| `VIVA_SPEECH_WARMUP`, `VIVA_MAX_AUDIO_BYTES`, `VIVA_SPEECH_DAILY_CALLS`, `VIVA_SPEECH_USER_DAILY_CALLS` | false, 20971520, 1000, 100 | |
| `VIVA_SEED_DEMO_BANK` | true | Adds the stacks, queues and OOP demo questions at startup. `false` in the owner's `.env` since 9 Oct 2026: the live bank is the C3 catalogue (`app/domain/c3_bank.py`: 10 courses, one per C3 topic, 24 questions, one per C3 concept), loaded by `uv run python scripts/load_c3_bank.py --apply`, which backs up every viva table to `../C4-db-backups/` and then replaces all sessions, participants, courses and questions (staff stay). Tests keep it `true` |

Never commit `.env`. Tests set every key to empty so they can never reach a real provider.

## 4. Database (`viva` schema, Alembic)

`migrations/env.py` uses `version_table_schema="viva"`, `include_schemas=True` and the direct Neon URL.
User IDs are `uuid` values from `core.users` (read only). No users, roles or token tables.

| Table | Key columns |
|---|---|
| `question_bank` | `id`, `concept_id` (text, from `core.concepts`), `status`, `data` (JSONB bank item) |
| `sessions` | `id`, `user_id` (uuid), `status`, `version` (int, for compare-and-swap saves), `data` (JSONB: snapshots, turns, current question, context, versions, report) |
| `turns` | `id`, `session_id`, `question_id`, `request_id`, `request_digest`, `data`, `response`. Unique (`session_id`, `request_id`) and (`session_id`, `question_id`) for idempotent answers |
| `results` | `session_id` (PK), `data` (report) |
| `integration_events` | `id`, `session_id`, `data` (C1 review flags) |
| `human_ratings` | `id`, `rater_id` (uuid), `case_id`, `condition`, `data`. Unique (`rater_id`, `case_id`, `condition`) |
| `usage_counters` | `key` (PK), `used`, `expires` (atomic upsert budgets) |

Sessions copy (snapshot) their bank items at start, so later edits never change an old session.
Saving a session uses `UPDATE ... WHERE version = :v` and returns 409 on a stale save.

## 5. API (all under `/api/v1/viva`, through the gateway on 8080)

Roles: `student` takes vivas; `lecturer` does what the demo's admin and evaluator did.

| Method and path | Role | Notes |
|---|---|---|
| `GET /health` | public | `{"status": "ok"}`, also at `/health` |
| `GET /topics` | any | Concepts that have approved questions, with names from `core.concepts` |
| `GET /context?concept_id=` | any | C1 and C3 context (stub or live), C2 stub |
| `POST /sessions` | student | Body: `concept_ids` or a module, `input_mode`, `max_depth`. Builds snapshots and the first question |
| `GET /sessions`, `GET /sessions/{id}` | owner, lecturer read | List items include `coverage` and `strong` for completed sessions |
| `POST /sessions/{id}/answers` | owner | Body: `question_id`, `transcript`, `input_mode`, `response_latency_ms`, `audio_metrics`, `request_id`, `skip`. Handles skip and spoken stop. Idempotent on `request_id`. Hides rubric detail until the session completes |
| `POST /sessions/{id}/finish` | owner | Early finish |
| `GET /sessions/{id}/report`, `GET /sessions/{id}/export` | owner, lecturer | Completed sessions only |
| `POST /speech/transcribe` | student | Multipart audio (webm, wav, mp3, mp4, ogg, flac), max 20 MB and 180 s. Returns transcript, segments, metrics, lexical metrics, speech intervals. `metrics.fluency` holds the answer's literature-profile measures (250 ms pauses, transcript syllables; null without word timings); the frontend sends `metrics` back as `audio_metrics`, whose schema validates it. Audio is not stored |
| `POST /speech/synthesize` | any | Body `{text}`, at most 600 characters. Returns `audio/wav`. Cached; 503 means the frontend falls back to the browser voice |
| `GET /bank`, `POST /bank/generate`, `PUT /bank/{id}`, `POST /bank/{id}/review` | lecturer | Generation grounded in C3 passages; approval re-validates quotes |
| `GET /evaluation/cases?condition=`, `POST /evaluation/ratings`, `GET /evaluation/metrics`, `GET /evaluation/export` | lecturer | Blinded A/B/C cases |
| `GET /usage` | lecturer | Budget counters |
| `GET /overview` | admin only (evaluators get 403, so they stay blinded) | Read-only dashboard totals: participants, sessions, answers (spoken or typed), coverage, bank status, ratings, outcomes, answer states, 14 days of activity, topics and the 8 newest sessions |
| `POST /lab/analyse` | admin only | Multipart `audio` (the student's track), optional `examiner` (splits the track per question), `transcriber` = `auto`, `groq` or `none`. M4A, MP3, WAV, WebM, MP4, OGG or FLAC, max 20 MB and 30 min. Returns the fluency measures (session, per answer, 15 s windows), the literature profile, words, pauses and notes. Audio is analysed in memory and not stored. Shares `app/integrations/recording.py` with `scripts/analyze_recordings.py`; 503 when the `speech` extra is missing |

Request rate limiting is the gateway's job. viva-service keeps only the LLM and speech budgets.

## 6. Integrations (`app/integrations/`, stub or live by `INTEGRATION_MODE`)

| Module | Stub | Live |
|---|---|---|
| `mastery.py` (C1) | mastery 0.82, labelled mock | `SELECT mastery_score FROM curriculum.v_mastery WHERE user_id=:u AND concept_id=:c` (0 to 1) |
| `passages.py` (C3) | Demo course notes per concept | `SELECT passage_id, text, source_unit_id FROM content.v_verified_passages WHERE concept_id=:c` |
| `load.py` (C2) | Load `medium`, labelled mock | None yet. Needs a contracts PR (C2 to C4) |
| `llm.py` | | OpenAI-compatible chat completions with JSON schema. Endpoint chain: primary, its fallback models, then the second provider. A 429, 5xx or timeout moves to the next endpoint immediately and cools that endpoint for 30 s (or `Retry-After`). Gemini gets no `temperature`; others use 0. Per-call output caps: assessment 2048, wording 1024, plan 1536 |
| `speech.py` | | Decode to 16 kHz mono (PyAV), Silero VAD intervals, Groq `/audio/transcriptions` (`verbose_json`, `language=en`, `temperature=0`, prompt `"Umm, uh, so, like, hmm... I mean, uh, I think, um, maybe. Erm, well, you know, uhh."`), local faster-whisper fallback with the same prompt, Groq `/audio/speech` for the voice |

C1 review flags are recorded in `viva.integration_events`. To share them, publish a `viva.v_review_flags` view through a contracts PR. C4 never writes another schema.

## 7. Tests to recreate

- Domain: policy table, every gap rule (including the 6 Oct false-positive replay: a complete answer with 110 s latency, 1.17 s average pause and 1 filler must give `MIXED`), signal details, non-answer rule, skip, spoken stop.
- Phrasing: leak rejection then acceptance, two bad drafts fall back, the combined call avoids a second request, an answer with content needs anchoring.
- LLM chain: 429 is not retried on the same endpoint, failover to the second provider, cooldown skip, budget stops outbound calls, cloud gate.
- Speech: internal pauses only, overlap merging, `long_pause_count`, filler and ambiguous-marker counting.
- API: ownership (403 for another user's session), idempotent `request_id`, stale question 409, report only when completed, blinded rater cases, metrics with null kappa when undefined.
- Every test mocks `httpx.AsyncClient.post` and `httpx.post`. No real network calls.
