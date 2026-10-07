# Upgrade verification, 3 October 2026

Tests ran on Windows with Python 3.13 and Node.js 22.13.1 against an extracted copy of the supplied archive. All application data used for these checks was synthetic and stored in disposable SQLite databases. Live Gemini, Neon and teammate services were not contacted.

| Check | Result |
| --- | --- |
| Backend automated suite | **43 passed**, including the original 25 tests and 18 new tests |
| TypeScript project check | Passed |
| Production frontend build | Passed; 1,586 modules transformed, approximately 294 kB JS / 39 kB CSS before gzip |
| Browser staff sign-in | Passed against the local FastAPI service |
| Browser course creation, text upload, topic refresh | Passed |
| Browser extracted-source review and API budget display | Passed |
| Uploaded course in demo mode | Correct setup error; no unrelated demo question generated |
| Browser typed viva | Partial answer received the missing-example rubric probe; follow-up evidence advanced to the next concept; final report had 100% rubric coverage |
| Browser JavaScript errors in checked flow | None captured |
| Text/PDF upload | Real extraction, page/chunk provenance, duplicate detection, invalid PDF/type/encoding and blank PDF rejection tested |
| Grounded generation | Controlled provider response; validated citations/evidence/probes, approval gate and uploaded-course session |
| Fabricated source/rubric evidence | Rejected; no invalid bank item persisted |
| Shared quota races | 20 concurrent requests competing for 7 slots admitted exactly 7; rollback and reset boundaries tested |
| Provider 429 / exhausted local budget | Retry-After propagated; no automatic retry/fallback; exhausted budget prevented outbound calls |
| Gemini compatibility | Mocked HTTP contract test confirms existing endpoint, bearer header, model and JSON-schema request shape |
| Neon compatibility | Offline engine test confirms psycopg URL normalization and preservation of TLS/query options |
| Speech decode / silence | Real WAV decoding and installed Silero VAD accepted silence without inventing speech |
| Speech inference contract | Stub recognizer verified one VAD pass, continuous clipping, configured decoding, word evidence and timing; busy/failure lock handling tested |
| Pause/filler logic | Internal gaps, short gaps, overlap/order handling, elongated fillers and ambiguous lexical markers tested |
| Access and persistence regressions | Existing owner/role checks, idempotency, stale questions, immutable session snapshots, report persistence, research ratings and notification tests passed |

## Build-environment detail

The Windows execution sandbox prevented Node/esbuild from canonicalizing an ancestor directory. The standard build reached a successful TypeScript check but its Vite config-loader step failed on that filesystem restriction. The same source, React/Tailwind plugins and production build then passed using Vite's programmatic API with `configFile:false`, `resolve.preserveSymlinks:true`, and Node's symlink-preservation flags. No type checking was disabled. The ZIP retains the normal `npm run build` script; verify it in your deployment environment. Dependency installation used `npm ci --ignore-scripts`; Vite's installed platform binary subsequently built the project successfully.

One dependency warning reports Starlette's deprecated httpx test adapter. The final repeat also reported that the Windows sandbox could not write pytest's optional cache; all 43 tests still passed. `requirements-tested.txt` records the installed Python versions, including optional speech packages; `package-lock.json` remains the frontend lockfile.

## Reproduce

```text
python scripts/setup.py --speech
npm run build
cd backend/services/viva-service
<your virtual-environment Python> -m pytest -q
```

With only the core requirements, tests requiring optional speech dependencies skip. No language-model weights or live service credentials are needed for the automated suite. The new GitHub Actions workflow is supplied but was not executed on a hosted runner during this task.

## Not verified

- Actual Whisper recognition against recorded voices or downloaded language-model weights; transcription speed/accuracy improvements remain unmeasured.
- Real microphone capture, browser permission failures, network reconnect behavior, mobile/Safari layouts, and browser hook race conditions under automated fault injection.
- Live Gemini schema support, model availability, generation/assessment quality and billing behavior.
- Neon connectivity, real PostgreSQL quota races, migrations under production load, backups and failover.
- Malicious-PDF resource exhaustion, large-corpus retrieval recall, source entailment and empirical validity of gap classifications.

See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) for release blockers and acceptance gates.

## Browser evidence

Synthetic course material, preview and budget controls:

![Course studio verification](screenshots/course-studio.jpg)
