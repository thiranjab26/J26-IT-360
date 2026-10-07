# Production-readiness assessment

**Status: improved research prototype; not approved for production or high-stakes assessment.**

The requested features are implemented and tested locally. Neither live Gemini/Neon behavior nor recognition accuracy on representative learner recordings has been certified. See `VERIFICATION_UPGRADE.md` for exactly what was tested.

## Release blockers

| Gap | Required work before production |
| --- | --- |
| Real speech accuracy and latency | Evaluate representative accents, microphones, noise and subject terms; measure word error rate, filler precision/recall, pause timing error, and cold/warm p50/p95 latency. Choose model/device/beam settings against those results. No measured recognition improvement is claimed here. |
| Reliable speech capacity | Add isolated inference workers with bounded jobs and deadlines, cancellation, load tests, model preloading and health checks. The current inference lock is per process; a stuck decoder/inference holds that worker's slot. Client timeout does not stop server inference. |
| Live Gemini validation | Exercise the preserved compatible endpoint with your enabled model and synthetic/staging data. Confirm schema support, output limits, thinking-token behavior, latency and quota responses. No real API key was used during this upgrade. |
| Neon deployment validation | Apply the additive tables to a staging branch, verify PostgreSQL concurrency, TLS, pool limits, connection recovery and backups. SQLite concurrency tests do not certify Neon behavior. |
| Identity and course access | Replace shared staff keys and fresh participant identities with your account system, enrollment/tenant authorization, token revocation and recovery. A fresh participant identity can obtain a new personal allowance; global budgets still apply. Courses currently belong to one shared research workspace. |
| Upload isolation | Run PDF extraction in a sandboxed process/service with memory and wall-clock limits, malware scanning and parser monitoring. Current byte/page/text limits do not fully protect against malicious compressed PDFs or pathological parser inputs. Enforce proxy request-body/time limits before multipart parsing. |
| Academic validity | Independently review source entailment, every rubric/probe and generated misconceptions. Exact quotes do not establish factual support. Validate assessment labels and gap hypotheses with blinded raters. Acoustic timing remains client-submitted and can be altered; it is not trusted exam evidence. |
| Operational and privacy controls | Add TLS, secret management, consent/retention/deletion/export policies, access audit logs, metrics/alerts, backup restores and incident procedures. Course text and responses persist in the configured database. Cloud processing sends selected material and learner answers to the configured provider. |

## Further limitations

- Retrieval is bounded lexical ranking, not a production retrieval system. It can miss relevant passages in long documents. There is no OCR, table/diagram interpretation or semantic source-entailment verification.
- Course editing, deletion/retention workflows, multiple topics per course, enrollment, and independently reviewed written checks for uploaded courses remain future work.
- Adaptive probes are chosen from reviewed rubric prompts. Legacy custom questions without probes keep generic fallbacks. Misconception/rephrase behavior remains state-specific; there is no additional free-form follow-up generation call.
- Transcript fillers are lexical observations and may be omitted by Whisper or edited by the learner. Silence detection can mistake background noise for speech or miss quiet sounds. Neither is a diagnosis of confidence, anxiety or ability.
- Local budgets count reserved usage, not actual bills. Provider accounts need their own budget controls. Requests through another app or service are outside these counters. Reasoning/cached-token prices are not estimated. Output truncation still causes a failed validation that consumes its reservation.
- General rate limits use the direct client IP. Configure trusted-proxy handling carefully in deployment; do not trust arbitrary forwarded IP headers. Database-backed request limits add database load. Multiple workers share budgets only if they share the same database.
- Concurrent duplicate answer requests can both consume inference budget before the existing compare-and-swap/idempotency checks store one answer. Exactly-once provider charging would require request leases/jobs. Browser retries of unchanged answers now reuse the same request ID.
- Backend dependencies retain compatibility ranges. `requirements-tested.txt` records this Windows test environment, including optional speech dependencies; generate and audit deployment-specific locks. The added CI workflow has not run on a hosted runner in this task.
- The existing setup script and production server topology need deployment-specific review. Prototype startup uses `create_all`; the supplied additive migration helper is not a versioned migration system with rollback/history.
- Browser capture and playback vary by browser/OS. Local browser tests cover content authoring and the typed viva flow. No real microphone, Safari/mobile, permission-denial or reconnect end-to-end test was performed.

## Suggested acceptance gate

1. Apply changes to a Neon staging branch and run API/session/concurrent quota tests against it.
2. Run generated-question and assessment checks against your configured Gemini model with no real learner data, including 429, timeout, invalid JSON and unsupported-schema cases.
3. Collect consented reference recordings and compare transcription/error/latency metrics against the previous ZIP under identical settings and hardware.
4. Have instructors validate grounding and non-leading probes; confirm unreviewed drafts never enter sessions.
5. Complete authentication, parser isolation, transport/privacy and operations work above before enrolling real learners.
