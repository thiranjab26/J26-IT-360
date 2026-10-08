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
- [ ] 🧑 **Camera-required policy (decided by owner 2026-10-07, needs approval):** you want study pages to require the camera. This breaks invariant 4 ("opt-in, off by default, AdaptLearn works with it off"), contradicts the survey finding (45.8 % not comfortable) and changes what the ethics application must say. Get written OK from the supervisor and the ethics reviewer, then update CLAUDE.md invariant 4. Until then the code ships `cameraPolicy: 'optional'` (A5) and `'required'` stays off.
- [ ] 🧑 Share the proposed wellbeing fields (`presence`, `fatigue`, `affect`, `strain`; ARCHITECTURE.md §8a) with C01/C03/C04 and agree names and meanings (invariant 5).

### A1. Scaffold

- [x] Vite + TypeScript (strict) project with the folder layout in CLAUDE.md
  - Lives at `packages/load-sensor/` as pnpm workspace package `@adaptlearn/load-sensor` (ADR 0004); training goes in `research/c2-load/`. TypeScript pinned to 5.9.3 and `@types/node` to 22.20.4 to match the rest of the workspace — newer versions changed peer resolution for teammates' packages, and typescript-eslint does not yet support TS 7. Use `pnpm`, not `npm`; on this machine `corepack pnpm` (no admin rights for `corepack enable`).
- [x] ESLint + Prettier; Vitest; Playwright
  - ESLint 10 flat config with typescript-eslint `strictTypeChecked`; Prettier last. Vitest 5 needs Node `^22.12 || ^24`, so the package `engines` is `^22.13.0 || >=24.0.0` (stricter than the root's `>=20`). Playwright e2e runs against `vite build && vite preview` with a fake camera; Chromium only for now, Firefox/Edge come with the bench (A7).
- [x] npm scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `test`, `test:e2e`, `bench`
  - Run with `pnpm`. Added `check` (typecheck + lint + unit tests = definition of done) and `format`. `bench` is a stub that exits 1 with "not implemented" until A7, so a missing benchmark can never look like a pass.
- [x] `.gitignore` covering `data/`, `training/data/`, model caches, `.env`
  - In `packages/load-sensor/.gitignore` and `research/c2-load/.gitignore` (root file is leader-owned and already covers `.env*`). Also ignores all video files and test images (invariant 2), and downloaded FaceMesh/WASM assets. Committed on purpose: `public/models/MANIFEST.json` (source + checksum lock for `fetch-models`) and our trained classifier, whose `.bin` shards are re-included against the root `*.bin` rule. Rules verified with `git check-ignore`.
- [x] ESLint rules: no CDN hostnames in `src/`; no network APIs in `src/core` outside the model loader; `events/` and `recorder/` may not import `camera/`
  - `packages/load-sensor/eslint/privacy.js`, proven by 35 cases in `tests/unit/eslint-privacy.test.ts` (rules switched off → 20 fail). Extras beyond the item: frame-export ban (`toDataURL`, `toBlob`, `convertToBlob`, `captureStream`) in all of `src/` (invariant 1); `events/`/`recorder/` also barred from `landmarks/` (the 478-point mesh must not reach the recorder, §9); `index.html` checked for CDN hosts. The exempt loader is `src/core/model-loader.ts` (not created yet). Flat config replaces rule options per file, so core repeats the `src/` selectors.
- [x] CI workflow (GitHub Actions): typecheck, lint, unit tests on push
  - `.github/workflows/c2-load-sensor.yml`, path-filtered to the package and lockfile, Node 24, actions pinned to commit SHAs, read-only token. Passes actionlint and a local `--frozen-lockfile` run; not yet run on GitHub. `.github/` is leader-owned, so the PR needs the leader's review. E2E joins CI with the privacy tests (A7).

### A2. Camera [FR1, NFR4]

- [x] `camera/`: `getUserMedia` 640×480, frame loop on `requestVideoFrameCallback` with rAF fallback
  - `Camera` class (`src/core/camera/camera.ts`). Constraints are all `ideal` (never `exact`) so any webcam is accepted (NFR4); no audio. Frame time is rVFC `metadata.mediaTime`, or `video.currentTime` under rAF (duplicate display refreshes skipped); non-increasing timestamps are dropped. Video element is injectable so the demo shows the preview; the camera never reads pixels.
- [x] Handle permission denied, no camera, camera in use → distinct `status` values
  - `CameraStatus`: `permission_denied`, `no_camera`, `camera_in_use`, `unsupported` (no https / no mediaDevices), `error`, plus `idle/starting/active/paused/stopped`. `start()` resolves with the status, never rejects. A track ending on its own (unplugged, revoked) → `no_camera`. **Open for A5:** `LoadStateEvent.status` (ARCHITECTURE.md §8) only has `permission_denied`/`unsupported`; either map `no_camera`/`camera_in_use` onto those or agree new values with C01/C03/C04 (invariant 5 — needs your decision).
- [x] `visibilitychange` → pause / resume
  - Pause reasons are a set (`user`, `hidden`): returning to the tab does not undo a user's own pause. Starts paused if the tab is hidden when permission arrives.
- [ ] `disable()` stops all tracks (camera LED off) — verify by hand
  - Implemented as `Camera.stop()` (public `disable()` arrives with A5): stops every track, detaches the stream, removes listeners; also releases a stream granted after stop was pressed during the permission prompt. Unit-tested and e2e-checked (`live-tracks` = 0). **Still to do by hand:** watch the laptop LED go off on "Turn sensing off".
- [x] Unit tests with a mocked `MediaStream`
  - `tests/unit/camera/*` with doubles in `tests/unit/helpers/fake-media.ts` (Node, no jsdom). e2e `tests/e2e/camera-landmarks.spec.ts` covers the real browser path with the fake camera, pause/resume, and permission denied.

### A3. Landmarks — adapter A [FR1, FR7]

- [x] `npm run fetch-models`: download face mesh model files once into `public/models/facemesh/`, verify checksum, write `MANIFEST.json`
  - `pnpm fetch-models` (`scripts/fetch-models.ts`). Fetches the BlazeFace short-range detector and the attention mesh from their tfhub.dev URLs (now redirect to Kaggle storage) and copies the three `tfjs-backend-wasm` binaries from `node_modules` into `public/wasm/`. `MANIFEST.json` is a committed lock (source, licence, SHA-256, bytes); a checksum mismatch fails and writes nothing. `--verify` checks offline; `--update-lock` is the deliberate upgrade path. Shard names from remote `model.json` are restricted to plain file names. Writes are atomic (temp dir + rename).
- [x] `LandmarkProvider` interface + `TfjsFaceMeshProvider` (tfjs runtime, iris refinement, local model URLs)
  - Config names confirmed in face-landmarks-detection 1.0.6: `detectorModelUrl`, `landmarkModelUrl`. Output normalised to a flat `Float32Array` (478×3, x/width, y/height, z/width) — no per-frame object allocation. `FaceResult.score` is `number | null` (ARCHITECTURE.md §3 updated): the tfjs runtime filters by face presence internally but does not return the score. `staticImageMode: false` so the detector only re-runs when tracking is lost. TF.js loads lazily in `init()`. All asset URLs pass `resolveSameOriginAsset()` (`src/core/model-loader.ts`), which refuses cross-origin URLs before anything is fetched. `@mediapipe/face_mesh`/`face_detection` (peer deps for the unused mediapipe runtime) are aliased to a throwing stub in `vite.config.ts`: they do not bundle as ESM under Vite 8 and default to cdn.jsdelivr.net. The bundle still contains the library's unused tfhub.dev default constants; a unit test asserts both URLs are always overridden. TF.js packages are modular (`tfjs-core`, `-converter`, `-backend-webgl`, `-backend-wasm`, all 4.22.0) so the cpu backend is never registered.
- [x] Backend selection: webgl → wasm; refuse plain cpu with `status: "unsupported"`
  - `selectBackend()` (`src/core/landmarks/backend.ts`) also rejects a backend if TF.js reports a different one after `setBackend`. Failure throws `UnsupportedBackendError` (listing each reason); the demo shows it, A5 maps it to `status: "unsupported"`.
- [x] Skip-frame scheduling (never queue), target 15 fps
  - `FrameGate` (`camera/frame-gate.ts`) + `LandmarkTracker` (`landmarks/landmark-tracker.ts`). One inference in flight; rate cap on frame time with 20 % early tolerance so 30 fps camera jitter still gives 15 fps (not 10). Counts dropped-busy vs dropped-rate separately. Adaptive rate (15→12→10) is not wired yet: needs bench numbers (A7).
- [x] Debug overlay: draw landmarks, show fps, backend, frame time p50/p95
  - `src/demo/debug-overlay.ts`: points only on a transparent canvas (no camera pixels on it), irises in a second colour, mirrored like the preview. Read-out: camera status, live tracks, frame clock, resolution, landmark fps, inference p50/p95 (NumPy-style percentile over the last 128 frames), skipped frames, face found, TF.js tensor count, errors. Frame time here = time inside `estimate()`; the §11 frame-latency definition is for the bench (A7).
- [ ] Confirm with DevTools Network tab: no requests after initial load
  - Automated equivalent passes: `tests/e2e/camera-landmarks.spec.ts` asserts every request is same-origin and that none happen during 5 s of sensing (Chromium, fake camera). **Still to do by hand:** open DevTools → Network on the real webcam and screenshot it for the evidence folder.

### A4. Features [FR2, FR3, FR8]

- [ ] Landmark index constants in one file, each verified on the debug overlay
  - `src/core/features/landmark-indices.ts`. Every index is checked automatically against `MEDIAPIPE_FACE_MESH_KEYPOINTS_BY_CONTOUR` from face-landmarks-detection (`tests/unit/features/landmark-indices.test.ts`), which caught nothing but would catch a left/right swap. The demo's **Feature points** switch rings and numbers each one. **Still to do by hand:** turn it on with your real face and check each label sits where its comment says (≈1 min), then tick.
- [x] `ear()`, inter-ocular normalisation
  - `features/eye.ts`. EAR uses 3D distances (2D would read a lowered head as closing eyes). IOD = distance between eye-corner midpoints (pupils move with gaze). Landmarks are rescaled by frame aspect so all axes share one unit (`geometry.ts`).
- [x] Blink state machine using frame timestamps and a baseline-relative threshold
  - `features/blink.ts`: close below 75 % / reopen above 85 % of open-eye EAR (hysteresis), 80–500 ms = blink, longer = long closure. Closure start/end are midpoints between frames, so durations are within one frame interval at 10–60 fps (tested). EAR is not smoothed: at 15 fps a blink is only 2–5 frames. Open-eye EAR = 10 s running median until calibration ends, then frozen.
- [x] Iris offset → gaze proxy; dispersion
  - Measured along the face's own axes, so turning the head does not fake an eye movement (tested at 25° yaw + 15° roll). Called a proxy everywhere: it cannot say where on the screen someone looks.
- [x] Head pose (yaw/pitch/roll) from landmarks
  - `features/head-pose.ts`: axes from outer eye corners and forehead→chin, Gram–Schmidt, decomposed as Ry·Rx·Rz. Recovers synthetic poses to <0.001° up to ±40°. Signs documented and tested (yaw + = subject turns to their right; pitch + = head down). Features use pose relative to the learner's neutral and its variability, never absolute angles.
- [x] Brow raise, brow furrow; mouth-open, lip-press (expression proxies)
  - Named for what they measure: `browInnerGap` and `lipThickness` fall when furrowing / pressing (ARCHITECTURE.md §5.1, §5.3 updated). All divided by IOD.
- [x] Drowsiness signals (ARCHITECTURE.md §8a): PERCLOS (share of time eyes ≥ 80 % closed over 60 s), long-blink count (> 500 ms), yawn events (sustained mouth-open), head-nod events (pitch drop + recovery). Thresholds baseline-relative and commented.
  - Eyes-closed fraction per second (PERCLOS proxy over 60 s), long closures from the blink detector, `YawnDetector` (gap > 0.45 IOD for ≥ 1.5 s), `NodDetector` (pitch drop > 15° and back within 2.5 s; looking down longer is not a nod). Counts are in each second's `aux`, not in the 14 model features. The fatigue *classification* is A5.
- [x] Presence signals: face present / looking away (head pose or gaze off-screen for > N s) / absent (no face > 2 s)
  - `window/presence.ts`: away = off-screen (yaw > 25°, pitch > 20° or iris > 0.18 eye widths from neutral) continuously for > 3 s; absent = no face > 2 s.
- [x] Per-second aggregator → feature vector (F=14) + `validRatio`
  - `window/second-aggregator.ts`. Seconds on the frame clock; gaps (tab hidden) are emitted as empty invalid seconds. Head speed in deg/s from frame time, so it is rate-independent (tested at 10/15/30 fps). Std is population std (NumPy default).
- [x] 30 s ring buffer; face-loss rules from ARCHITECTURE.md §5.5
  - `window/feature-window.ts`: classifiable only when full and ≤ 30 % invalid; invalid rows are zeroed in the model input with a mask, never interpolated. Recalibration after > 5 min absent. **Changed from §5.5:** features no longer "hold last values" through short face loss (it would bias dispersion/speed to 0); §5.5 updated.
- [x] Baseline calibration (60 s) and z-scoring
  - `window/baseline.ts`: first 60 *valid* seconds; population std; std < 1e-6 → z = 0; z clipped to ±5. Gaze/pose neutral and open-eye EAR freeze at the same moment.
- [x] `useExpressionFeatures` flag
  - Zeroes features 12–13 and nothing else (tested). Fixed per pipeline: switching it in the demo starts a new calibration, because mixing baselines would corrupt the ablation.
- [x] `feature_spec.json` generator with a version hash
  - `pnpm feature-spec` → `public/models/classifier/feature_spec.json` (committed): names, order, units, validity, normalisation, ablation and every threshold in `FEATURE_CONFIG`, plus `code_hash` = SHA-256 over the spec and all `features/` + `window/` sources. A unit test fails when the file is stale (`--check` does the same from the CLI).
- [ ] Fixtures: record a few landmark sequences from yourself (blinking on purpose, looking away, turning head, leaving frame) — arrays only, no images
  - Tool ready: the demo's **DEV · Fixture recorder** (dev server only; not in production builds) saves only the ~40 feature landmarks as numbers. Put files in `tests/fixtures/`; `recorded-fixtures.test.ts` runs them automatically and checks the blink count if you enter how many you made. **Needs you:** record blinks / look-away / head-turn / leave-frame (20 s each).
- [x] Unit tests per feature against fixtures, including "same result at 10 fps and 30 fps"
  - Synthetic face with known ground truth (`tests/fixtures/synthetic-face.ts`, geometry only) drives 100+ feature tests; the rate test compares all 14 features over 30 s at 10 vs 30 fps with jitter. Real recordings join automatically once recorded.
- [x] Live feature strip chart in the debug overlay (you will stare at this a lot)
  - Signals dashboard: calibration progress, KPI tiles (presence, blink rate, eyes-closed %, head pose, drowsiness events, gaze pad), per-frame EAR trace with threshold and blink markers, and the 14 features as small multiples (raw / z-score) with a shared hover crosshair and calibration / no-face bands. Canvas, theme-aware, one hue per single-series chart, no chart library.
  - Demo split into **Camera** and **Signals** tabs; on Signals the camera docks as a mini preview, so the video keeps delivering frames (e2e-checked). Display-only smoothing: the overlay uses a One Euro filter (`src/demo/one-euro.ts`) and eases between 15 fps samples at screen rate; charts draw monotone curves (pass through every point, no overshoot, so blink dips keep their depth) and scroll continuously. **The feature pipeline still gets raw landmarks**: smoothing there would blunt 2–5-frame blinks and is a research-method change.
  - Camera tab now has a **Wellbeing** column (`src/demo/wellbeing-panel.ts`): away/asleep alarm, screen time with eye (20 min, 20-20-20 rule) and movement (30 min) break reminders, and health tips (tiredness signs make "take a walk" the featured tip). Read-outs moved to a **Performance** tab. The alarm (`src/demo/attention-alarm.ts`) beeps via Web Audio (no sound file, works offline) after 5 s with no face or 3 s of continuously closed eyes, gets louder over 20 s, and stops when the face or open eyes return. Switchable; the choice is kept in localStorage. Thresholds are hand-picked demo defaults, not validated. **Must be off in `STUDY_MODE` (B1):** a beep is an intervention and would change the workload being measured.
    
### A5. Events and public API [FR5, FR6, NFR8]

- [ ] `LoadStateEvent` type + runtime validator
- [ ] `createLoadSensor()` with `enable / pause / resume / disable / on / getState`
- [ ] Heartbeat every 5 s + emit on change
- [ ] `BroadcastChannel` publisher
- [ ] Placeholder classifier: a transparent rule (e.g. weighted z-scores) clearly labelled `model_version: "heuristic-0"` so nobody mistakes it for the trained model
- [ ] Heuristic `engagement` and `frustration`
- [ ] Heuristic wellbeing fields (§8a), each clearly labelled heuristic: `presence`, `fatigue` (Low/Medium/High), `affect` (coarse mood from expression proxies, switchable with `useExpressionFeatures` for the FR3 ablation), `strain` (accumulated load over the day: time on task, time at High load, fatigue trend, minutes since last break) + `suggest_break` boolean. Day totals are derived numbers kept on the device only.
- [ ] `cameraPolicy: 'optional' | 'required'` option; default `'optional'`. `'required'` only after the A0 approval item is ticked.
- [ ] **Single integration file** `packages/load-sensor/src/signals.ts`: the one module teammates import. Exports the event types, `subscribe(callback)`, one helper per signal (`onLoadChange`, `onPresenceChange`, `onFatigueChange`, `onAffectChange`, `onStrainChange`), `getLatestSignal()`, and the `BroadcastChannel` name for other tabs/iframes. Documented field by field in `INTEGRATION.md`. HTTP endpoints in `backend/services/load-service/` only if a teammate's component runs on a server (A0 question).
- [ ] EMA smoothing + hysteresis, unit-tested for no flapping on noisy input
- [ ] `INTEGRATION.md` for teammates: install, 10-line example, field meanings, what `null` means
- [ ] Tiny mock consumer page that subscribes and prints events (give this to teammates)

### A6. Consent and control UI [survey findings: 45.8 % not comfortable, 54.2 % want a toggle]

- [ ] Plain-language consent screen: what is processed, that nothing is uploaded or recorded, how to turn it off
- [ ] Sensing off by default; visible on/off toggle; visible "camera active" indicator
  - If `cameraPolicy: 'required'` is approved (A0), this becomes a "turn on the camera to start studying" gate instead of an off-by-default toggle; the indicator and the off switch stay.
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
