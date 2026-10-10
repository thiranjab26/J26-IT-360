/**
 * The event contract shared with C01, C03 and C04 (ARCHITECTURE.md §8, §8a).
 *
 * CLAUDE.md invariant 5: never rename, remove or retype a field here without
 * the owner's agreement. New fields are only ever added, and every consumer
 * must ignore fields it does not know.
 *
 * Privacy (FR7): every field is a primitive. The validator rejects arrays and
 * objects (other than `meta`), so landmarks or pixels cannot ride along.
 */

/** Three-level scale used by load, engagement, fatigue and strain. */
export type Level = 'Low' | 'Medium' | 'High';

/**
 * Where the sensor is in its lifecycle. Anything other than `active` means
 * "no load estimate now": `load_state` and the other estimates are null.
 *
 * Fixed in §8: `disabled`, `permission_denied`, `unsupported`, `calibrating`,
 * `active`, `no_face`, `paused`.
 * Proposed additions (decided by the C2 owner 2026-10-10, pending agreement
 * from C01/C03/C04, TODO A0): `starting`, `no_camera`, `camera_in_use`,
 * `error`. A consumer that meets a status it does not know must treat it as
 * "no estimate", exactly like `disabled`.
 */
export type LoadSensorStatus =
  | 'disabled'
  | 'starting'
  | 'permission_denied'
  | 'no_camera'
  | 'camera_in_use'
  | 'unsupported'
  | 'error'
  | 'calibrating'
  | 'active'
  | 'no_face'
  | 'paused';

/** Is the learner at the screen (§8a)? `absent` goes with `status: "no_face"`. */
export type PresenceState = 'present' | 'away' | 'absent';

/** Coarse expression-based mood (§8a). Weak by design; part of the FR3 ablation. */
export type AffectState = 'neutral' | 'frustrated' | 'confused';

/** Diagnostics; optional, consumers must not depend on it for behaviour. */
export interface LoadStateMeta {
  /** Landmark frames processed per second (frame clock). */
  readonly fps: number;
  /** TF.js backend in use, e.g. `webgl` or `wasm`. */
  readonly backend: string;
  /** Classifier identity. `heuristic-0` is the placeholder rule, not a trained model. */
  readonly model_version: string;
}

export interface LoadStateEvent {
  // ── Fixed by proposal Appendix D ──
  /** null = no reliable estimate right now (sensing off, calibrating, no face, …). */
  readonly load_state: Level | null;
  /** 0..1, the smoothed probability of `load_state`; null exactly when `load_state` is. */
  readonly confidence: number | null;
  readonly frustration: boolean | null;
  readonly engagement: Level | null;
  /** ISO 8601 UTC with `Z`, e.g. `2026-10-15T14:30:00.000Z`. Wall clock at emission. */
  readonly timestamp: string;

  // ── Additive (§8) ──
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly status: LoadSensorStatus;
  readonly meta?: LoadStateMeta;

  // ── Additive, proposed wellbeing signals (§8a); all documented heuristics ──
  readonly presence: PresenceState | null;
  readonly fatigue: Level | null;
  /** null when expression features are switched off (FR3 ablation). */
  readonly affect: AffectState | null;
  readonly strain: Level | null;
  readonly suggest_break: boolean | null;
}

export const SCHEMA_VERSION = 1;

/** BroadcastChannel name for other tabs and iframes on the same origin (§8 Delivery). */
export const LOAD_STATE_CHANNEL = 'adaptlearn.load-state';

/**
 * A consumer posts this on the channel to ask the sensor for its latest event
 * straight away, instead of waiting up to one heartbeat. It is the only
 * message a consumer ever sends.
 */
export const LOAD_STATE_REQUEST = Object.freeze({ type: 'adaptlearn.load-state.request' });

/** The sensor emits at least this often, even when nothing changed. */
export const HEARTBEAT_MS = 5_000;

export const LEVELS: readonly Level[] = ['Low', 'Medium', 'High'];

export const STATUSES: readonly LoadSensorStatus[] = [
  'disabled',
  'starting',
  'permission_denied',
  'no_camera',
  'camera_in_use',
  'unsupported',
  'error',
  'calibrating',
  'active',
  'no_face',
  'paused',
];

export const PRESENCE_STATES: readonly PresenceState[] = ['present', 'away', 'absent'];

export const AFFECT_STATES: readonly AffectState[] = ['neutral', 'frustrated', 'confused'];

/** Statuses in which the camera is delivering frames (presence and strain are known). */
export const SENSING_STATUSES: ReadonlySet<LoadSensorStatus> = new Set<LoadSensorStatus>([
  'calibrating',
  'active',
  'no_face',
]);
