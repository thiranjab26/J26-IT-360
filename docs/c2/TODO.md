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
  - Also share the four proposed `status` values added in A5 (`starting`, `no_camera`, `camera_in_use`, `error`) and the rule "unknown status = treat as `disabled`". Send them `packages/load-sensor/INTEGRATION.md`; it is written for them.

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
  - `CameraStatus`: `permission_denied`, `no_camera`, `camera_in_use`, `unsupported` (no https / no mediaDevices), `error`, plus `idle/starting/active/paused/stopped`. `start()` resolves with the status, never rejects. A track ending on its own (unplugged, revoked) → `no_camera`. **Resolved in A5 (owner, 2026-10-10):** `no_camera`, `camera_in_use`, `error` and `starting` were added to `LoadStateEvent.status` as proposed values, pending agreement (A0).
- [x] `visibilitychange` → pause / resume
  - Pause reasons are a set (`user`, `hidden`): returning to the tab does not undo a user's own pause. Starts paused if the tab is hidden when permission arrives.
- [x] `disable()` stops all tracks (camera LED off) — verify by hand
  - Implemented as `Camera.stop()` (public `disable()` arrives with A5): stops every track, detaches the stream, removes listeners; also releases a stream granted after stop was pressed during the permission prompt. Unit-tested and e2e-checked (`live-tracks` = 0). Verified by hand 2026-10-10: laptop LED goes off on "Turn sensing off".
- [x] Unit tests with a mocked `MediaStream`
  - `tests/unit/camera/*` with doubles in `tests/unit/helpers/fake-media.ts` (Node, no jsdom). e2e `tests/e2e/camera-landmarks.spec.ts` covers the real browser path with the fake camera, pause/resume, and permission denied.

### A3. Landmarks — adapter A [FR1, FR7]

- [x] `npm run fetch-models`: download face mesh model files once into `public/models/facemesh/`, verify checksum, write `MANIFEST.json`
  - `pnpm fetch-models` (`scripts/fetch-models.ts`). Fetches the BlazeFace short-range detector and the attention mesh from their tfhub.dev URLs (now redirect to Kaggle storage) and copies the three `tfjs-backend-wasm` binaries from `node_modules` into `public/wasm/`. `MANIFEST.json` is a committed lock (source, licence, SHA-256, bytes); a checksum mismatch fails and writes nothing. `--verify` checks offline; `--update-lock` is the deliberate upgrade path. Shard names from remote `model.json` are restricted to plain file names. Writes are atomic (temp dir + rename).
- [x] `LandmarkProvider` interface + `TfjsFaceMeshProvider` (tfjs runtime, iris refinement, local model URLs)
  - Config names confirmed in face-landmarks-detection 1.0.6: `detectorModelUrl`, `landmarkModelUrl`. Output normalised to a flat `Float32Array` (478×3, x/width, y/height, z/width) — no per-frame object allocation. `FaceResult.score` is `number | null` (ARCHITECTURE.md §3 updated): the tfjs runtime filters by face presence internally but does not return the score. `staticImageMode: false` so the detector only re-runs when tracking is lost. TF.js loads lazily in `init()`. All asset URLs pass `resolveSameOriginAsset()` (`src/core/model-loader.ts`), which refuses cross-origin URLs before anything is fetched. `@mediapipe/face_mesh`/`face_detection` (peer deps for the unused mediapipe runtime) are aliased to a throwing stub in `vite.config.ts`: they do not bundle as ESM under Vite 8 and default to cdn.jsdelivr.net. The bundle still contains the library's unused tfhub.dev default constants; a unit test asserts both URLs are always overridden. TF.js packages are modular (`tfjs-core`, `-converter`, `-backend-webgl`, `-backend-wasm`, all 4.22.0) so the cpu backend is never registered.
- [x] Backend selection: webgl → wasm; refuse plain cpu with `status: "unsupported"`
  - `selectBackend()` (`src/core/landmarks/backend.ts`) also rejects a backend if TF.js reports a different one after `setBackend`. Failure throws `UnsupportedBackendError` (listing each reason); the demo shows it, A5 maps it to `status: "unsupported"`.
- [x] **Bug found 30 Oct (P1): the WASM fallback could not run the attention mesh.** The landmark model (`refineLandmarks: true`) contains int32 `BatchMatMulV2` ops (SpatialTransformer), and tfjs-backend-wasm 4.22.0 throws "BatchMatMul for non non-float32 tensors not yet supported". Reproduced in Chromium (dev server, `backends: ['wasm']`, one AFLW2000 face): WASM threw on the frame, WebGL found the face. So a device without WebGL selected `wasm`, reported "Sensing is on" and never produced landmarks. The e2e WASM test (`csp.spec.ts`) missed it because its fake camera shows no face, so the landmark model never runs.
  - Fix: `src/core/landmarks/wasm-int-matmul.ts`, called in `TfjsFaceMeshProvider` after the WASM import. It wraps the WASM BatchMatMul kernel: int32 operands are cast to float32, multiplied and cast back, which is exact below 2^24 (the operands are pixel indices). Float32 inputs use the original kernel unchanged. Unit test on the real WASM backend in Node (`tests/unit/landmarks/wasm-int-matmul.test.ts`): unpatched throws, patched is exact, no tensor leak, float path unchanged.
  - After the fix, same face in Chromium: WASM finds it; max |WASM − WebGL| = 0.00043 (normalised, about 0.2 px on 450 px).
  - Still open: an e2e test with a real face on the WASM path needs a face clip as fake camera (see the A7 🧑 item about recording one).
- [x] **Flaky e2e under CPU load (found 30 Oct, not an app bug):** `acceptConsent()` asserted `toBeHidden()` on the consent dialog after Agree. Cause, reproduced: the dialog fades out over 0.26 s and keeps its box (`display: block`, opacity 0, `open` already false) until the fade's end is processed; Agree starts the face-model load at once, which blocks the main thread, so Playwright saw it as "visible". It passed 3/3 when the machine was quiet and failed 2/4 while the landmark extraction held the CPU at 100 %. The app works (the trace shows Agree accepted and the model loading).
  - Fixed 30 Oct: `acceptConsent()` checks the dialog lost `open` and the sensing switch turned on (`expectCameraOn: false` for the denied-camera test). Full e2e 30 Oct: 20 passed + the camera spec 3/3 on rerun.
  - Fix in `tests/e2e/helpers.ts`: assert the dialog is closed (`open` attribute gone) and that it closed as Agree (sensing switch `aria-checked="true"`, so a missed click that declines still fails). That part passes under load.
  - Still to do: run the full e2e suite when the extraction has finished. Under 100 % CPU, later 5 s checks (`camera-status` = `active`) also time out because the page cannot repaint; that is the load, not the app, but it must be confirmed on a quiet machine before ticking this.
- [x] Skip-frame scheduling (never queue), target 15 fps
  - `FrameGate` (`camera/frame-gate.ts`) + `LandmarkTracker` (`landmarks/landmark-tracker.ts`). One inference in flight; rate cap on frame time with 20 % early tolerance so 30 fps camera jitter still gives 15 fps (not 10). Counts dropped-busy vs dropped-rate separately. Adaptive rate (15→12→10) is not wired yet: needs bench numbers (A7).
- [x] Debug overlay: draw landmarks, show fps, backend, frame time p50/p95
  - `src/demo/debug-overlay.ts`: points only on a transparent canvas (no camera pixels on it), irises in a second colour, mirrored like the preview. Read-out: camera status, live tracks, frame clock, resolution, landmark fps, inference p50/p95 (NumPy-style percentile over the last 128 frames), skipped frames, face found, TF.js tensor count, errors. Frame time here = time inside `estimate()`; the §11 frame-latency definition is for the bench (A7).
- [x] Confirm with DevTools Network tab: no requests after initial load
  - Automated equivalent passes: `tests/e2e/camera-landmarks.spec.ts` asserts every request is same-origin and that none happen during 5 s of sensing (Chromium, fake camera). Verified by hand 2026-10-10 (Chrome, real webcam): after the one-time lazy load of TF.js chunks + the two models (all same-origin, cache/304), Network stays empty for 60 s of sensing. Screenshot: `docs/evidence/network-idle.png`. Clear the log only after the face points appear, or the lazy load shows up.

### A4. Features [FR2, FR3, FR8]

- [x] Landmark index constants in one file, each verified on the debug overlay
  - `src/core/features/landmark-indices.ts`. Every index is checked automatically against `MEDIAPIPE_FACE_MESH_KEYPOINTS_BY_CONTOUR` from face-landmarks-detection (`tests/unit/features/landmark-indices.test.ts`), which caught nothing but would catch a left/right swap. The demo's **Feature points** switch rings and numbers each one. Verified by hand 2026-10-10 on a real face (mirrored preview): every label sits where its comment says.
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
  - Eyes-closed fraction per second (PERCLOS proxy over 60 s), long closures from the blink detector, `YawnDetector` (gap > 0.45 IOD for ≥ 1.5 s), `NodDetector` (pitch drop > 15° and back within 2.5 s; looking down longer is not a nod). Counts are in each second's `aux`, not in the 14 model features. The fatigue _classification_ is A5.
- [x] Presence signals: face present / looking away (head pose or gaze off-screen for > N s) / absent (no face > 2 s)
  - `window/presence.ts`: away = off-screen (yaw > 25°, pitch > 20° or iris > 0.18 eye widths from neutral) continuously for > 3 s; absent = no face > 2 s.
- [x] Per-second aggregator → feature vector (F=14) + `validRatio`
  - `window/second-aggregator.ts`. Seconds on the frame clock; gaps (tab hidden) are emitted as empty invalid seconds. Head speed in deg/s from frame time, so it is rate-independent (tested at 10/15/30 fps). Std is population std (NumPy default).
- [x] 30 s ring buffer; face-loss rules from ARCHITECTURE.md §5.5
  - `window/feature-window.ts`: classifiable only when full and ≤ 30 % invalid; invalid rows are zeroed in the model input with a mask, never interpolated. Recalibration after > 5 min absent. **Changed from §5.5:** features no longer "hold last values" through short face loss (it would bias dispersion/speed to 0); §5.5 updated.
- [x] Baseline calibration (60 s) and z-scoring
  - `window/baseline.ts`: first 60 _valid_ seconds; population std; std < 1e-6 → z = 0; z clipped to ±5. Gaze/pose neutral and open-eye EAR freeze at the same moment.
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
  - **Fix 2026-10-18 (typing read as eyes closed / away; away alarm):** new `FEATURE_CONFIG.lookDown` and `LookDownTracker` (`src/core/features/look-down.ts`). Looking down = head ≥ 10° below neutral (at once) or iris ≥ 0.06 eye widths below neutral, read only with the eye clearly open, held 300 ms. While looking down the blink thresholds drop to 0.4 / 0.5 of open EAR (the lid follows the gaze; a shut eye is still under 0.4), a closure in progress at the onset is dropped, and a keyboard look (yaw within 25°, pitch ≤ 45°) is not off-screen. A nod now needs the eyes shut during the drop (a glance at the keys is the same head movement with the eyes open). `FrameFeatures.lookingDown` added. This changes `eyes_closed_fraction`, blink features, nods and `offScreenFraction`, so `feature_spec.json` was regenerated (no trained model or Python parity suite exists yet). All thresholds are hand-picked (tune), to check against recorded typing sessions. Demo alarm: new `away` reason (face visible, off-screen 8 s), and the absent and away beeps are now deep triangle-wave tones (165–220 Hz); asleep stays high.
  - **Break** tab (`src/demo/break/`): two calm, offline games. _Neck stretch_ steers an orb with head pose relative to a neutral captured at the start (8 gentle turn/tilt targets, 2.5 s hold, a wobble drains the hold rather than resetting it; frame gaps never count). _Memory match_ (12 or 16 cards, CSS 3D flips, keyboard playable, best score in localStorage). Low-end measures: one canvas with a cached background, pre-rendered glow sprites (no `shadowBlur`), fixed particle pool, DPR 1 on ≤ 4-core machines, loops stop when hidden or idle. Finishing a game counts as a break in the Wellbeing panel. Logic unit-tested; memory game played to the end in e2e with zero network requests. Games also stay out of `STUDY_MODE`.
  - **Cog admin panel** (`cog-admin.html`, `src/cog-admin/`; named so it cannot clash with other components' admin pages; no login yet): live overview (camera, fps, p95, face, screen time, alarm, calibration), session commands (pause / resume / off / recalibrate / mark a break), and settings for rate cap, feature-point overlay, expression features (FR3), alarm on/off, timings and volume, and break intervals. Settings live in localStorage (`src/demo/settings.ts`, sanitised and clamped, unit-tested) and reach the sensor page live via the `storage` event; status and commands use a same-origin `BroadcastChannel` carrying counters only. It cannot turn sensing _on_: that stays on the sensor page with the camera and consent (invariant 4). `FEATURE_CONFIG` is shown read-only because it is baked into `feature_spec.json`. The cognitive-load card says "Model pending" until the classifier ships. e2e: settings sync both ways, remote pause/resume/off, no cross-origin requests.
  - Neck-stretch fixes after real-face testing: targets are _reach_ goals ("this far or further" in a direction, a cone sideways), so overshooting no longer fails; reach angles lowered (18° yaw, 11–13° pitch, 11° roll) because landmark pose reads below the true rotation; 3° hysteresis and a 300 ms grace before the hold drains; neutral = median of a steady 1.2 s (restarts while the head still moves); "face not in view" only after 700 ms; frame steps up to 600 ms count, so 4–8 fps laptops can finish. All hand-picked, not measured; each case unit-tested.

### A5. Events and public API [FR5, FR6, NFR8]

- [x] `LoadStateEvent` type + runtime validator
  - `src/core/events/types.ts` + `validate.ts` (hand-written, no schema library). Besides types it enforces `confidence` null ⇔ `load_state` null, estimates null unless `active`, presence/strain null unless frames flow, and unknown fields only as primitives, so an array (landmarks) or object can never ride inside an event (FR7). The hub validates every event before it leaves; a failing one is reported on `error` and not published. Consumers validate again, since any same-origin script can post on the channel.
  - **Status values (owner decision 2026-10-10):** added `starting`, `no_camera`, `camera_in_use`, `error` as _proposed_; consumers treat unknown statuses like `disabled` (invariant 5, A0).
- [x] `createLoadSensor()` with `enable / pause / resume / disable / on / getState`
  - `src/core/sensor.ts`; also `markBreak`, `recalibrate`, `destroy`, `studyGate`. **Synchronous**, not `await createLoadSensor()` as §8 sketched: nothing may load before opt-in. `enable()` never rejects; disable during model load wins (generation counter); `pagehide` disables. `on()` events: `state` (every event), `change` (real changes), `error`. Tested end to end in Node with the fake camera + synthetic face: reaches `active` after the baseline + 30 s window (60 s baseline until 2026-10-14, now 30 s) (`tests/unit/sensor.test.ts`).
  - **Changed from §5.5:** a non-classifiable window with the face _visible_ (filling, or refilling after a gap) reports `calibrating`, not `no_face`; `no_face` only when presence is `absent`. §8 updated.
- [x] Heartbeat every 5 s + emit on change
  - "Change" = any field except `timestamp`, `meta`, `confidence`; otherwise every second would be an event. The heartbeat is re-armed on each emission, so the gap never exceeds 5 s (tested over a simulated 30 min). Consumers call a signal stale after 12 s (2 missed heartbeats + 2 s).
- [x] `BroadcastChannel` publisher
  - `adaptlearn.load-state`. Also answers `{ type: 'adaptlearn.load-state.request' }` with the latest event, so a new consumer need not wait for a heartbeat. Works without BroadcastChannel (in-page listeners only). Unit tests structured-clone every message as the browser does.
- [x] Placeholder classifier: a transparent rule (e.g. weighted z-scores) clearly labelled `model_version: "heuristic-0"` so nobody mistakes it for the trained model
  - `src/core/classifier/heuristic.ts`: weighted mean of baseline z-scores (blink count −1, inner-brow gap −1, lip thickness −0.5; only the signs are motivated) → ordinal logistic → 3 probabilities. Lip weight dropped when `useExpressionFeatures` is false. The `LoadClassifier` interface is synchronous so the TF.js model (`predict` + `dataSync`) drops in. The demo badge and the cog-admin card show `heuristic-0`.
- [x] Heuristic `engagement` and `frustration`
  - `src/core/heuristics/estimators.ts`; thresholds in `heuristics/config.ts` (all **(tune)**, unvalidated). Engagement = face-present × (½ on-screen + ½ gaze-centred) over 30 s; frustration = published High ≥ 15 s and brow furrow or lip press ≥ 1 z.
- [x] Heuristic wellbeing fields (§8a), each clearly labelled heuristic: `presence`, `fatigue` (Low/Medium/High), `affect` (coarse mood from expression proxies, switchable with `useExpressionFeatures` for the FR3 ablation), `strain` (accumulated load over the day: time on task, time at High load, fatigue trend, minutes since last break) + `suggest_break` boolean. Day totals are derived numbers kept on the device only.
  - Fatigue: points from the PERCLOS proxy (≥ 0.08 / ≥ 0.15), long closures, yawns, nods. Affect is `null` when expression features are off. Strain: points from time on task, time at High, time since break, fatigue High; `suggest_break` = strain High or fatigue High for 2 min. Fatigue, affect and engagement go through the same hysteresis as load.
- [x] Demo-only **Mood** card on the Signals tab (`src/demo/mood.ts`, `mood-panel.ts`): apparent mood (happy, sad, surprised, frustrated, confused, drowsy, focused, distracted, neutral, no face) from expression and eye behaviour against the learner's own baseline, 3 s confirm hysteresis, evidence bars, 5-min timeline, latest changes.
  - Display only: not in `LoadStateEvent`, not a model input, outside `src/core/features` and `src/core/window`, so `feature_spec.json` and its `code_hash` are unchanged. Two extra display measures, mouth-corner lift and width, use the inner corners 78/308 (the library's lips contour omits 291). Expression rules wait for the baseline and switch off with the FR3 expression features. Thresholds are hand-picked (tune), unvalidated; labelled as apparent expression, not felt emotion (Barrett et al. 2019). Putting mood into the event stream would be a contract change (invariant 5) and needs the team's agreement and ethics review first.
  - **Fix 2026-10-18 (random moods, z tab):** the mood now keeps its own robust baseline (median, MAD) for all six face measures, with a spread floor per measure (`MOOD_CONFIG.minSpread`, 0.01–0.03 IOD, tune). Before, brow and lip rules used the pipeline z, whose floor is `minStd` 1e-6: after a still calibration a sub-pixel shift gave z ≫ 2 and "frustrated" or "confused" appeared at random (reproduced in `mood.test.ts`). Also: blink frames and turned-head frames are skipped for every measure, the face baseline restarts on a pipeline recalibration, stricter brow and lip thresholds, and a showing mood keeps until its evidence drops below 0.7 × the entry level. Signals tab z mode now shows z units (it used the raw formatter, so a z of 1.2 read as "120 %" or "1 ms") and always keeps ±2 in range, so baseline noise is not stretched to full height. Pipeline z and `feature_spec.json` are unchanged.
  - **Owner decision 2026-10-10:** strain totals live in `localStorage` (`adaptlearn.c2.strain.v1`), today only: six numbers and a date, overwritten by the next day, memory-only when storage is blocked. 5 min without a face (or with sensing off) = a break. The demo's own 2-min "away = break" timer does not feed strain; only "I took a break", a finished break game and the admin command do.
- [x] Display-only **boredom** heuristic (ARCHITECTURE.md §8b): points from yawns (1 / 2 / 3 for 1 / 2 / 3+ in 5 min: one yawn alone is not enough, two = possibly, three+ = bored), underload, low engagement, gaze wandering, restless head (+1 each over 60 s); `bored` ≥ 3, `possibly_bored` ≥ 2; vetoes: drowsy eyes (PERCLOS ≥ 0.15 or a nod) → `tired`, load mostly High → `not_bored`. Boredom card on the **Signals** tab next to Mood: state, points, evidence rows with the points each earns, 5-min timeline. Camera tab left clean.
  - Answers the supervisor panel's "no clear way to tell whether a person is bored". Not in `LoadStateEvent` (invariant 5), not a model input, so `feature_spec.json` is unchanged. Thresholds hand-picked (tune), unvalidated. 🧑 Get the definition agreed with the supervisor; add the Underload block and the boredom self-report item to B1.
  - **Redesign 2026-10-20:** v1 (Low load as a hard gate, `fatigue` High as veto) never fired on yawning: `heuristic-0` rarely publishes Low, and yawns raise `fatigue` themselves. Now Low load is one point and the tired veto reads the eyes (PERCLOS, nods), not `fatigue`. 16 unit tests in `tests/unit/heuristics/boredom.test.ts`, incl. "a yawn's own eye squeeze does not make it tired".
  - **Live test fix 2026-10-20:** five test yawns read 16 % "eyes closed" (→ `tired`) and 78 % High load: the eyes shut during each yawn, and `heuristic-0` reads a yawn as High (stretched lips ≈ pressed, shut eyes ≈ fewer blinks). Now 8 s before to 2 s after each yawn is left out of the eyes-closed measure, and load published within 30 s after a yawn is left out of the "busy" veto. Card shows what it is waiting for (baseline, no face, warming up) instead of "Not sensing". Second live test: two yawns alone read as `bored` because the yawns' own iris jumps scored gaze wandering (z +1.2); the yawn mask now also covers the gaze and head cues. Owner request: the reading now starts at calibration end as `not_bored` instead of waiting ~30 s more for the first load estimate. Third live test: leaning back with the head low read as 88 % High load under `heuristic-0` and the busy veto overruled four yawns; the busy veto now applies only when `meta.model_version` is a trained model.
- [x] Display-only **overload** heuristic (ARCHITECTURE.md §8c), the other end of the inverted U from boredom: points over 30 s against the learner's own robust baseline for fewer blinks, brows drawn together, lips pressed, fixed gaze (+1 each), plus load High (+1, trained model only); `overloaded` ≥ 3, `working_hard` 2, else `manageable`. Looking-away and yawn seconds left out. Overload card on the Signals tab after Boredom: state, points, evidence rows, 5-min timeline.
  - Answers the supervisor panel's "no clear methodology for measuring cognitive overload". Not in `LoadStateEvent` (invariant 5), not a model input. Own baseline with spread floors, so a still calibration cannot turn jitter into a frown (the Mood bug of 2026-10-18). 13 unit tests in `tests/unit/heuristics/overload.test.ts`. Thresholds hand-picked (tune), unvalidated. 🧑 Get the definition agreed with the supervisor; validate against NASA-TLX in the pilot.
- [x] `cameraPolicy: 'optional' | 'required'` option; default `'optional'`. `'required'` only after the A0 approval item is ticked.
  - `'required'` throws `CameraPolicyNotApprovedError` while `REQUIRED_CAMERA_POLICY_APPROVED` is `false`; flip it after the A0 approval and the CLAUDE.md invariant 4 update. Its runtime meaning (`studyGate`) is implemented and documented.
- [x] **Single integration file** `packages/load-sensor/src/signals.ts`: the one module teammates import. Exports the event types, `subscribe(callback)`, one helper per signal (`onLoadChange`, `onPresenceChange`, `onFatigueChange`, `onAffectChange`, `onStrainChange`), `getLatestSignal()`, and the `BroadcastChannel` name for other tabs/iframes. Documented field by field in `INTEGRATION.md`. HTTP endpoints in `backend/services/load-service/` only if a teammate's component runs on a server (A0 question).
  - Package exports `@adaptlearn/load-sensor/signals` (receive-only: no camera, TF.js or network) and `@adaptlearn/load-sensor` (`createLoadSensor`). Opens its channel on first use, replays the latest event to late subscribers, and the helpers call back with `null` when the signal goes stale. **Not done:** `backend/services/load-service/` endpoints, waiting for the A0 answer on where components run.
- [x] EMA smoothing + hysteresis, unit-tested for no flapping on noisy input
  - `classifier/smoothing.ts`: α 0.3, switch after 2 consecutive leads (both **(tune)**). Test: 600 noisy inferences around Medium with > 100 raw arg-max changes give 0 published changes; a real step to High is followed within 2–5 s. `confidence` is the smoothed probability of the _published_ level (equal to §7's max probability except while hysteresis holds), so a consumer is never told "High, 0.6" when 0.6 is Medium's.
- [x] `INTEGRATION.md` for teammates: install, 10-line example, field meanings, what `null` means
  - `packages/load-sensor/INTEGRATION.md`, linked from the package README and §8.
- [x] Tiny mock consumer page that subscribes and prints events (give this to teammates)
  - `consumer.html` (`src/consumer/`), importing only `signals.ts`. The demo's Camera tab gains an **Event stream** card (live event, raw JSON, "Open mock consumer"); the cog-admin load card shows the live state instead of "Model pending". The demo composes the core parts itself (overlay and charts need landmarks) but publishes through the same `LoadStateHub` and `sourceForCamera` mapping as `createLoadSensor()`. e2e `tests/e2e/event-stream.spec.ts`: two tabs, fake camera → consumer sees disabled → … → `no_face`/`absent`, heartbeats arrive, `disabled` on off, zero cross-origin requests.
  - **e2e now runs with `workers: 1`.** With 8 parallel workers, Chromium intermittently reported pages as `hidden`, so the camera paused by design and timers throttled. Pause/resume, cog-admin and heartbeat checks then failed at random; the cog-admin flake already happened on the pre-A5 suite. Serial: 27/27 over 3 repeats, about 1 min per run. The long camera walk-through also gets a 90 s budget (it took ~25 s of the 30 s default even alone).
  - **Not yet verified by hand:** the fake camera has no face, so `active` with a real `load_state` has only been reached in unit tests (synthetic face). Check once with a real webcam: about 60 s after opting in (30 s baseline + 30 s window), the demo card and `consumer.html` should show a load level and `heuristic-0`.

### A6. Consent and control UI [survey findings: 45.8 % not comfortable, 54.2 % want a toggle]

- [x] Plain-language consent screen: what is processed, that nothing is uploaded or recorded, how to turn it off
  - `src/demo/consent.ts`: native modal `<dialog>` (browser focus trap, Esc, inert page). Esc, close, backdrop and "Not now" all decline; focus starts on the title so a stray Enter cannot consent. Every way to turn sensing on (button, sidebar switch, neck-stretch game) goes through `requestSensing()` in `main.ts`, so `getUserMedia` is never called before agreement (e2e counts the calls).
  - The notice shows before **every** camera start (owner's choice, 2026-10-14; first version remembered consent and skipped it). Pause/resume does not ask again. The latest agreement is kept as `{ version, at }` under `adaptlearn.c2.consent` for the "Agreed on …" line; bump `CONSENT_VERSION` when the notice changes meaning. "Privacy & consent" re-opens it with a **Withdraw** button (record deleted, camera off at once).
  - For the ethics application: the notice wording lives in `consent.ts`; check it says what the approved information sheet says.
- [x] Sensing off by default; visible on/off toggle; visible "camera active" indicator
  - If `cameraPolicy: 'required'` is approved (A0), this becomes a "turn on the camera to start studying" gate instead of an off-by-default toggle; the indicator and the off switch stay.
  - `src/demo/sensing-control.ts`: Camera switch (`role="switch"`) + lamp in the sidebar on every tab (header bar on narrow screens); red pulsing lamp and "On · live" while the camera runs. The browser tab title gets a `● Camera on ·` prefix, so it shows even when the page is behind others.
- [x] App remains usable with sensing off
  - e2e `consent.spec.ts`: after declining, Signals, Performance and Break (memory game) all work, the event stream reports `disabled`, and no camera request was made.
- [x] Short calibration prompt ("look at the screen normally" during the baseline)
  - `src/demo/calibration-prompt.ts`: card over the video with a countdown and progress bar during the baseline; "Move into view" (amber) when no face is seen; "Calibration done" for 3.5 s, then it hides. Shows again after a recalibration. View logic is pure and unit-tested.
  - Not yet seen with a real face (the fake camera has none): check once by hand that "Look at the screen…" → "Calibration done" appears.
  - **Baseline shortened 60 s → 30 s (owner, 2026-10-14)** to cut the wait before the first estimate from ~90 s to ~60 s. `FEATURE_CONFIG.baseline.seconds`, `feature_spec.json` regenerated, ARCHITECTURE §5.4 and INTEGRATION.md updated. 🧑 Tell the supervisor (it is a method change), and in the pilot keep the rest block ≥ 30 s. Check with pilot data that 30 s z-scores are stable enough (blink baseline is the weak point: ~8 blinks).

### A7. Privacy, offline and performance evidence [NFR1, NFR2, NFR6]

- [x] Content Security Policy in the served HTML / dev server headers
  - One directive table in `packages/load-sensor/security-headers.config.ts` feeds the dev and preview server headers and a `<meta>` tag that the build prepends to every page, so the policy travels with the static files to any host. Production: `default-src 'none'`, then only `'self'` per resource type; `connect-src 'self'` is the line that stops data leaving. `frame-ancestors 'none'` is header-only (browsers ignore it in `<meta>`).
  - `script-src` needs `'wasm-unsafe-eval'` for the TF.js WASM fallback; that allows WebAssembly compilation only, not JavaScript `eval`. The bundle has no `eval` / `new Function` and the built HTML has no inline script or style. Dev adds only `style-src 'unsafe-inline'` (Vite injects CSS as `<style>` for hot reload).
  - No `blob:` in `worker-src`: the threaded TF.js WASM build spawns blob workers only under cross-origin isolation (COOP/COEP), which the app does not enable. Turning isolation on later means adding `blob:` on purpose.
  - Also sent: `Permissions-Policy: camera=(self), microphone=(), geolocation=()`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. No `report-uri`, because a reporting endpoint would itself be a network dependency (invariant 3).
  - Evidence in `tests/e2e/csp.spec.ts`. Checks: the header and the first `<head>` element on all 4 pages (incl. `bench.html`, added later in A7); a deliberate cross-origin `fetch` POST, `sendBeacon` and WebSocket are each blocked by both the header and the meta copy; an injected inline script and page `eval` are refused; the self-hosted `.wasm` compiles. The sensor, consumer and cog admin pages all run with zero violations, on WebGL and on WASM with WebGL stubbed out. Firefox has not been checked yet (no Playwright Firefox project); its support for `'wasm-unsafe-eval'` starts at Firefox 102.
  - Playwright note: `page.evaluate` runs through DevTools, which Chrome exempts from the eval check, so the eval probe runs from a same-origin script file instead.
- [x] Service worker precaching app shell + models
  - `vite-plugin-pwa` 2.0.0 (dev dependency, build time only; named in the CLAUDE.md stack) generates a Workbox worker. It precaches 4 pages, every chunk, both face mesh models and 2 WASM binaries, about 5.5 MB. Each file gets a content-hash revision, so a changed model is downloaded again and old caches are cleaned up.
  - Not precached: source maps, `MANIFEST.json` and the threaded WASM build, which is only used under cross-origin isolation. `maximumFileSizeToCacheInBytes` is raised to 4 MiB because the 2.3 MiB landmark weights would otherwise be skipped silently. `navigateFallback: null` because this is a multi-page app.
  - Registered by `src/demo/service-worker.ts`, from the sensor page only. `src/core` stays free of caching policy: a host app owns its own service worker. The plugin's `inline` register option is not used because it needs an inline script, which the CSP blocks.
  - The worker is off in `pnpm dev`. The Performance tab shows "Offline cache: Ready" once the precache is done.
- [x] Playwright + fake camera: **zero network requests** during 60 s of sensing; save HAR to `docs/evidence/`
  - `tests/e2e/privacy-network.spec.ts`. The 60 s window starts once the precache is done, sensing is on and frames are flowing. It asserts zero requests in the window, including the service worker's own, and zero requests to other origins in the whole session.
  - `pnpm evidence` writes `docs/evidence/nfr2-sensing-60s.har` (bodies omitted; localhost only, no cookies) and `.summary.json`. A plain `pnpm test:e2e` writes them to `test-results/` instead, so committed evidence is never rewritten by accident.
  - Run 2026-10-16 (Chromium 153, synthetic camera): 0 requests in 60.0 s, 874 frames received, 49 requests in the session, all same-origin.
- [x] Playwright: load online → go offline → reload → reaches `status: "active"`
  - `tests/e2e/offline.spec.ts`. The test:
    - proves the network is really gone;
    - checks the reload and every later request came from the service worker;
    - turns sensing on offline (model loaded from the cache, frames processed, 0 errors);
    - checks the consumer and cog admin pages also load.
  - Status reached: the synthetic fake camera has no face, so it honestly reaches `no_face`. Only a face clip in `ADAPTLEARN_FAKE_VIDEO` (see `tests/e2e/fake-camera.ts`) makes the test require `active`.
  - [ ] 🧑 Record a face clip (outside the repo, instructions in `tests/e2e/fake-camera.ts`) and run `pnpm test:e2e` with `ADAPTLEARN_FAKE_VIDEO` set, so the `active` branch has run at least once. Not yet done.
- [x] `npm run bench`: frame latency p50/p95, event latency p95, classifier time, long tasks; writes JSON with device + browser info
  - `bench.html` runs the shipped library (`createLoadSensor()`) with no demo UI, so the numbers are the sensor's own and any long task on the page belongs to it. `pnpm bench [--browser=chromium,msedge,firefox] [--camera=real] [--seconds=120] [--warmup=30] [--headless]` builds the app, drives that page and writes `docs/bench/<date>_<time>_<cpu>_<browser>_<camera>.json`. The page can also be opened by hand on any laptop and the JSON downloaded.
  - Measurement points (§11), in `src/core/util/latency-probe.ts`, attached through `environment.latencyProbe`. With no probe the sensor behaves exactly the same; a unit test checks the events are identical.
    - Frame latency: frame arrival → per-frame signals ready. Arrival is rVFC `captureTime` if the browser gives it, else `presentationTime`, else the rAF time; the report records which.
    - Event latency: arrival of the newest frame of a finished second → hub done.
    - Inference time and classifier time.
  - The report also has:
    - startup time (camera + model; first processed frame), kept separate from steady state;
    - long tasks (Chromium only);
    - a portable 50 ms event-loop lag monitor;
    - tensors and heap (Chromium) once a second;
    - `within_budget` against §11, where `null` means not measured;
    - `warnings` whenever a run is unrepresentative: no face, classifier never ran, software GPU, page hidden, freeze over 1 s.
  - Headed by default, because headless Chromium uses SwiftShader. Chrome and Edge get a generated test-pattern clip from the OS temp folder, so their input is identical. Edge's built-in fake camera ended its track by itself in 2–3 of 3 launches, even with a bare `getUserMedia()` and no app code; Chromium did this in 0 of 10, and the file-backed device in 0 of 4. A fake-camera run that hits `no_camera` is retried up to 3 times. Real-camera runs are never retried.
  - Warm-up starts after the first processed frame and lasts 30 s by default. See the Firefox note below.
- [x] Tensor-leak test: `tf.memory().numTensors` flat across a simulated long run
  - `tests/e2e/long-run.spec.ts`. Runs the real sensor on `bench.html` for 120 s (`LONG_RUN_SECONDS=3600` gives the NFR6 soak) and requires every reading to be identical.
  - Readings are taken between two inferences, through `LatencyProbe.onFrame`. Reading on a 1 s timer had caught in-flight temporaries (1157 vs 1166) and gave a false +1.
  - Checked by mutation: without `pixels.dispose()` in the provider the test fails, with growth +128.5 in 30 s.
- [ ] Run bench on the weak laptop in Chrome, Edge, Firefox; commit outputs
  - Tool ready. Dev-laptop runs (i5-1240P, Iris Xe, synthetic camera, so no face) are in `docs/bench/`; their own `warnings` say why they are not the NFR1 result.
  - 🧑 Still needed: on the weakest laptop, run `pnpm bench --camera=real --browser=chromium,msedge,firefox` with your face in view, then commit the JSON.
- [ ] Investigate: Firefox froze the main thread once, for about 7 s, about 25 s after sensing started (2026-10-16, i5-1240P, synthetic camera). It showed up in both runs where it fell inside the measured period (warm-up 5 s and 10 s). It did not repeat later in the 90 s run, and with a 40 s warm-up it fell outside the measured period. It looks like late shader compilation, but that is not confirmed. Learners on Firefox would see the page freeze once per session. Not seen in Chrome or Edge.
- [ ] 🧑 Run the **Camera quality check** (Performance tab) with a real face on the weak laptop; save the JSON to `packages/load-sensor/docs/bench/`. Results: TBD
  - Added ahead of the bench to decide two method questions with numbers instead of guesses: is a higher capture resolution than 640×480 worth its latency, and is landmark smoothing before features needed? It steps the live track through 640×480, 960×720 and 1280×720 (`applyConstraints`, 2.5 s settle + 10 s measure each) and reports delivered resolution, landmark fps, inference p50/p95, face ratio, landmark jitter (frame-to-frame, translation removed, IOD units) and robust per-frame noise of EAR, iris offset, yaw and pitch (`src/demo/quality-check.ts`). Summary numbers only; a local download, nothing sent. The metric is unit-tested against synthetic faces with known injected noise (jitter ≈ 2σ/IOD). Headless fake-camera runs have no face and are not evidence. Do not change `DEFAULT_VIDEO_CONSTRAINTS` or add smoothing until these numbers exist (feature_spec + parity re-run if either changes).

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
- [ ] Three programming task blocks (Easy / Medium / Hard) plus an Underload block (repetitive, very easy; for boredom, §8b), ≥ 5 min each, order from a counterbalancing table
- [ ] NASA-TLX form after each block (six subscales, 0–100); store raw subscale scores; plus a boredom self-report item (§8b)
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

## Milestone P — Trained expression, mood and head-pose models (PP1 panel feedback)

**Why.** At PP1 the panel objected that mood, boredom, facial expression and head pose come from a "predefined model": hand-picked rules and thresholds in `src/core/heuristics/estimators.ts` and the geometric solver in `src/core/features/head-pose.ts`. This milestone replaces them with models trained on public datasets and reports measured accuracy. The landmark-only design stays: every model here takes landmarks or features, never pixels, so nothing changes for privacy (invariant 1). The hand-picked rules are kept as the ablation baseline, not deleted.

Does not depend on Milestone B, so it can run while the study is being prepared.

**Datasets** are in `C:\datasets\`, outside the repo and outside OneDrive, because their licences forbid redistribution (invariant 7). Unpack log: `C:\datasets\unpack.log`.

| Folder | Use | State |
|---|---|---|
| `300w-lp/` | Head pose: train | 310k files, unpacked |
| `aflw2000-3d/` | Head pose: test | 2,000 images + `.mat` pose |
| `raf-db/` | Expression: main test set (official split, train 12,271 / test 3,068) | unpacked 30 Oct |
| `expw/` | Expression: extra training data (whole photos, crop by face box) | 91,793 labels |
| `fer2013/` | Expression: FER+ labels (`fer2013new.csv`) on the 48×48 FER2013 faces | unpacked |
| `daisee/` | Boredom/engagement clips (P8 only) | complete: 9,068 clips (Train 5,482 / Validation 1,720 / Test 1,866, .avi and .mp4), 8,925 labelled. One clip failed the unpack CRC check (`Train/210055/2100552061/2100552061.avi`): drop it and say so. (An earlier count of 8,232 looked at .avi only.) |

### P0. Plan and environment

- [x] Add this milestone to TODO.md
- [x] Python 3.11 venv + `research/c2-load/training/requirements.txt` with pinned versions (also covers C1's first item). Setup steps: `research/c2-load/training/README.md`.
  - **Windows Python is blocked:** Smart App Control is on (`VerifiedAndReputablePolicyState = 1`) and refuses to load the DLLs of TensorFlow, MediaPipe, pandas and `sklearn.ensemble` ("An Application Control policy has blocked this file", Code Integrity event 3077). Turning it off cannot be undone without reinstalling Windows. Decided 30 Oct: train in **WSL2 Ubuntu 24.04**, venv at `~/venvs/c2-training` (outside OneDrive).
  - TensorFlow is 2.19.0, not the newest 2.21.0: `tensorflowjs` 4.22.0 needs `tensorflow-decision-forests`, whose newest release pins `tensorflow==2.19.0`. That in turn forces numpy 2.1.3 and protobuf 5, and `ydf` must be held at 0.15.0 (0.16 needs protobuf 6 and breaks `import tensorflowjs`). Each pin is explained in `requirements.txt`; the full set is in `requirements.lock.txt`.
  - Checked: all libraries import, and a tiny `tf_keras` Conv1D + GRU model exports to TF.js (`model.json` + one weights shard). TF.js-side load and parity are still C1's round-trip item. CPU only.

### P1. Landmark extraction (offline, never shipped)

- [x] Extract landmarks for every dataset to `C:\datasets\landmarks\<dataset>.npy` + `.csv` + `.summary.json`. No images are copied or saved. **Running since 30 Oct** (log: `C:\datasets\landmarks\extract.log`).
  - Done 30 Oct 13:11 to 21:34, all five exit 0, 267,469 images, compute about 8 h 20 min.
  - Decided 30 Oct (owner): use the app's own model (adapter A), not MediaPipe FaceLandmarker in Python, so the reported accuracy is measured on the same landmarks the app produces. (MediaPipe 1.2.0 also no longer has the legacy `mp.solutions.face_mesh`.)
  - `pnpm extract-landmarks <dataset>` (`scripts/extract-landmarks.ts` + `-lib.ts`, unit-tested). Same model files and `createDetector` settings as `TfjsFaceMeshProvider`, models read from disk, `staticImageMode: true` (images are independent). Worker processes (default 12), resumable: rerun the same command after a stop.
  - Runs on the TF.js **cpu** backend in Node (about 0.39 s per image per core). WASM cannot run this model: see the A3 item on the WASM fallback. New dev dependencies, never shipped: `jpeg-js` 0.4.4 (pure-JS JPEG decoder) and `@tensorflow/tfjs-backend-cpu` 4.22.0 (already in the tree via the WebGL backend).
  - Input: RAF-DB and ExpW are cropped around the dataset's face box with a 0.25 margin per side, resampled to 256 px. 300W-LP and AFLW2000 (450×450, face centred) are used whole. FER2013 (48×48) is upscaled to 192 px.
  - Crop margin trial (first 240 items, found rate): RAF-DB 97.5 % / 97.9 % / 97.1 % and ExpW 94.2 % / 94.2 % / 94.6 % at margin 0.10 / 0.25 / 0.40. Within one image of each other, so 0.25 stays.
  - The Kaggle `train_test_split_ALL.csv` also puts 1,600 AFLW2000 images in "train". Ignored: AFLW2000 is test-only under the standard protocol. 300W-LP keeps that file's train/val split. Checked 30 Oct: it is subject-disjoint (2,227 train vs 557 val subjects, 0 shared; 3,271 vs 566 source photos, 0 shared; flipped copies stay with their original), so validation measures unseen people.
  - Decided 30 Oct (owner): use the full 300W-LP (122,450 images incl. the flipped copies), the standard protocol, rather than the 61k originals to finish about 2 h sooner.
- [x] Report the face-found rate per dataset (from the summaries). Trial on the first 240 items: RAF-DB 97.9 %, ExpW 94.2 %, FER2013 91.3 %, AFLW2000 88.8 %, 300W-LP 79.6 %. 300W-LP and AFLW include near-profile poses, where FaceMesh also fails in the app. P3 must report pose error only on faces it found, and say how many large-pose faces that drops.
  - Final, 30 Oct: RAF-DB 14,886 / 15,339 (97.0 %), FER2013 32,116 / 35,887 (89.5 %), ExpW 81,277 / 91,793 (88.5 %), AFLW2000 1,760 / 2,000 (88.0 %), 300W-LP 94,458 / 122,450 (77.1 %).
- [ ] Parity: the app runs this model on WebGL, extraction on cpu. Compare landmarks for a handful of dataset images in the browser vs `extract-landmarks`; expect float-rounding differences only.
  - 1 image so far (AFLW2000 `image00002.jpg`, Chromium WebGL vs `aflw2000.npy` row 0): mean |Δ| 5.5e-4, max 3.3e-3 (normalised; 0.25 px mean, 1.5 px max on 450 px). Larger than WASM vs WebGL on the same image (max 4.3e-4), so most of it is probably the JPEG decoder (jpeg-js vs Chrome), not the backend. Not confirmed; needs more images.

### P2. Features from landmarks

- [x] `scripts/landmarks-to-features.ts` (Node): reads the `.npy` landmarks and runs the **TypeScript** feature code, so Python never re-implements a feature (CLAUDE.md "one source of truth"). Same item as C1's last one.
  - `pnpm landmarks-to-features <dataset>` writes `<dataset>.signals.npy` [N, 13] (`computeFrameSignals`, which includes the geometric yaw/pitch/roll baseline), `.mesh_camera.npy` and `.mesh_face.npy` [N, 1434], and `.features.json` (column names, feature `code_hash`). A row gets all three or none, so every model is trained and tested on the same rows. Aspect is 1 (every extractor crop is square).
  - Bug caught while building it (30 Oct): the first `.npy` reader used `Buffer#slice(...).buffer`, which in Node is the whole file including the header, so rows came out shifted by 32 values (AFLW: 200 "found" rows looked like NaN). Fixed (copy into a fresh buffer) with a unit test that reads from a pooled Buffer. The `.npy` files themselves were never wrong.
- [x] Decide the input for each model: raw normalised landmarks, existing features, or both. 🧑 Confirm with supervisor if it changes the method.
  - Owner, 30 Oct: send the supervisor question after the P-milestone work is done. If the supervisor wants a different input, only `mesh-input.ts`, the feature files and training need redoing (about 1–2 h; the landmark extraction is kept).
  - Chosen 30 Oct (owner to confirm with supervisor): all 478 points, centred between the eyes and divided by the inter-ocular distance (`src/core/features/mesh-input.ts`, unit-tested with synthetic faces). Head pose uses the `camera` frame (rotation kept, it is the target). Expression uses the `face` frame (rotated into `faceAxes`, so the same expression reads the same at any head turn). The same function will run in the browser, so there is no train/serve skew. `feature_spec.json` regenerated (`code_hash` changed because `src/core/features` changed; the per-second feature list itself did not change).

### P3. Head-pose model [FR2]

- [x] Train on 300W-LP, test on AFLW2000-3D (the standard protocol, so the numbers compare with published papers)
  - Script ready: `research/c2-load/training/head_pose.py` (geometric vs ridge vs MLP on the same test rows; ±99° filter; sign convention taken from 300W-LP train, never from the test set). `--dry-run` passes on AFLW halves (code check only). Waits for the 300W-LP extraction.
  - Test-set hygiene, for the method section: the first version of both dry runs printed metrics on test data (head pose: 5 epochs on AFLW halves; expression: a 3-epoch model scored once on RAF-DB test). Nothing was chosen from those numbers. Both dry runs now never print test metrics; the real runs touch each test set once.
- [x] Report mean absolute error in degrees for yaw, pitch and roll, against the current geometric solver on the same test images
  - Run 30 Oct (`head_pose.py`, `results/head_pose.json`, 20 min): 300W-LP train 80,713 / val 13,743 faces (94,458 of 122,450 images had a face found by the app's FaceMesh); AFLW2000-3D test 1,750 of 2,000 (240 no face, 10 outside ±99°). MAE yaw / pitch / roll / mean: **geometric 6.05° / 6.08° / 6.09° / 6.08°**, ridge 6.43° / 5.83° / 4.25° / 5.50°, **MLP 5.78° / 5.64° / 3.95° / 5.12°**. The MLP is lowest in every |yaw| band too (0–30°: 3.39 vs 3.80; 30–60°: 6.76 vs 8.71; 60–99°: 15.72 vs 18.97). Exported to `public/models/head-pose/` (local only, gitignored); parity max |TF.js − Keras| = 7.63e-6, PASS.
- [x] Decide: replace the geometric solver only if the trained model is measurably better. Record the numbers either way.
  - Decided 30 Oct (owner): **report only, keep the geometric solver.** The MLP is better (5.12° vs 6.08° mean MAE), but the weights stay local (licence), and putting a local-only model inside the feature pipeline would make load features differ between machines. The comparison is reported as evidence that the geometric solver was checked against a trained model. Head pose is therefore not wired into the demo (P5).

### P4. Expression model [FR3]

- [x] Train on RAF-DB train (+ ExpW, + FER+ if P1 kept it); test on the RAF-DB official test split
  - First run, 30 Oct (`expression.py`, `results/expression.json`): validation macro-F1 by mix RAF 0.390 / RAF+ExpW 0.320 / RAF+ExpW+FER+ 0.223, so RAF alone was chosen (the other sets hurt, probably because their photos look different). **RAF-DB test** (2,983 of 3,068 faces found): accuracy **0.542**, macro-F1 **0.398**; per class F1 happy 0.76, surprise 0.60, neutral 0.59, anger 0.34, fear 0.24, disgust 0.18, sad 0.08. Mood (3 classes) accuracy 0.651, macro-F1 0.634. FER+ PrivateTest: accuracy 0.539, macro-F1 0.360, mood accuracy 0.642. Found faces: RAF-DB 97.0 %, ExpW 88.5 %, FER2013 89.5 %.
  - The model underfitted (training accuracy 0.46, no higher than validation). Owner decision: tune on validation only, then test once more and report both test numbers (`expression_tune.py`, `results/expression_tuned.json`).
  - Second pass, 30 Oct (`expression_tune.py`): 12-setting grid on RAF-DB train (hidden 256-128 / 512-256 / 512-256-128 × dropout 0.1 / 0.3 × standardise no / yes), chosen on validation macro-F1 only. Standardising the inputs was the fix: validation macro-F1 0.546–0.578 with it, 0.330–0.512 without. Best: hidden 256-128, dropout 0.3, standardised (validation 0.578); the same setting with + ExpW scored lower (0.525), so RAF alone again. **RAF-DB test** (same 2,983 faces): accuracy **0.654**, macro-F1 **0.570** (first run 0.542 / 0.398); per-class F1 happy 0.79, surprise 0.71, neutral 0.65, anger 0.54, sad 0.51, fear 0.42, disgust 0.38. Mood accuracy 0.719, macro-F1 0.715. FER+ PrivateTest: accuracy 0.530, macro-F1 0.432. **The RAF-DB test set has been used twice**; the report (`report.py`) states this and gives both runs.
- [x] Report accuracy, **macro-F1** (Fear and Disgust are small classes) and the confusion matrix
- [ ] Compare against the current hand-picked expression rules on the same test images
  - Not possible as stated: the rules in `src/demo/mood.ts` score each learner against their own 30 s calibration baseline (z-scores), and single dataset photos have no baseline. Recorded in `expression.py`'s docstring. 🧑 Decide what to say in the report: the comparison can only be made in the pilot study (B), on real sessions.
- [x] Mood = Positive / Neutral / Negative, grouped from the 7 expressions. Report its accuracy too.
  - Decided 30 Oct (owner): Happy → Positive; Neutral and **Surprise** → Neutral (surprise can be good or bad); Sad/Anger/Fear/Disgust → Negative. `expression.py` reports mood accuracy, macro-F1 and confusion from the 7-class predictions.
  - Decided 30 Oct (owner): the trained expression model goes into the **demo mood panel only** (Signals tab), replacing the hand-picked happy/surprised/sad/frustrated rules, with a switch back to the rules for the ablation. Nothing in the event stream changes (no sign-off needed).

### P5. Ship in the browser

- [x] Export both models to TF.js under `public/models/` (same-origin, invariant 3); Python/JS parity within 1e-4
  - Both exported 30 Oct with parity PASS (expression 1.79e-7, head pose 7.63e-6). Head pose not wired (P3 decision).
  - Browser side ready: `MeshModel` (`src/core/classifier/mesh-model.ts`): lazy `loadGraphModel` from a same-origin URL (`resolveSameOriginAsset`), input from the same `meshInput()` as training, output length checked at load, every tensor disposed (unit-tested with doubles). Smoke model checked in Chromium (dev server, temporary copy, since removed): max |browser − Keras| = 2.35e-6 on WebGL and on WASM.
  - Tooling ready: `python export.py head_pose|expression` → `public/models/head-pose/` or `expression/` (graph model + `meta.json` with input, output, classes and test numbers from the results file) and a parity fixture in `research/c2-load/results/parity/` (gitignored: derived from licensed data); then `pnpm model-parity <dir> <fixture>`. Refuses to export a dry-run result.
  - Expression exported 30 Oct (`python export.py expression_tuned` → `public/models/expression/`, 1.6 MB, standardisation built in as the first layer). Parity on 32 RAF-DB test rows: max |TF.js − Keras| = 1.79e-7 (tolerance 1e-4), PASS. Owner decision, 30 Oct: RAF-DB-derived weights stay local only (licence: non-commercial research). `public/models/expression/` and `head-pose/` are gitignored; a clone without them falls back to the hand-picked rules.
- [x] Replace the heuristics behind a switch; the old rules stay selectable for the ablation [FR3]
  - Expression → mood panel wired (30 Oct, waits for the trained model file): `MoodEstimator.setExpressionSource('model' | 'rules')`, demo switch "Trained expression model" (`settings.sensing.expressionModel`, default on). In model mode happy / surprised / frustrated (= anger + disgust) / sad come from the model's probabilities averaged over the same frames and 4 s window, shown at ≥ `MOOD_CONFIG.modelShow` (0.5, **(tune)**); drowsy, confused, focused and distracted keep their rules (not among the 7 classes). If `public/models/expression/` is missing, the panel says "hand-picked rules" and uses them. 5 unit tests. The model is loaded after the face model, on the same backend.
  - Head pose: not wired (owner decision 30 Oct, see P3).
- [ ] Wrap inference in `tf.tidy`; re-run bench (NFR1 ≤ 300 ms) and the privacy e2e test
  - First live check with a real face, 30 Oct (dev server, Chrome, WebGL): the trained expression model runs and the panel says "Live · expressions from the trained model" (Happy detected on a smile). But the face model took p50 271.5 ms / p95 324.0 ms at 3.2 fps, against 24.5 ms at 14.9 fps in the 16 Oct bench on the same laptop. Turning the expression model off did not help (2 fps, p95 559 ms), so it is not the cause. Suspects: battery/power mode or Chrome not using the GPU; also the rate cap was set to 30 (default 15). 🧑 To do: plug in, Best performance, restart Chrome, check `chrome://gpu`, cap back to 15, then `pnpm bench` on the production build. Not evidence for NFR1 either way until re-measured.
- [x] Regenerate `feature_spec.json` if any feature changed
  - Nothing to regenerate: no feature code changed (`feature_spec.json` code hash unchanged).

### P6. Evidence for the report

- [x] One script regenerates every P3/P4 table and figure from the landmark files
  - Done 30 Oct: `report.py` writes `results/report.md` and the confusion figures from the results JSON files.
- [ ] Short write-up: datasets, protocol, numbers, limitations (e.g. posed vs. natural faces, webcam vs. photo)

### P7. Event schema 🧑

- [ ] 🧑 A new `boredom` field (or any new field) needs C01/C03/C04 sign-off before it goes in `LoadStateEvent` (invariant 5)
  - Owner decision 30 Oct: instead of new `LoadStateEvent` fields, a separate **optional extras stream** on `adaptlearn.c02.extras` (`src/core/events/extras.ts`, exported from `signals.ts` as `subscribeExtras`): mood + `mood_source` (model or rules), boredom, overload, head angles, blinks, eyes-closed and gaze-centred fractions, once per second. `LoadStateEvent` is unchanged, so no sign-off is needed; teammates who ignore it are unaffected. Primitives only (validator rejects arrays/objects, FR7). Published by the demo page, not yet by `createLoadSensor()`. Shown on the Performance tab ("Extra signals" card). Documented in `INTEGRATION.md` §8a. 9 unit tests; the privacy e2e now also checks the extras flowed during its zero-request 60 s window (passed 30 Oct). 🧑 Tell C01/C03/C04 it exists (one message).
  - Owner, 30 Oct: ask after C02's own part (P1–P8) is finished. Until then boredom stays display-only (demo panel), not in the event stream.

### P8. Boredom, engagement, confusion, frustration from DAiSEE (plan, 30 Oct)

**Deferred (owner decision, 30 Oct):** not needed for any FR/NFR, and the landmark extraction alone is estimated at about 14–42 h of compute (not measured; P8.1 not run). Boredom and engagement stay the hand-picked rules in `src/core/heuristics/`, described in the report as unvalidated heuristics, with a DAiSEE-trained model as future work and a check against self-reports in the pilot study (B). The extractor (P8.2) and the feature and training code (P8.3, P8.4) are kept, ready if this is picked up again.

**Why.** The PP1 panel's point applies here too: `boredom` (`src/core/heuristics/boredom.ts`), `engagement` and the `affect` states come from hand-picked rules. DAiSEE has people's ratings of exactly these states for webcam video of students in e-learning, which is the app's setting.

**Facts (checked 30 Oct, `C:\datasets\daisee\DAiSEE`):**

- 9,068 clips (8,232 `.avi`, 836 `.mp4`), 640×480, 30 fps, 10 s (300 frames; a few slightly longer): the same resolution as the app's camera.
- Official splits are subject-disjoint: Train 70 people, Validation 22, Test 21, none shared.
- Labels: 0–3 per state, in `Labels/{Train,Validation,Test}Labels.csv`, 8,571 clips with a label (5,358 / 1,429 / 1,784), every one with a file. Use these split files. `AllLabels.csv` disagrees with them (415 extra ids, 61 missing); not used. 497 clips have no label; not used.
- Labels are very unbalanced. Train: Boredom 0/1/2/3 = 2,433 / 1,696 / 1,073 / 156; Engagement = 34 / 213 / 2,617 / 2,494; Confusion = 3,616 / 1,245 / 431 / 66; Frustration = 4,183 / 941 / 191 / 43. So macro-F1 (not accuracy), and collapsing levels (decision 2).
- `2100552061.avi` failed the unpack CRC check but OpenCV decodes 300/300 frames with one damaged block. Exclude it (1 clip; simplest to defend).
- The current boredom rule cannot be scored on DAiSEE: it needs 60 s and 5 min windows and a 30 s calibration, and the clips are 10 s. As with expression, the comparison with the rules can only be made in the pilot study (B).

**Decisions needed 🧑 (recommendation first):**

1. **Frame rate for extraction.** (a) 15 fps, the app's own rate, so blinks and the per-second features mean the same as in the app; about 1.36 M frames. (b) 5 fps; about 0.45 M frames, but blinks (80–500 ms) are mostly missed, so blink features would differ from the app's. Recommended: (a), _if_ step 3's speed-up works; otherwise (b) and drop blink features for this model.
2. **Label levels.** Recommended: Boredom 0 / 1 / 2–3 → `not_bored` / `possibly_bored` / `bored` (the app's own states); Engagement 0–1 / 2 / 3 → Low / Medium / High; Confusion and Frustration 0 vs ≥ 1 → absent / present (levels 2–3 are too rare to learn).
3. **Speed: run P8 extraction in Ubuntu (WSL) with `@tensorflow/tfjs-node`** (native TensorFlow; Smart App Control does not apply in WSL). Same model files and settings as adapter A, in a separate `research/c2-load/video-extract/` package so nothing changes for the app or teammates. Also video tracking mode (`staticImageMode: false`, as the app runs), which skips the face detector between frames. Both untested here: measure on 20 clips first. Without them, CPU TF.js at about 9 frames/s would need about 14 h at 5 fps and about 42 h at 15 fps.
4. **Model input.** Recommended: run each clip's landmarks through the app's own `FeaturePipeline` (TypeScript), so the model sees the same per-second feature vectors as the cognitive-load model and the app (one source of truth). Open point: the pipeline's z-scores need a 30 s calibration and a clip is 10 s. Options: (i) treat each person's clips in id order as one session and calibrate on the first 30 s; (ii) use raw per-second features with no per-person baseline. Recommended: (ii) first (no assumption about clip order), (i) as a second experiment if clip ids prove consecutive.

**Decided 30 Oct (owner), all as recommended:** 15 fps if the speed-up makes it practical, else 5 fps without blink features; labels grouped as in decision 2; build and measure the WSL `tfjs-node` extractor on 20 clips first; raw per-second features first, per-person session calibration later as an experiment.

**Steps (after the decisions):**

- [ ] P8.1 Measure extraction speed on 20 clips for each option in decision 3; pick; record numbers here.
- [x] P8.2 Video extractor: decode clips, sample at the chosen rate, run adapter A's model, write landmarks + frame timestamps per clip (no pixels saved). Resumable, like `extract-landmarks`.
  - `research/c2-load/video-extract/` (README there), run with `run.sh` in WSL: ffmpeg (`fps` filter) → raw RGB → the app's model files and `createDetector` settings, video mode (`staticImageMode: false`, detector reset per clip) → per-clip `.npy` + `.json`. Only the 8,570 labelled clips (official split files) minus the corrupt one. 4 unit tests (frame splitting, label parsing, clip listing); `tsc` strict passes.
  - Problems met and fixed (30 Oct): tfjs-node 4.22.0 fails on Node 24 (`util.isNullOrUndefined` was removed in Node 23), so the package uses Node 22.23.4 LTS (`~/.local/node22`, checksum-verified). tfjs-node has no `Transform` kernel (`tf.image.transform`); added, mapped onto TensorFlow's `ImageProjectiveTransformV3` (`src/tfjs-node-transform.ts`). Listing 9,068 folders over `/mnt/c` took about 2.5 min per process, so the parent lists once and the workers read `clips.json`.
  - Correctness on the first 2 clips (300 frames at 15 fps): a face in every frame; tensors flat at 1,157; tfjs-node vs TF.js `cpu` max |Δ| = 0.0003 px. Speed not measured yet (the image extraction held the CPU at 100 %): that is P8.1.
- [ ] P8.3 Per-second features per clip via the TypeScript `FeaturePipeline` (decision 4); regenerate `feature_spec.json` only if a feature changes.
  - Code ready (30 Oct): `pnpm daisee-to-features` (`scripts/daisee-to-features.ts` + `daisee-features-lib.ts`, 3 unit tests on synthetic clips: 10 finite per-second vectors, one blink counted once, a face-less second masked, longer clips cut to 10 s). A fresh `FeaturePipeline` per clip, raw features, and one empty frame at 10.0 s to close the last second (a second only closes when the next one starts). Writes `daisee.seconds.npy` [N, 10, F], `daisee.valid.npy`, `daisee.features.json`. No feature code changed, so `feature_spec.json` is unchanged. Not yet run on real clips: needs the extraction.
- [ ] P8.4 Baselines: majority class, and random forest on clip summary statistics. Then a small GRU over the 10 per-second vectors. Train on Train, choose on Validation, test once on Test. Macro-F1, confusion matrices, per state.
  - Code ready, not run (30 Oct): `research/c2-load/training/daisee.py`, labels grouped per decision 2, majority / forest / GRU per state on the same rows, forest-vs-GRU chosen on Validation macro-F1, Test scored once. GRU inputs are standardised with Train mean/std, which go into the results file so the browser can apply the same. `--dry-run` splits the available Train clips by person, never touches Test and writes nothing; to run on the P8.1 speed-test clips.
- [ ] P8.5 Export to TF.js + parity check (as P5). Display-only in the demo panels (owner rule: nothing new in `LoadStateEvent` until C02's part is done and C01/C03/C04 agree).
- [ ] P8.6 Report section via `report.py`, including what DAiSEE cannot show (10 s clips, posed setting, label noise, no comparison with the rules).

**Time (estimates, not measured):** decisions + P8.1 about 2 h; extractor about 3 h; extraction 5–40 h depending on decisions 1 and 3; features + training + export about 3 h.

---

## Milestone C — Model training and evaluation

Can start on your own dry-run data before B3 finishes.

### C1. Training environment

- [x] `training/requirements.txt` with pinned versions; legacy Keras (`TF_USE_LEGACY_KERAS=1`)
  - Done in Milestone P0 (WSL2, TensorFlow 2.19.0); see the notes there.
- [x] Round-trip smoke test **before any real training**: build the tiny model → export → load in TF.js → parity within 1e-4. If this fails, switch to training in TF.js under Node.
  - 30 Oct: `python export.py --smoke` (untrained dense model of the head-pose shape, 1434 → 3) → TF.js graph model → `pnpm model-parity`: 32 rows, max |TF.js − Keras| = 1.07e-6, PASS. Graph format because the app already has `@tensorflow/tfjs-converter` (`loadGraphModel`); no `tfjs-layers` dependency needed. The 1D-CNN + GRU still needs its own round trip when it exists (GRU ops in the graph converter).
- [ ] Loader for session exports → windows `[T, F]` + labels + participant id, reading `feature_spec.json`
- [x] `scripts/landmarks-to-features.ts` (Node) for any public dataset landmarks
  - Done in P2.

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

- ~~Separate emotion-recognition model~~ moved to Milestone P (PP1 panel feedback)
- WebGPU backend
- Per-user online adaptation of the classifier
- Regression output (continuous load) instead of three classes
