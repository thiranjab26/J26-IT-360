# SKILLS.md — What it takes to build C02

Two parts: the knowledge needed to build and defend this component, and the repeatable procedures worth packaging for Claude Code.

Priority: **Must** = you will be asked about it at the viva or it blocks the build · **Should** = makes the result noticeably better · **Nice** = only if time allows.

---

## Part 1 — Knowledge and skills

### 1. Browser media and real-time loops — Must

| Skill | Where it is used | You know enough when you can… |
|---|---|---|
| `getUserMedia`, constraints, permission states | `camera/` | explain what happens for denied / no device / device busy, and why the page needs https or localhost |
| `requestVideoFrameCallback` vs `requestAnimationFrame` | frame loop | say why frame timestamps, not wall-clock time, drive the features |
| Frame skipping and back-pressure | scheduler | explain why frames are dropped rather than queued |
| Page Visibility API | pause/resume | describe what browsers do to hidden tabs |
| Stopping tracks | `disable()` | make the camera LED go off on demand |

### 2. TypeScript and front-end engineering — Must

| Skill | Where | Enough when… |
|---|---|---|
| Strict TypeScript, typed arrays (`Float32Array`) | everywhere | no `any` in core; landmarks are not arrays of objects in the hot path |
| Pure functions and module boundaries | `features/` | every feature is testable without a browser |
| Ring buffers, streaming statistics | `window/` | per-second aggregation allocates nothing per frame |
| Vite build, static assets, env flags | build | study mode is absent from the normal bundle |
| Event emitters, `BroadcastChannel` | `events/` | a second tab receives events |

### 3. TensorFlow.js in production — Must

| Skill | Where | Enough when… |
|---|---|---|
| Backends (webgl, wasm, cpu) and how selection fails | `landmarks/`, `classifier/` | you can detect and report the active backend and explain the silent-CPU trap |
| Tensor lifecycle: `tf.tidy`, `dispose`, `tf.memory()` | inference | a 60-minute run shows a flat tensor count |
| Loading models from local URLs | model loader | no request leaves the origin |
| Warm-up inference | init | first-frame stall is hidden behind the loading state |
| Layers vs graph model formats | export | you can say which one you ship and why |

### 4. MediaPipe FaceMesh — Must

| Skill | Where | Enough when… |
|---|---|---|
| The 478-point topology, iris landmarks 468–477 | `features/` | you can point to the landmarks behind each feature on the overlay |
| `face-landmarks-detection` (tfjs runtime) config | adapter A | model files load from `public/models` |
| `@mediapipe/tasks-vision` FaceLandmarker: blendshapes, transformation matrix | adapter B | you can state the trade-off against adapter A in one minute |
| Coordinate systems (normalised vs pixel, mirrored preview, z-depth scale) | features, overlay | head yaw has the right sign |

### 5. Facial-behaviour signal processing — Must

| Skill | Where | Enough when… |
|---|---|---|
| Eye aspect ratio and blink detection as a state machine | blink | you can justify the threshold and duration bounds, and show it working with glasses |
| Gaze proxy from iris position, and its limits | gaze | you describe it as a proxy, not eye tracking |
| Head pose from landmarks | head | you know the error grows at large angles |
| Normalisation: scale (inter-ocular) and per-user baseline z-scoring | all features | you can explain why individual differences exceed the load effect |
| Smoothing, hysteresis, debouncing | output | the state does not flap on noisy input |
| Handling missing data in a time series | face loss | windows with gaps are masked, not silently interpolated |

### 6. Machine learning for small time-series data — Must

| Skill | Where | Enough when… |
|---|---|---|
| Windowing, stride, overlap and why overlapping windows are not independent | dataset prep | you never split windows of one person across train and test |
| Leave-one-subject-out cross-validation | evaluation | you can draw the fold diagram and say what it estimates |
| Data leakage patterns | everything | normalisation, tuning and feature selection all stay inside training folds |
| Classical baselines (Random Forest, SVM) with scikit-learn | baselines | results exist before any deep model |
| 1D-CNN + GRU in Keras; regularising a tiny model | model | parameter count is justified against data size |
| Metrics: accuracy, macro-F1, confusion matrix, variance across folds | reporting | you report spread, not one number |
| Ablation studies | FR3 | with/without expression features, same folds |
| Confidence calibration | FR5 | you know whether 0.84 means 84 % |

### 7. Model export and train/serve parity — Must

| Skill | Where | Enough when… |
|---|---|---|
| `tensorflowjs_converter`, legacy Keras 2 vs Keras 3 pitfalls | export | the round-trip smoke test passes before real training starts |
| Versioned feature spec shared between training and inference | `feature_spec.json` | the browser rejects a mismatched model |
| Numerical parity tests | CI | Python and JS outputs agree within tolerance |

### 8. Privacy and security engineering — Must (this is the novelty claim)

| Skill | Where | Enough when… |
|---|---|---|
| Content Security Policy (`connect-src`, `worker-src`, wasm directives) | deployment | a deliberate test POST to another origin is blocked |
| Reading the DevTools Network panel and HAR files | evidence | you can demonstrate "nothing leaves" live |
| Automated network assertions in Playwright | e2e | the test fails if any request is made during sensing |
| Data minimisation: what a "feature vector" is and is not | recorder | you can argue why stored data is not re-identifiable video |
| Consent UX | demo | a first-time user understands what is processed in under 30 seconds |

### 9. Offline / PWA — Should

| Skill | Where | Enough when… |
|---|---|---|
| Service workers, Workbox precaching, cache versioning | build | offline reload works; a new deploy replaces the old model |
| Self-hosting model and WASM assets with checksums | `fetch-models` | the build has no third-party hostnames |

### 10. Performance measurement — Should

| Skill | Where | Enough when… |
|---|---|---|
| `performance.now`, User Timing marks, Long Tasks API | bench | latency is reported as p50/p95 with a stated definition |
| Chrome Performance panel, memory timeline | profiling | you can find what caused a dropped frame |
| Web Workers, `OffscreenCanvas`, transferable objects | optional optimisation | you move work off the main thread only after measuring |

### 11. Testing — Should

| Skill | Where | Enough when… |
|---|---|---|
| Vitest unit tests with numeric fixtures | features | each feature has a failing-then-passing test |
| Playwright with a fake camera stream | e2e | tests run headless in CI without a webcam |
| Contract tests against a JSON schema | integration | teammates validate against the same samples |

### 12. Research method and human-subjects practice — Must

| Skill | Where | Enough when… |
|---|---|---|
| Cognitive Load Theory basics (intrinsic / extraneous / germane) | report, viva | you can relate task design to the type of load induced |
| NASA-TLX: six subscales, raw vs weighted scoring | study | you can say which scoring you used and why |
| Experimental design: counterbalancing, manipulation checks, confounds (fatigue, order, lighting) | study | task order differs across participants by design |
| SUS scoring | NFR3 | you can compute a score from ten answers |
| Ethics: informed consent, anonymisation, storage, withdrawal | study | a participant can withdraw and you know which file to delete |
| Reading and verifying sources | literature | every citation has been opened and checked |

### 13. Integration and communication — Should

| Skill | Where | Enough when… |
|---|---|---|
| Designing a small, stable public API | `index.ts` | a teammate integrates from `INTEGRATION.md` without asking you |
| Schema versioning and additive change | events | adding a field breaks nobody |
| Git hygiene, small commits, CI | repo | history tells the story of the build |

---

## Part 2 — Repeatable procedures for Claude Code

These come up again and again in this project. Each is a candidate for a Claude Code skill (a folder under `.claude/skills/<name>/SKILL.md`) once the first manual run has shown what the steps really are.

| Procedure | Trigger | Steps in brief |
|---|---|---|
| **add-feature** | "add a new facial feature" | write pure function → fixture test incl. rate-independence → add to per-second vector → regenerate `feature_spec.json` → update ARCHITECTURE.md §5 → flag that the model must be retrained |
| **privacy-audit** | before any demo, merge or submission | grep for CDN hosts and banned network APIs → run privacy and offline e2e → save HAR to `docs/evidence/` → report pass/fail per layer in ARCHITECTURE.md §9 |
| **run-bench** | after any pipeline change | run `npm run bench` → compare against last committed result → report regressions against the budget table |
| **export-model** | after training | export → copy with `feature_spec.json` → parity test → bump `model_version` → re-run bench and privacy e2e |
| **loso-eval** | new data or new model variant | load exports → leakage checklist → baselines + model across folds → regenerate tables and figures → no numbers typed by hand |
| **session-qc** | after each pilot session | load one export → check fps, face-present ratio, blink counts, block markers, TLX completeness → flag unusable sessions |
| **contract-check** | before integration sessions | validate sample events against schema → diff schema against the copy teammates hold → list breaking vs additive changes |

---

## Suggested learning order (given the timeline)

1. Sections 1, 3, 4 — enough to get landmarks on screen.
2. Section 5 — blink and head pose first; they are the most demonstrable.
3. Section 8 — the privacy evidence is quick to produce and central to the claim.
4. Section 12 — before the first participant.
5. Sections 6, 7 — once there is data.
6. Sections 9–11, 13 — as each milestone needs them.
