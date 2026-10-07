# ARCHITECTURE.md — C02 Cognitive Load Detection

Design reference for the in-browser cognitive load module. Numbers marked **(tune)** are starting points to be adjusted from measurements, not fixed decisions.

## 1. Design goals, in priority order

1. Privacy is provable, not just promised (NFR2, FR7).
2. Works offline after first load, on an ordinary laptop, without stalling the page the student is learning in (NFR1, NFR4, NFR6).
3. The research method is sound: no train/serve skew, no data leakage, honest baselines.
4. Teammates can integrate with ten lines of code (NFR8).

## 2. Pipeline overview

```
┌────────┐   ┌─────────────┐   ┌──────────────┐   ┌───────────────┐   ┌────────────┐   ┌───────────┐
│ Camera │ → │ Landmark    │ → │ Per-frame    │ → │ Per-second    │ → │ Classifier │ → │ Smoothing │ → events
│ 30 fps │   │ provider    │   │ signals      │   │ feature vector│   │ 1D-CNN+GRU │   │ hysteresis│
│        │   │ ~15 fps     │   │ ~15 Hz       │   │ 1 Hz, F≈14    │   │ every 2 s  │   │           │
└────────┘   └─────────────┘   └──────────────┘   └───────────────┘   └────────────┘   └───────────┘
                                                        │ 30 s ring buffer (T=30)
                                                        │ z-scored against per-user baseline
```

Three clocks run at different rates on purpose:

| Stage | Rate | Why |
|---|---|---|
| Landmark inference | 15 fps target **(tune)**, adaptive down to 10 | Blinks last 100–400 ms; 15 fps catches them. 30 fps doubles cost for little gain. |
| Feature vector | 1 Hz | Cognitive load changes over seconds, not frames. Keeps the model tiny. |
| Classification | every 2 s **(tune)** on the last 30 s | Fresh enough for adaptation; cheap. |

## 3. Landmark provider (FR1)

```ts
interface LandmarkProvider {
  readonly name: string;
  init(): Promise<void>;                      // loads self-hosted model assets
  estimate(frame: VideoFrameSource, tMs: number): Promise<FaceResult | null>;
  dispose(): void;
}

interface FaceResult {
  landmarks: Float32Array;        // 478 × 3, normalised image coords
  headPose?: { yaw: number; pitch: number; roll: number };   // if the provider gives it
  blendshapes?: Record<string, number>;                      // if the provider gives it
  score: number | null;           // null if the provider does not expose one (adapter A)
}
```

Two adapters behind this interface:

| | A. `TfjsFaceMeshProvider` (default) | B. `TasksVisionProvider` (alternative) |
|---|---|---|
| Package | `@tensorflow-models/face-landmarks-detection`, `runtime: 'tfjs'` | `@mediapipe/tasks-vision` FaceLandmarker |
| Matches proposal wording "MediaPipe FaceMesh via TensorFlow.js" | Yes, exactly | Same underlying model family, but runs on MediaPipe's WASM runtime, not TF.js |
| Output | 478 keypoints (with iris refinement) | 478 landmarks + 52 blendshapes + facial transformation matrix |
| Head pose | We compute it from landmarks | Comes free from the transformation matrix |
| Expression signal (FR3) | We compute proxies from landmarks | Blendshapes (brow, blink, mouth) come free |
| Maintenance | Release cadence has slowed | Actively documented by Google |
| Self-hosting | Local `detectorModelUrl` / `landmarkModelUrl` (confirmed in the 1.0.6 types), files from `pnpm fetch-models`; the MediaPipe-runtime packages are aliased to a throwing stub in `vite.config.ts` | `FilesetResolver.forVisionTasks('/wasm')` + local `.task` file |

**Decision rule:** build A first because it is what the approved proposal says. Build B as a thin adapter in week 2 and benchmark both on the same laptop (frame time p50/p95, landmark jitter, Firefox behaviour). If B is clearly better, the switch is a supervisor conversation, not a silent code change — the classifier still runs in TF.js either way. Record the benchmark in `docs/bench/`.

**Backend selection (adapter A):** try `webgl`, then `wasm`. If neither initialises, set `status: "unsupported"` and stop — do not run on the plain `cpu` backend, it will not reach a usable frame rate and it fails silently. Log the chosen backend in the debug overlay.

## 4. Camera and scheduling

- Request `{ width: 640, height: 480, frameRate: 30, facingMode: 'user' }`. Higher resolution does not help; the model resizes internally.
- Drive the loop from `video.requestVideoFrameCallback` where available (gives a real frame timestamp), falling back to `requestAnimationFrame`.
- Skip a frame if the previous inference has not returned. Never queue frames.
- **Adaptive rate:** keep a rolling p95 of frame time; if it exceeds the budget for 5 s, step the target rate down (15 → 12 → 10). Report the effective rate in the event `meta`.
- **Tab hidden:** on `visibilitychange` → pause inference, emit `status: "paused"`. Browsers throttle hidden tabs anyway; make it explicit.
- **Start on the main thread.** Move landmark inference to a Web Worker (with `OffscreenCanvas` / `ImageBitmap` transfer) only if the benchmark shows main-thread long tasks > 50 ms that affect the host page. This is a measured optimisation, not a default.
- Stop all tracks (`track.stop()`) when sensing is disabled so the camera LED goes off. Users check that light.

## 5. Features (FR2, FR3)

### 5.1 Per-frame signals (~15 Hz)

All distances are divided by inter-ocular distance so they are scale-invariant.

| Signal | How | Notes |
|---|---|---|
| `earL`, `earR` | Eye aspect ratio from six eyelid landmarks per eye, 3D distances | Subject's right eye `33,160,158,133,153,144`, left `362,385,387,263,373,380` (MediaPipe names sides from the subject's view; checked against the library's region sets in a unit test). 3D rather than the original 2D so a lowered head does not look like closing eyes. |
| `irisDx`, `irisDy` | Iris centre offset from eye-corner midpoint, normalised by eye width | Iris landmarks are 468–477. This is a gaze *proxy*, not calibrated gaze. |
| `yaw`, `pitch`, `roll` | Head pose from landmark geometry (or provider matrix) | Degrees. |
| `browRaise` | Brow (105/334) to upper lid (159/386), mean of both sides | |
| `browInnerGap` | Inner-brow separation (107–336) | Furrowing shows as a *decrease*. |
| `mouthOpen`, `lipThickness` | Inner-lip gap (13–14); outer-to-inner lip thickness (0–13 + 14–17) | Expression proxies (FR3). Lip pressing shows as a *decrease* in thickness. |
| `facePresent`, `score` | From provider | Drives FR8. |

### 5.2 Blink detection

State machine on smoothed EAR: `open → closing → closed → opening`. A blink is a closure lasting 80–500 ms **(tune)**; longer is an eye closure, shorter is noise. Threshold is **relative to the user's own open-eye EAR** from baseline (e.g. 75 % of median), not a global constant — eye shape and glasses vary too much for a fixed number. Time is measured from frame timestamps, so it holds at any frame rate.

### 5.3 Per-second feature vector (1 Hz)

Proposed `F = 14` **(tune)**:

| # | Feature | Group |
|---|---|---|
| 0 | blink count in this second | Blink |
| 1 | mean blink duration (carried forward if none) | Blink |
| 2 | mean EAR | Blink |
| 3 | fraction of frames with eyes closed | Blink |
| 4 | gaze dispersion x (std of `irisDx`) | Gaze |
| 5 | gaze dispersion y | Gaze |
| 6 | fraction of frames with gaze roughly centred | Gaze |
| 7 | head yaw std | Head |
| 8 | head pitch std | Head |
| 9 | head angular speed (mean abs frame-to-frame change) | Head |
| 10 | brow raise mean | Brow |
| 11 | brow inner gap mean (furrow = decrease) | Brow |
| 12 | mouth-open mean | Expression (FR3, ablatable) |
| 13 | lip thickness mean (press = decrease) | Expression (FR3, ablatable) |

Plus a `validRatio` (fraction of frames with a face) kept alongside as a mask, not as a model input.

`useExpressionFeatures: boolean` zeroes or drops features 12–13. That flag is the ablation study in proposal §3.3.

Do **not** add a separate emotion-classification CNN unless the ablation shows expression proxies help. It costs frame time and adds a second pretrained model to justify.

### 5.4 Baseline normalisation

Individual differences (resting blink rate, brow position, glasses) are larger than the load effect. So:

- First 60 s of a session **(tune)** is a calibration period. Status is `"calibrating"`, `load_state` is `null`.
- Compute per-user mean and std of each feature over calibration; z-score every feature vector after that.
- The same procedure is applied to pilot-study recordings (using each participant's rest block), so training and inference see identically normalised inputs.

### 5.5 Face loss (FR8)

| Situation | Behaviour |
|---|---|
| Face missing < 2 s | Features use only frames with a face (holding the last values was dropped: repeated values would shrink the dispersion and speed features); the second is still valid if `validRatio ≥ 0.5`. Presence stays unchanged. |
| Second has `validRatio < 0.5` | Mark second invalid |
| Window has > 30 % invalid seconds **(tune)** | Don't classify. Emit `status: "no_face"`, `load_state: null` |
| Face returns | Resume immediately; window refills naturally. No recalibration unless absent > 5 min |

## 6. One feature implementation, used everywhere

Train/serve skew is the most likely way this project quietly fails: the model is trained on features computed one way and served features computed slightly differently.

Rule: **features are only ever computed by the TypeScript code in `src/core/features`.**

- **Pilot study data** is recorded by the browser app itself, so it is already produced by this code.
- **Public video datasets** (if used): extract landmarks offline in Python, dump them as arrays, then run a Node script (`scripts/landmarks-to-features.ts`) that imports the same feature functions. Python never re-implements EAR, blink or gaze.
- `feature_spec.json` is emitted by the TS code: feature names, order, window length, normalisation rule, code version hash. Training reads it and writes it next to the exported model. At load time the browser refuses a model whose spec hash does not match the running feature code.
- A parity test feeds one fixed window through the Keras model and the exported TF.js model and asserts outputs match within 1e-4.

## 7. Classifier (FR4, FR5)

Input `[T=30, F=14]` → `Conv1D(16, k=3, relu)` → `Conv1D(16, k=3, relu)` → `GRU(16)` → `Dropout(0.3)` → `Dense(3, softmax)`.

That is a few thousand parameters, on purpose. Realistic training data is 8 participants × a few task blocks, giving on the order of a thousand heavily overlapping windows. A larger network will memorise participants. Expect the Random Forest baseline to be competitive; if it wins, report that.

- `confidence` = max softmax probability after smoothing. Check calibration (reliability plot) before describing it as a probability in the report.
- **Export:** legacy Keras 2 (`tf_keras`) → `tensorflowjs_converter` → `tfjs_layers_model`. Fixed input length; set `unroll=True` on the GRU if the converted model has trouble with loop ops. Fallback if conversion fights back: define and train the same tiny model directly in TF.js under Node — no conversion step at all.
- **Smoothing:** exponential moving average on class probabilities (α ≈ 0.3 **(tune)**), then hysteresis — the published state changes only when a different class has led for 2 consecutive inferences **(tune)**. This stops the tutor and curriculum engine from flapping.

### Frustration and engagement fields

The interface contract includes `frustration` and `engagement`, but the study design only labels load. Version 1 treats them as **documented heuristics**, not model outputs:

- `engagement` (Low/Medium/High): from gaze-centred fraction, face-present ratio and head orientation toward the screen over the window.
- `frustration` (boolean): High load sustained + elevated brow-furrow / lip-press relative to baseline.

NASA-TLX has a Frustration subscale, so the pilot data can check whether the frustration heuristic tracks it. There is no ground truth for engagement unless a self-report item is added to the post-task form. State this limitation plainly in the report.

## 8. Event contract (FR6, NFR8)

The five fields from proposal Appendix D are fixed:

```json
{
  "load_state": "High",
  "confidence": 0.84,
  "frustration": true,
  "engagement": "Low",
  "timestamp": "2026-10-15T14:30:00Z"
}
```

Proposed **additive** fields (need agreement from C01/C03/C04 owners before relying on them):

```ts
interface LoadStateEvent {
  load_state: 'Low' | 'Medium' | 'High' | null;   // null = no reliable estimate right now
  confidence: number | null;                      // 0..1
  frustration: boolean | null;
  engagement: 'Low' | 'Medium' | 'High' | null;
  timestamp: string;                              // ISO 8601 UTC with 'Z'
  // additive:
  schema_version: 1;
  status: 'disabled' | 'permission_denied' | 'unsupported' | 'calibrating'
        | 'active' | 'no_face' | 'paused';
  meta?: { fps: number; backend: string; model_version: string };
}
```

Points to settle with teammates:

- The proposal's example timestamp has no timezone. Use UTC with `Z` so server-side consumers don't guess.
- Consumers **must** handle `load_state: null`. In the requirements survey, 45.8 % of students said they were not comfortable with webcam sensing even when processed in-browser, so "sensing off" will be a common state, not an edge case. Each component needs a sensible default behaviour without the signal.
- Emit on state change **and** as a heartbeat every 5 s **(tune)**, so consumers can tell "unchanged" from "dead".

### Delivery

```ts
const sensor = await createLoadSensor({ modelBaseUrl: '/models' });
sensor.on('state', (e: LoadStateEvent) => { /* ... */ });
await sensor.enable();     // prompts for camera; call only after the user opts in
sensor.pause(); sensor.resume(); sensor.disable();
sensor.getState();         // last event, synchronously
```

- In-page: typed emitter (above).
- Cross-tab / iframe: `BroadcastChannel('adaptlearn.load-state')`.
- To a backend: **not done by the core.** If a teammate's server needs the signal, their integration code forwards the JSON event. Only the event object crosses the network — it contains no image or landmark data. Keep that boundary visible so the privacy claim stays easy to audit.

### 8a. Wellbeing signals (proposed, additive)

Requested by the C2 owner on 2026-10-07 so that C01/C03/C04 can adapt when a learner is away, drowsy, upset or worn out after a long day. All are **documented heuristics**, not model outputs, and need agreement from the consumers before anyone relies on them (invariant 5). Every one is `null` when sensing is off or unreliable.

```ts
// additive, proposed:
presence: 'present' | 'away' | 'absent' | null;
fatigue: 'Low' | 'Medium' | 'High' | null;
affect: 'neutral' | 'frustrated' | 'confused' | null;
strain: 'Low' | 'Medium' | 'High' | null;
suggest_break: boolean | null;
```

| Field | Built from | Notes |
|---|---|---|
| `presence` | face present; head pose / gaze off-screen for > N s **(tune)**; no face > 2 s | `absent` matches `status: "no_face"`. |
| `fatigue` | PERCLOS over 60 s (eyes ≥ 80 % closed), long blinks > 500 ms, blink-rate trend, yawns, head nods | Standard drowsiness indicators from driver-monitoring work; thresholds relative to the learner's own baseline. A webcam cannot prove sleep: say "drowsy", never "asleep". |
| `affect` | brow furrow, brow raise, lip press, mouth open vs baseline | Coarse and weak; part of the FR3 ablation (`useExpressionFeatures`). A real emotion model stays in the parking lot. |
| `strain` | time on task today, time at High load, fatigue trend, minutes since last break | Covers "many assignments and exams in one day". Day totals are derived numbers kept on the device only, never frames or landmarks. C01/C04 know the exam/assignment schedule and may combine it with this. |
| `suggest_break` | `strain` High, or `fatigue` High for > N min **(tune)** | Advice for the consumer, not an action C02 takes. |

Evaluation: the pilot NASA-TLX (B1) has Effort and Frustration subscales; add one self-report "how tired are you?" item after each block so `fatigue` can be checked against something. Without it, report these fields as unvalidated.

### Single integration file

Teammates import one module, `packages/load-sensor/src/signals.ts`, which re-exports the event type, `subscribe`, per-signal helpers (`onLoadChange`, `onPresenceChange`, `onFatigueChange`, `onAffectChange`, `onStrainChange`), `getLatestSignal()` and the `BroadcastChannel` name. `INTEGRATION.md` documents every field. Server-side consumers, if any, get the same JSON from `backend/services/load-service/`; only the event crosses the network.

### Camera policy

The owner wants studying to require the camera. That conflicts with invariant 4 and needs supervisor and ethics approval first (TODO A0). Until then `createLoadSensor({ cameraPolicy })` defaults to `'optional'`; `'required'` is implemented but not enabled.

## 9. Privacy architecture (FR7, NFR2)

Defence in depth, each layer independently checkable:

1. **Code structure.** Frames exist only inside `camera/` and `landmarks/`. Everything downstream receives numbers. `events/` and `recorder/` cannot import from `camera/` (enforced by an ESLint import rule).
2. **No network code in core.** ESLint bans `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `RTCPeerConnection`, `MediaRecorder` in `src/core`, except the model loader, which may only fetch same-origin paths.
3. **Content Security Policy.** `default-src 'self'; connect-src 'self'; img-src 'self' blob:; worker-src 'self' blob:` plus whatever script/wasm directives the chosen runtime needs. Even a bug cannot post frames to another origin. If teammates' API is on another origin, add exactly that origin.
4. **Automated proof.** Playwright test: launch with a fake camera, load the app, enable sensing, run 60 s, and assert zero network requests after initial asset load. Run it again with the context set offline. Save the HAR file to `docs/evidence/` — this is the "network inspection" evidence NFR2 asks for.
5. **Visible to the user.** Camera-active indicator in the UI; disable stops the tracks so the hardware LED turns off.

### Study mode storage

For the pilot study, the recorder writes to IndexedDB and exports a file per session:

- per-frame derived signals (§5.1 — about a dozen scalars per frame), timestamps, task block markers, NASA-TLX answers, participant code `P0x`
- **never** frames, and not the 478-point landmark mesh

Keeping per-frame signals (rather than only per-second vectors) means features can be recomputed if a definition changes — with only 8 participants there is no second chance to collect. Check this matches the wording of the ethics application ("anonymised feature vectors") before the first session.

Study mode is behind a build flag and absent from the normal build.

## 10. Offline (zero runtime network)

- Model and runtime assets are copied into `public/models/` and `public/wasm/` by an `npm run fetch-models` script that downloads once at setup time, verifies a checksum, and records source URL + version in `public/models/MANIFEST.json`.
- Service worker precaches app shell + all model/WASM files. Model files are large; use cache-first with revisioned filenames.
- Lint rule fails the build on any CDN hostname in `src/`.
- e2e: load once online → go offline → reload → sensing still reaches `status: "active"`.

## 11. Performance budget (NFR1, NFR6)

"Latency" needs a precise definition or the 300 ms target cannot be defended. Two numbers are reported:

| Metric | Definition | Budget |
|---|---|---|
| **Frame latency** | camera frame timestamp → per-frame signals available | p95 ≤ 66 ms (keeps 15 fps) |
| **Event latency (NFR1)** | timestamp of the newest frame in the window → `state` event emitted | p95 ≤ 300 ms |
| Classifier inference | one forward pass | ≤ 20 ms |
| Main-thread long tasks | tasks > 50 ms attributable to the sensor | none in steady state |
| Memory | JS heap + `tf.memory().numTensors` over 60 min | flat (no upward trend) |

The classifier looks at 30 s of history, so a *change* in the learner's state takes several seconds to appear by design. NFR1 is about processing delay, not that. Write this distinction into the report so the number isn't misread.

`npm run bench` runs a fixed fake-camera clip and writes these numbers with device/browser info to `docs/bench/`. Run it on the weakest laptop available, in Chrome, Edge and Firefox.

## 12. Training and evaluation (offline)

### Pilot data

- 8 participants × 3 difficulty levels + a rest block each. That yields 24 NASA-TLX scores in total; windows inherit the label of their block (weak labels).
- **Counterbalance task order** (e.g. Latin square). If everyone does Easy → Medium → Hard, the model can learn fatigue or time-in-session instead of load.
- **Label definition — decide with the supervisor and record it:** (a) designed difficulty as the class, NASA-TLX as a manipulation check; or (b) per-participant TLX terciles. (a) is simpler and gives balanced classes; (b) follows perceived load more closely but 3 scores per person makes terciles trivial.
- Blocks need to be long enough to yield windows: ≥ 5 minutes each **(tune)**.

### Protocol

- Leave-one-subject-out cross-validation (8 folds). All windows from a participant are in exactly one fold.
- Normalisation uses only each participant's own rest block; no statistic is computed across the test participant's task data.
- Hyperparameters are chosen inside the training folds, never on the held-out subject.
- Report accuracy and macro-F1 as mean ± spread across folds, with the confusion matrix, next to chance (33 %) and a majority-class baseline.
- Baselines on the same features: Random Forest and SVM on window-level summary statistics (proposal §3.3), then the ablation with and without expression features.

### Public datasets

Check what each one actually contains before planning around it:

- **mEBAL2** — e-learning webcam sessions with blink/attention annotations; access is by licence agreement. A published method on it (DeepFace-Attention) is a candidate for the "published webcam-based models" comparison.
- **ADABase** — multimodal cognitive load dataset; access by request. Confirm it includes usable frontal video.
- **Kaggle "E-Learning Cognitive Load Dataset"** — inspect the files. If it is tabular rather than video or landmarks, it cannot pre-train this feature pipeline and should be described accordingly.

Request access early; approvals take time. If none arrive in time, the fallback is: train on pilot data only, with LOSO, and say so.

## 13. Browser support (NFR7)

| Concern | Chrome / Edge | Firefox |
|---|---|---|
| `requestVideoFrameCallback` | Yes | Check current support; fall back to rAF |
| WebGL2 for TF.js | Yes | Yes; watch for slower shader compile on first run |
| Service worker + large precache | Yes | Yes; not available in private windows |
| Fake camera for tests | `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=...` | `media.navigator.streams.fake` pref (no custom file) |

Test all three on the same machine and record results in the bench output rather than assuming.

## 14. Open questions for the team / supervisor

1. Are C01/C03/C04 running in the same page, another tab, or on a server? That decides the delivery mechanism.
2. Agree the additive event fields and `null` semantics.
3. Label definition (§12).
4. If the tasks-vision adapter benchmarks better, is switching acceptable given the proposal wording?
5. Does the ethics clearance wording cover storing per-frame derived signals?
