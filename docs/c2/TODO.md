# TODO.md — C02 Cognitive Load Detection

Work top to bottom. Tick items as they finish and add a one-line note underneath when something was learned or decided. Requirement IDs in brackets refer to `CLAUDE.md`.

Legend: 🧑 = needs the human (decision, people, paperwork) — Claude prepares material but cannot complete it.

**Fixed dates:** Progress Presentation 1 — 22–27 Oct 2026 · Checklist submission — 30 Oct 2026

---

## Milestone A — Demonstrable vertical slice (target: 20 Oct)

Goal: open a page, opt in, see live features and a load state, with privacy and offline proven. A placeholder classifier is fine here.

### A0. Things to start today because they have lead time 🧑

Preparation material for every item below (question lists, request text, checklists, teammate message, label brief, laptop spec) is in [`A0-prep.md`](A0-prep.md). Boxes stay unticked until the human step is done.

- [ ] 🧑 Confirm ethics clearance status. No participant data is collected before it is granted.
- [ ] 🧑 Request access to mEBAL2 and ADABase (licence/request forms).
- [ ] 🧑 Download the Kaggle E-Learning Cognitive Load dataset and check what it actually contains (video? landmarks? tabular?).
- [ ] 🧑 Ask C01/C03/C04 owners: where does your component run (same page / other tab / server)? Share the event schema in ARCHITECTURE.md §8 and agree the additive fields and `null` handling.
- [ ] 🧑 Decide the label definition with the supervisor (ARCHITECTURE.md §12).
- [ ] 🧑 Identify the weakest laptop available for benchmarking and note its spec.

### A1. Scaffold

- [x] Vite + TypeScript (strict) project with the folder layout in CLAUDE.md
  - Lives at `packages/load-sensor/` as pnpm workspace package `@adaptlearn/load-sensor` (ADR 0004); training goes in `research/c2-load/`. TypeScript pinned to 5.9.3 and `@types/node` to 22.20.4 to match the rest of the workspace — newer versions changed peer resolution for teammates' packages, and typescript-eslint does not yet support TS 7. Use `pnpm`, not `npm`; on this machine `corepack pnpm` (no admin rights for `corepack enable`).
- [x] ESLint + Prettier; Vitest; Playwright
  - ESLint 10 flat config with typescript-eslint `strictTypeChecked`; Prettier last. Vitest 5 needs Node `^22.12 || ^24`, so the package `engines` is `^22.13.0 || >=24.0.0` (stricter than the root's `>=20`). Playwright e2e runs against `vite build && vite preview` with a fake camera; Chromium only for now, Firefox/Edge come with the bench (A7).
- [x] npm scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `test`, `test:e2e`, `bench`
  - Run with `pnpm`. Added `check` (typecheck + lint + unit tests = definition of done) and `format`. `bench` is a stub that exits 1 with "not implemented" until A7, so a missing benchmark can never look like a pass.
- [ ] `.gitignore` covering `data/`, `training/data/`, model caches, `.env`
- [ ] ESLint rules: no CDN hostnames in `src/`; no network APIs in `src/core` outside the model loader; `events/` and `recorder/` may not import `camera/`
- [ ] CI workflow (GitHub Actions): typecheck, lint, unit tests on push

### A2. Camera [FR1, NFR4]

- [ ] `camera/`: `getUserMedia` 640×480, frame loop on `requestVideoFrameCallback` with rAF fallback
- [ ] Handle permission denied, no camera, camera in use → distinct `status` values
- [ ] `visibilitychange` → pause / resume
- [ ] `disable()` stops all tracks (camera LED off) — verify by hand
- [ ] Unit tests with a mocked `MediaStream`

### A3. Landmarks — adapter A [FR1, FR7]

- [ ] `npm run fetch-models`: download face mesh model files once into `public/models/facemesh/`, verify checksum, write `MANIFEST.json`
- [ ] `LandmarkProvider` interface + `TfjsFaceMeshProvider` (tfjs runtime, iris refinement, local model URLs)
- [ ] Backend selection: webgl → wasm; refuse plain cpu with `status: "unsupported"`
- [ ] Skip-frame scheduling (never queue), target 15 fps
- [ ] Debug overlay: draw landmarks, show fps, backend, frame time p50/p95
- [ ] Confirm with DevTools Network tab: no requests after initial load

### A4. Features [FR2, FR3, FR8]

- [ ] Landmark index constants in one file, each verified on the debug overlay
- [ ] `ear()`, inter-ocular normalisation
- [ ] Blink state machine using frame timestamps and a baseline-relative threshold
- [ ] Iris offset → gaze proxy; dispersion
- [ ] Head pose (yaw/pitch/roll) from landmarks
- [ ] Brow raise, brow furrow; mouth-open, lip-press (expression proxies)
- [ ] Per-second aggregator → feature vector (F=14) + `validRatio`
- [ ] 30 s ring buffer; face-loss rules from ARCHITECTURE.md §5.5
- [ ] Baseline calibration (60 s) and z-scoring
- [ ] `useExpressionFeatures` flag
- [ ] `feature_spec.json` generator with a version hash
- [ ] Fixtures: record a few landmark sequences from yourself (blinking on purpose, looking away, turning head, leaving frame) — arrays only, no images
- [ ] Unit tests per feature against fixtures, including "same result at 10 fps and 30 fps"
- [ ] Live feature strip chart in the debug overlay (you will stare at this a lot)

### A5. Events and public API [FR5, FR6, NFR8]

- [ ] `LoadStateEvent` type + runtime validator
- [ ] `createLoadSensor()` with `enable / pause / resume / disable / on / getState`
- [ ] Heartbeat every 5 s + emit on change
- [ ] `BroadcastChannel` publisher
- [ ] Placeholder classifier: a transparent rule (e.g. weighted z-scores) clearly labelled `model_version: "heuristic-0"` so nobody mistakes it for the trained model
- [ ] Heuristic `engagement` and `frustration`
- [ ] EMA smoothing + hysteresis, unit-tested for no flapping on noisy input
- [ ] `INTEGRATION.md` for teammates: install, 10-line example, field meanings, what `null` means
- [ ] Tiny mock consumer page that subscribes and prints events (give this to teammates)

### A6. Consent and control UI [survey findings: 45.8 % not comfortable, 54.2 % want a toggle]

- [ ] Plain-language consent screen: what is processed, that nothing is uploaded or recorded, how to turn it off
- [ ] Sensing off by default; visible on/off toggle; visible "camera active" indicator
- [ ] App remains usable with sensing off
- [ ] Short calibration prompt ("look at the screen normally for a minute")

### A7. Privacy, offline and performance evidence [NFR1, NFR2, NFR6]

- [ ] Content Security Policy in the served HTML / dev server headers
- [ ] Service worker precaching app shell + models
- [ ] Playwright + fake camera: **zero network requests** during 60 s of sensing; save HAR to `docs/evidence/`
- [ ] Playwright: load online → go offline → reload → reaches `status: "active"`
- [ ] `npm run bench`: frame latency p50/p95, event latency p95, classifier time, long tasks; writes JSON with device + browser info
- [ ] Tensor-leak test: `tf.memory().numTensors` flat across a simulated long run
- [ ] Run bench on the weak laptop in Chrome, Edge, Firefox; commit outputs

### A8. Progress Presentation 1 prep 🧑

- [ ] 🧑 Rehearse the live demo: opt in → overlay → blink / look away / leave frame → state events in the mock consumer → DevTools Network tab empty → turn off Wi-Fi, reload, still works
- [ ] Record a backup screen capture of the demo in case the room's lighting or camera misbehaves
- [ ] One slide of measured numbers from `docs/bench/` (no estimates)
- [ ] One slide: what is heuristic today vs. what the trained model will replace

---

## Milestone B — Pilot study

Blocked on ethics clearance.

### B1. Study runner (build flag `STUDY_MODE`)

- [ ] Participant code entry (`P01`…`P08`), consent confirmation step
- [ ] Rest/baseline block (also serves as calibration)
- [ ] Three programming task blocks (Easy / Medium / Hard), ≥ 5 min each, order from a counterbalancing table
- [ ] NASA-TLX form after each block (six subscales, 0–100); store raw subscale scores
- [ ] Recorder: per-frame derived signals + timestamps + block markers → IndexedDB → export one file per session
- [ ] Recorder self-check: exported file contains no image data and no full landmark mesh (automated test)
- [ ] Session quality summary at the end: fps achieved, face-present ratio, blink count sanity — so a bad session is caught while the participant is still there
- [ ] Short SUS questionnaire at the end [NFR3]

### B2. Dry runs 🧑

- [ ] 🧑 Full dry run on yourself; fix everything that was awkward
- [ ] 🧑 Dry run with one teammate (not a participant); check the exported file loads in the training code
- [ ] 🧑 Write the session script: what you say, lighting/seat setup, what to do if the camera fails

### B3. Data collection 🧑

- [ ] 🧑 Run 8 sessions; note lighting, glasses, device and anything unusual per session
- [ ] 🧑 Back up exports to two places outside git, same day
- [ ] 🧑 Pay participant incentives; keep a record for the budget section

---

## Milestone C — Model training and evaluation

Can start on your own dry-run data before B3 finishes.

### C1. Training environment

- [ ] `training/requirements.txt` with pinned versions; legacy Keras (`TF_USE_LEGACY_KERAS=1`)
- [ ] Round-trip smoke test **before any real training**: build the tiny model → export → load in TF.js → parity within 1e-4. If this fails, switch to training in TF.js under Node.
- [ ] Loader for session exports → windows `[T, F]` + labels + participant id, reading `feature_spec.json`
- [ ] `scripts/landmarks-to-features.ts` (Node) for any public dataset landmarks

### C2. Baselines and model [FR4]

- [ ] Majority-class and chance baselines
- [ ] Random Forest and SVM on window summary statistics, LOSO
- [ ] 1D-CNN + GRU, LOSO, hyperparameters chosen inside training folds only
- [ ] Ablation: with vs. without expression features
- [ ] Optional: pre-train on a public dataset if access arrived and its features are compatible; otherwise record why not
- [ ] Leakage review checklist: no cross-participant windows, normalisation from rest block only, no tuning on test fold

### C3. Reporting

- [ ] Per-fold table: accuracy, macro-F1, confusion matrix, for every model
- [ ] Confidence calibration plot [FR5]
- [ ] Does the frustration heuristic track the NASA-TLX Frustration subscale?
- [ ] Feature importance (RF) and a note on which feature groups carry signal
- [ ] One script regenerates every figure and table from raw exports (`make report` or similar)

### C4. Ship the model

- [ ] Train final model on all participants; export to `public/models/classifier/` with `feature_spec.json`
- [ ] Browser refuses a model whose spec hash does not match the feature code
- [ ] Replace the placeholder; set a real `model_version`
- [ ] Re-run bench and privacy e2e

---

## Milestone D — Integration and evaluation

- [ ] 🧑 Integration session with each of C01, C03, C04 using the real sensor in their environment
- [ ] Contract test: sample events validated against the schema; share the same JSON samples with teammates
- [ ] Each consumer handles `load_state: null` sensibly — verify by toggling sensing off mid-session
- [ ] 30–60 minute soak test in the integrated app: memory flat, fps stable [NFR6]
- [ ] Lighting robustness check: bright window behind, dim room, glasses; record what degrades [NFR5]
- [ ] Phone browser check [NFR4]
- [ ] 🧑 Online pilot with the integrated system; collect SUS [NFR3]
- [ ] Optional: tasks-vision adapter B + head-to-head benchmark (ARCHITECTURE.md §3)
- [ ] Optional: Web Worker for inference, only if bench shows main-thread jank

---

## Milestone E — Documentation and submission

- [ ] Requirements traceability table: each FR/NFR → the test or evidence file that demonstrates it
- [ ] README: setup, run, test, how privacy is verified
- [ ] Architecture diagram updated to match what was built
- [ ] Limitations section written from what was actually observed
- [ ] 🧑 Check the reference list: confirm every cited paper exists and says what the text claims, especially the one used as the published-model baseline
- [ ] 🧑 Checklist submission (30 Oct)

---

## Parking lot (not now)

- Separate emotion-recognition model
- WebGPU backend
- Per-user online adaptation of the classifier
- Regression output (continuous load) instead of three classes
