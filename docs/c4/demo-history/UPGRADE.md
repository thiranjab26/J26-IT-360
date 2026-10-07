# C4 upgrade, 3 October 2026

This release updates the supplied ZIP. Gemini continues through the existing OpenAI-compatible adapter. Neon continues through SQLAlchemy/psycopg and `DATABASE_URL`. No live service was changed or contacted during testing. The original archive was not modified.

## Run and configure

1. Extract this ZIP into a new directory. Run `python scripts/setup.py --speech`, then `python scripts/run.py`.
2. Keep your existing backend `.env` when moving the code into an existing project. The returned source deliberately excludes `.env`, databases, access tokens, caches and installed dependencies. Merge new settings from `backend/services/viva-service/.env.example` as needed.
3. For local transcription, set `SPEECH_PROVIDER=faster_whisper`. Pre-download your selected Whisper model or set `WHISPER_MODEL` to its local directory. `SPEECH_WARMUP=true` loads it before the service becomes ready; startup fails clearly if it cannot load. The default remains `base.en` on CPU with int8 computation. Speech dependencies alone do not include model weights.
4. Sign in as an administrator, open **Question bank → Courses & source materials**, create a course, and upload text/Markdown/PDF or paste text. Review the extracted text. Select the course in the **Topic** filter, generate drafts, inspect every source/rubric/probe, then approve. New learner sessions use only approved questions.
5. For an existing database, back it up and review `python scripts/migrate_upgrade.py`. With the service's Python environment, `--apply` creates only the three added tables: `courses`, `course_materials`, `usage_counters`. Existing session and rubric snapshots remain intact. Prototype startup also creates missing tables. Untouched version-1 demo bank seeds receive the new probes at startup; instructor edits are preserved.

## Gemini and Neon

Keep the compatible provider configuration:

```dotenv
ASSESSMENT_PROVIDER=openai
GENERATION_PROVIDER=openai
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL=YOUR_CURRENTLY_ENABLED_GEMINI_MODEL
LLM_API_KEY=YOUR_EXISTING_GEMINI_KEY
ALLOW_CLOUD_LLM=true
DEMO_FALLBACK=false
```

`openai` names the request format, not the model vendor. There is no added native Gemini route. Keys remain server-side. Enabling the existing cloud adapter sends question material, selected excerpts and learner text to the configured provider. Audio remains in the local transcription service.

Keep your existing Neon connection string, including its TLS parameters. `postgres://` and `postgresql://` are still normalized to `postgresql+psycopg://`; query options such as `sslmode` and `channel_binding` are preserved. Tests check request/URL contracts using synthetic data; they do not establish live connectivity.

References: [Google's compatible API documentation](https://ai.google.dev/gemini-api/docs/openai), [SQLAlchemy PostgreSQL/psycopg documentation](https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#module-sqlalchemy.dialects.postgresql.psycopg), [faster-whisper documentation](https://github.com/SYSTRAN/faster-whisper).

## What changed

### Recording and transcription

- Browser recording is mono at a requested 64 kbps and stops after 175 seconds, below the server's 180-second decoded-audio cap. Actual capture format remains browser-dependent.
- Transcription failures keep the blob in the current tab for a manual retry. Leaving/resetting the question or starting a new recording discards it. No automatic retry can silently consume the budget.
- A 120-second browser timeout prevents indefinite waiting. Reset/unmount aborts the request and ignores stale responses. The server may finish an already-running inference after a client abort.
- One inference slot per worker fails fast with 429 when busy. Model loading is cached; warm-up is optional. CPU thread count, compute type, language and beam size are configurable.
- Default beam size is now 1, replacing faster-whisper's default 5. English is explicit, avoiding language detection with the default English model. Beam size 3–5 or a larger model may improve recognition at additional cost; compare on your recordings before choosing.
- VAD runs once. Its intervals measure pauses; only external silence is trimmed for recognition, preserving context across internal gaps. Low-temperature decoding, disabled previous-segment conditioning, and silence handling reduce repeated/hallucinated continuation risks. Word timestamps/probabilities and processing time are returned for inspection.
- First-voice latency uses server-detected speech onset plus the browser clock since question audio ended. It still includes permission and start delay and is not a measure of thinking time.

### Pauses and fillers

Pauses count only internal VAD gaps of at least 400 ms. Overlapping/out-of-order intervals are merged; leading and trailing silence are excluded. Typed answers never gain acoustic timing.

Lexical filler detection recognizes elongated forms such as “umm” and “uhhh”, with character offsets in transcription responses. “Like”, “so”, “well” and “you know” are reported separately as ambiguous markers, not automatically counted as fillers. Reports count the reviewed transcript, so edits and recognition omissions affect the count. No validated acoustic filler detector or fluency diagnosis is claimed.

### Follow-ups

Rubric points support a focused `probe`. Missing rubric IDs select a relevant probe before a generic fallback. Probes already targeted are deprioritized; repeated prompts still advance or use one bounded alternative. The selected target is stored in the turn audit. This requires no extra provider call per answer. Existing state-specific rephrasing, misconception prompts and depth limits remain.

The 22 demo rubric points have hand-written probes. Generated rubrics must supply probes for instructor review. Existing custom bank entries without probes remain compatible and use their state-specific follow-ups; add probes through the bank editor to improve them.

### Courses and grounding

Each created course is one selectable viva topic. Materials are persisted in the configured database, including Neon when configured. Text is normalized into overlapping chunks with stable IDs, source filenames and PDF page numbers. Identical content in one course is deduplicated. Default limits: 5 MB per file, 100 PDF pages, 200,000 extracted characters per material, 20 materials per course. Scanned/encrypted PDFs and unsupported/empty files return explicit errors.

Generation retrieves up to 12 chunks ranked against the course title/objectives. Each citation must identify a supplied source/page/chunk and quote real text. Each generated rubric point must point to cited sources and include a quotation contained in them. Invalid generations do not enter the bank. Approval of uploaded-course questions repeats validation against stored materials.

Quote matching proves provenance, not that the quoted text logically supports the question, answer or rubric. Instructor review remains required. Uploaded content is treated as untrusted material in the provider instruction.

The existing C03 adapter remains for existing topics. Uploaded courses use local materials; absent C01/C02 signals are clearly marked unavailable. Uploaded courses have no independent knowledge check until a separate reviewed check is implemented. They cannot silently reuse the demo checks/templates.

### Rate limits and budgets

All reservations use atomic database upserts. Concurrent requests cannot exceed a configured window; a failed multi-counter reservation rolls back all its counters. Counters survive process restarts and are shared by workers using the same database.

| Setting | Default | Scope |
| --- | ---: | --- |
| `API_REQUESTS_PER_MINUTE` | 120 | Signed-in user, otherwise direct client IP |
| `AUTH_REQUESTS_PER_MINUTE` | 10 | Direct client IP, sign-in/registration attempts |
| `LLM_REQUESTS_PER_MINUTE` | 15 | All model calls |
| `LLM_DAILY_CALLS` | 500 | Global model calls |
| `LLM_USER_DAILY_CALLS` | 50 | Signed-in user's model calls |
| `LLM_DAILY_TOKEN_BUDGET` | 2,000,000 | Global conservative reservation units |
| `SPEECH_DAILY_CALLS` | 1,000 | Global transcription attempts |
| `SPEECH_USER_DAILY_CALLS` | 100 | Transcription attempts per participant |
| `LLM_MAX_OUTPUT_TOKENS` | 4,096 | Per provider request |
| `LLM_TIMEOUT_SECONDS` | 45 | Provider HTTP timeout |

Daily windows reset at 00:00 UTC (05:30 in Sri Lanka). The token budget reserves serialized request bytes plus maximum output tokens before sending. It is deliberately conservative, has no refunds, and is **not a monetary billing cap or a report of actual provider tokens**. Failed/timed-out provider calls remain charged. Generation costs one call per requested question and stores all drafts only after the whole batch validates. A mid-batch error leaves no drafts but still consumes attempted-call reservations.

429 responses include `Retry-After`; the frontend displays the wait. Provider 429 responses are surfaced without an automatic retry or a demo fallback. Administrators can inspect global counters in the course studio or `GET /api/v1/usage`. Health checks are exempt from request throttling. Fixed windows can allow a burst across a boundary.

## API additions

| Method | Route | Role |
| --- | --- | --- |
| POST / GET | `/api/v1/courses` | Admin |
| POST | `/api/v1/courses/{id}/materials/text` | Admin |
| POST | `/api/v1/courses/{id}/materials` (multipart `file`) | Admin |
| GET | `/api/v1/courses/{id}/materials/{material_id}` | Admin |
| GET | `/api/v1/usage` | Admin |

Source and rubric additions are backward-compatible optional fields for existing bank records. New generation requires them. See the service's `/docs` for request schemas.
