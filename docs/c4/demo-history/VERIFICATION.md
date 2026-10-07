> Historical document supplied in the input ZIP. The current user-requested course/upload scope and verification are documented in [UPGRADE.md](UPGRADE.md) and [VERIFICATION_UPGRADE.md](VERIFICATION_UPGRADE.md); they supersede conflicting statements below.

# Verification and remaining configuration

Verified on Linux with Python 3.12 and Node.js 24 on 2 October 2026.

| Check | Result |
| --- | --- |
| Clean setup using `scripts/setup.py --speech` | Passed; installed backend, frontend, and optional speech dependencies |
| TypeScript check and Vite production build | Passed |
| Backend suite | 25 tests passed |
| Typed viva through actual HTTP service | Passed; completed session, correct rubric coverage, saved report |
| Duplicate submission replay and ownership checks | Passed |
| Browser participant registration, viva, report, history | Passed |
| Browser question generation and approval | Passed |
| Browser independent rating submission | Passed |
| Evaluator cannot access system metrics/export/bank | Verified at API and UI boundaries |
| Desktop and mobile layout | Inspected; no horizontal overflow in checked mobile views |
| Browser JavaScript errors | None in tested flows |
| WAV decoding and actual Silero silence detection | Passed |
| VAD internal-pause calculations | Passed; leading/trailing silence excluded |
| C01 delivery success/failure persistence | Passed using controlled HTTP responses; no real message sent |

The browser checks used the real local frontend and FastAPI service with a disposable SQLite database. QA accounts, tokens, databases, and dependency folders are excluded from the source archive. Default demo configuration creates a fresh database when you run the project.

## Not live-tested

- Neon connectivity: no user database URL was supplied.
- Ollama or a cloud LLM: provider code is included, but no real inference service/model was supplied for a live run.
- Spoken transcription against a downloaded Whisper language model: decoder and Silero tests ran; no real microphone recording or Whisper model inference was validated here.
- Real C01/C02/C03 services: mock adapters were used in the full workflow; real adapter contracts are documented.
- Windows/macOS runtime and production deployment: the setup/launch scripts support these platforms, but this verification ran on Linux.
- Scientific validity: workflow tests are not a research accuracy study. Collect expert-reviewed content, independent human labels, and the planned participant dataset before interpreting model performance.

The backend test runner reported a dependency deprecation notice for Starlette's `httpx` test adapter. All tests passed; the notice does not affect the application's verified runtime flows.
