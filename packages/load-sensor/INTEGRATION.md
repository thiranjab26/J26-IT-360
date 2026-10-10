# Integrating the C02 load signal

For the owners of **C01 Adaptive Curriculum Engine**, **C03 AI Tutoring** and **C04 Intelligent Viva**. It covers how to receive the learner's cognitive-load and wellbeing signal from C02, what every field means, and what to do when a field is `null`.

Contract source: [ARCHITECTURE.md §8, §8a](../../docs/c2/ARCHITECTURE.md#8-event-contract-fr6-nfr8). Schema version **1**.

> **Status of the values (October 2026).** `load_state` comes from a placeholder rule (`meta.model_version: "heuristic-0"`) until the trained 1D-CNN + GRU replaces it. `engagement`, `frustration` and all wellbeing fields are documented heuristics that have not been validated. Build your integration against the contract now, but don't tune your component's behaviour to today's values.

## 1. Install

In your package's `package.json` (pnpm workspace):

```json
"dependencies": { "@adaptlearn/load-sensor": "workspace:*" }
```

There are two entry points:

| Import                            | Who uses it                                  | Contains                                           |
| --------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `@adaptlearn/load-sensor/signals` | **You** (C01, C03, C04): receive the signal  | Types, listeners. No camera, no model, no network. |
| `@adaptlearn/load-sensor`         | The one page that owns the webcam (C02's UI) | `createLoadSensor()`                               |

## 2. Ten-line example

```ts
import { onLoadChange, onPresenceChange, getLatestSignal } from '@adaptlearn/load-sensor/signals';

onLoadChange((level) => {
  // level: 'Low' | 'Medium' | 'High' | null. null = no estimate: use your default.
  tutor.setPace(level === 'High' ? 'slower' : level === 'Low' ? 'faster' : 'normal');
});
onPresenceChange((presence) => {
  if (presence === 'absent') tutor.holdNextHint(); // the learner left the screen
});
const now = getLatestSignal(); // one-off read; null if no sensor is running
```

Every listener returns an `unsubscribe()` function.

## 3. How delivery works

```
 C02 sensor page                          any same-origin tab / iframe / same page
 ┌───────────────────────┐   BroadcastChannel   ┌──────────────────────────────┐
 │ webcam → landmarks →  │  'adaptlearn.load-   │ signals.ts → your callbacks   │
 │ features → classifier │ ───── state' ──────► │ (validated LoadStateEvent)    │
 └───────────────────────┘    JSON event only   └──────────────────────────────┘
```

- Events cross a same-origin [BroadcastChannel](https://developer.mozilla.org/docs/Web/API/BroadcastChannel). The browser never sends these messages over the network. Your code gets the event wherever it runs on the same origin.
- **Timing.** An event is sent as soon as something you would act on changes. If nothing changes, the latest state is re-sent every **5 s** (heartbeat). A listener that opens late gets the latest event straight away, without waiting for the next heartbeat.
- **Dead sensor.** No event for **12 s** (`STALE_AFTER_MS`) means no sensor is running (tab closed or crashed). `getLatestSignal()` then returns `null`, and the `on…Change` helpers call you with `null`.
- **Validation.** `signals.ts` drops anything on the channel that isn't a valid schema-1 event. Malformed messages never reach your callbacks.
- **Server-side components.** C02 never sends anything to a server. If your component runs on a server, your own client code forwards the JSON event to your API. Only this event may cross the network, never frames or landmarks. HTTP endpoints in `backend/services/load-service/` are only added if a component needs them (open question A0).

## 4. The event, field by field

```json
{
  "load_state": "High",
  "confidence": 0.84,
  "frustration": false,
  "engagement": "Medium",
  "timestamp": "2026-10-15T14:30:05.000Z",
  "schema_version": 1,
  "status": "active",
  "presence": "present",
  "fatigue": "Low",
  "affect": "neutral",
  "strain": "Medium",
  "suggest_break": false,
  "meta": { "fps": 14.9, "backend": "webgl", "model_version": "heuristic-0" }
}
```

| Field            | Type                                      | Meaning                                                                                                                                                         | `null` when                                                      |
| ---------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `load_state`     | `'Low' \| 'Medium' \| 'High'`             | Cognitive load relative to **this learner's own first minute**, smoothed (EMA α 0.3 plus a 2-second confirmation to stop flapping).                             | `status` is not `active`                                         |
| `confidence`     | number 0..1                               | Smoothed probability of `load_state`. Not yet checked for calibration, so don't read it as an exact probability.                                                | exactly when `load_state` is `null`                              |
| `frustration`    | boolean                                   | Load `High` for ≥ 15 s **and** inner brows drawn together or lips pressed, relative to baseline.                                                                | `status` is not `active`                                         |
| `engagement`     | `'Low' \| 'Medium' \| 'High'`             | Face present, facing the screen, gaze steady, averaged over 30 s. No ground truth exists for it.                                                                | `status` is not `active`                                         |
| `timestamp`      | ISO 8601 UTC with `Z`                     | Wall-clock time the event was sent.                                                                                                                             | never                                                            |
| `schema_version` | `1`                                       | Contract version. A breaking change increments it.                                                                                                              | never                                                            |
| `status`         | see §5                                    | Sensor lifecycle state.                                                                                                                                         | never                                                            |
| `presence`       | `'present' \| 'away' \| 'absent'`         | `away`: face visible but looking off-screen for > 3 s. `absent`: no face for > 2 s.                                                                             | camera not delivering frames, or no frame yet                    |
| `fatigue`        | `'Low' \| 'Medium' \| 'High'`             | Drowsiness indicators: eyes-closed share over 60 s (PERCLOS proxy), long eye closures, yawns, head nods. It means "drowsy", never "asleep".                     | `status` is not `active`                                         |
| `affect`         | `'neutral' \| 'frustrated' \| 'confused'` | Coarse mood from brow and lip movement against baseline. Weak by design.                                                                                        | not `active`, or expression features switched off (FR3 ablation) |
| `strain`         | `'Low' \| 'Medium' \| 'High'`             | How worn out the learner is today: time on task, time at High load, time since the last break, fatigue. Totals are kept on the device for the current day only. | camera not delivering frames                                     |
| `suggest_break`  | boolean                                   | `strain` is `High`, or `fatigue` has been `High` for 2 min. Advice for you; C02 itself takes no action.                                                         | same as `strain`                                                 |
| `meta`           | object, optional                          | Diagnostics: `fps`, `backend`, `model_version`. **Do not base behaviour on it.**                                                                                | absent before the face model has loaded                          |

`load_state`, `presence`, `fatigue`, `affect` and `strain` have proposed names and meanings. C01/C03/C04 still need to agree them (TODO A0). Until then they may change, but only additively.

## 5. Status values

| `status`            | Meaning                                                                                | Estimates                                     |
| ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| `disabled`          | Sensing is off (the default: sensing is opt-in) or the sensor page was closed cleanly. | `null`                                        |
| `starting`¹         | Waiting for camera permission or loading the face model.                               | `null`                                        |
| `calibrating`       | Collecting the learner's 60 s baseline, or (re)filling the 30 s window.                | `null` (`presence`, `strain` known)           |
| `active`            | A load estimate is available.                                                          | all set                                       |
| `no_face`           | No face for > 2 s.                                                                     | `null` (`presence: "absent"`, `strain` known) |
| `paused`            | The learner paused sensing, or the tab is hidden.                                      | `null`                                        |
| `permission_denied` | The learner or a browser policy blocked the camera.                                    | `null`                                        |
| `no_camera`¹        | There is no camera, or it was unplugged.                                               | `null`                                        |
| `camera_in_use`¹    | Another app is using the camera.                                                       | `null`                                        |
| `unsupported`       | No usable camera API here (needs https or localhost), or no WebGL/WASM backend.        | `null`                                        |
| `error`¹            | Any other failure.                                                                     | `null`                                        |

¹ Proposed additions (C2 owner, 2026-10-10), pending agreement. **Treat any status you don't recognise like `disabled`.**

## 6. What `null` means and what you must do

`null` is a normal value, not an error. In the requirements survey, 45.8 % of students said they were not comfortable with webcam sensing, so many learners will run with sensing off all the time. Every component must:

1. **Work fully with every field `null`.** Use your normal behaviour, as if C02 didn't exist.
2. **Treat a stale signal as `null`.** The helpers already do this for you.
3. **Never block study content on the signal.** The camera is optional (`cameraPolicy: 'optional'`). A "camera required" mode exists in code but stays disabled until the supervisor and ethics reviewer approve it.
4. **Ignore fields you don't know.** Later versions only add fields.

## 7. API reference: `@adaptlearn/load-sensor/signals`

| Export                                             | Description                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `subscribe(cb)`                                    | Every valid event (changes and heartbeats). Replays the latest fresh event first.                |
| `onLoadChange(cb)`                                 | `cb(level, event)` when `load_state` changes; first value included; `cb(null, null)` when stale. |
| `onPresenceChange(cb)`                             | Same, for `presence`.                                                                            |
| `onFatigueChange(cb)`                              | Same, for `fatigue`.                                                                             |
| `onAffectChange(cb)`                               | Same, for `affect`.                                                                              |
| `onStrainChange(cb)`                               | Same, for `strain`.                                                                              |
| `getLatestSignal()`                                | Latest event, or `null` if none or older than 12 s.                                              |
| `LOAD_STATE_CHANNEL`                               | `'adaptlearn.load-state'`, if you'd rather open the BroadcastChannel yourself.                   |
| `isLoadStateEvent(x)`, `validateLoadStateEvent(x)` | Validate an event yourself, e.g. on your server after forwarding.                                |
| `createSignalClient(options)`                      | A separate client with its own listeners (tests, custom channel name).                           |
| Types                                              | `LoadStateEvent`, `Level`, `PresenceState`, `AffectState`, `LoadSensorStatus`, `LoadStateMeta`.  |

If you open the channel yourself, post `LOAD_STATE_REQUEST` to get the latest event immediately. That is the only message a consumer may send.

## 8. For the page that owns the camera: `createLoadSensor()`

Only C02's UI does this. Shown here so the full picture is in one place.

```ts
import { createLoadSensor } from '@adaptlearn/load-sensor';

const sensor = createLoadSensor({ modelBaseUrl: '/models/', wasmBaseUrl: '/wasm/' });
sensor.on('change', (e) => render(e));
toggle.onclick = () => (sensor.status === 'disabled' ? sensor.enable() : sensor.disable());
```

| Member                                   | Description                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `enable()`                               | Opens the camera (the browser may prompt). Call this only after the learner opts in. Resolves with the status and never rejects. |
| `pause()` / `resume()`                   | Keep the camera open but stop processing.                                                                                        |
| `disable()`                              | Stops every camera track (LED off) and forgets the baseline.                                                                     |
| `on('state' \| 'change' \| 'error', cb)` | `state`: every event. `change`: only real changes. `error`: non-fatal problems.                                                  |
| `getState()`                             | Last emitted event, synchronously.                                                                                               |
| `markBreak()`                            | The learner took a break. Resets "time since the last break" in `strain`.                                                        |
| `recalibrate()`                          | Starts a new 60 s baseline.                                                                                                      |
| `destroy()`                              | Disables, then releases the model, timers and channel.                                                                           |
| `studyGate`                              | `'open'`, or `'needs_camera'` under the (not yet approved) `required` policy.                                                    |

Options: `video` (preview element), `targetFps` (15), `useExpressionFeatures` (true; FR3 ablation), `heartbeatMs` (5000), `broadcast` (true), `classifier` (replaces heuristic-0), `strainStorage` (localStorage; `null` keeps totals in memory only), `cameraPolicy` (`'optional'`).

## 9. Privacy boundary

All video is processed in the browser, and only the event above leaves the sensor. It carries labels, booleans and a few numbers. The validator rejects any event that carries an array or a nested object other than `meta`, so landmark or pixel data cannot get into one by mistake. `strain`'s day totals are six numbers in `localStorage` under `adaptlearn.c2.strain.v1`, and each new day overwrites the previous one.

## 10. Known limitations

- One sensor per browser profile is expected. Two sensor tabs would both publish on the same channel.
- Same origin only. A component on another origin needs its own forwarding, agreed with C02.
- `strain` only counts time while sensing is on.
- Every threshold is a starting point marked **(tune)** in `src/core/heuristics/config.ts` and `src/core/classifier/`. They get checked against pilot NASA-TLX data in milestone B.

Try it: run `pnpm dev` in `packages/load-sensor/`, open <http://localhost:5174/consumer.html> in one tab and the sensor demo in another, then turn sensing on.
