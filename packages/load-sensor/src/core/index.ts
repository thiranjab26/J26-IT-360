/**
 * Public API of the C02 load sensor, for the page that owns the camera.
 *
 * Components that only *consume* the signal (C01, C03, C04) import
 * `@adaptlearn/load-sensor/signals` instead (src/signals.ts): it has no camera
 * or TF.js code at all. Contract: docs/c2/ARCHITECTURE.md §8, field by field
 * in INTEGRATION.md.
 *
 * Importing this module has no side effects: no camera, no network, no model
 * load until `enable()` (tests/unit/public-api.test.ts).
 */
export {
  CameraPolicyNotApprovedError,
  REQUIRED_CAMERA_POLICY_APPROVED,
  createLoadSensor,
  type CameraPolicy,
  type LoadSensor,
  type LoadSensorEvents,
  type LoadSensorOptions,
  type StudyGate,
} from './sensor.js';
export {
  HEARTBEAT_MS,
  LOAD_STATE_CHANNEL,
  SCHEMA_VERSION,
  isLoadStateEvent,
  validateLoadStateEvent,
  type AffectState,
  type Level,
  type LoadSensorStatus,
  type LoadStateEvent,
  type LoadStateMeta,
  type PresenceState,
  type ValidationResult,
} from './events/index.js';
export {
  HEURISTIC_MODEL_VERSION,
  type LoadClassifier,
  type LoadProbabilities,
} from './classifier/index.js';
export type { StrainStorage } from './heuristics/index.js';
