import type { ChannelFactory, ChannelLike } from './broadcast.js';
import { defaultChannelFactory } from './broadcast.js';
import { STATUSES, type LoadSensorStatus } from './types.js';

/**
 * Optional extra signals for C01, C03 and C04 (owner decision, 30 Oct 2026).
 *
 * A second, separate stream next to `LoadStateEvent`: the load-state contract
 * (invariant 5) is untouched, and a consumer that never subscribes here is not
 * affected. It carries the C02 demo's display-level readings (mood, boredom,
 * overload) and a few per-second measures, so a teammate who wants them can
 * read them without a schema negotiation first.
 *
 * Everything here is a documented heuristic or a raw measure, not a validated
 * estimate (except that `mood` may come from the trained expression model,
 * see `mood_source`). Consumers must treat it as advisory.
 *
 * Privacy (FR7): every field is a primitive; the validator rejects arrays and
 * objects, so landmarks or pixels cannot travel here.
 */

/** BroadcastChannel name; same-origin only, never sent over the network. */
export const EXTRAS_CHANNEL = 'adaptlearn.c02.extras';
export const EXTRAS_KIND = 'adaptlearn.c02.extras';
export const EXTRAS_VERSION = 1;

/** Apparent mood shown in the C02 demo (`src/demo/mood.ts`); null when there is no face. */
export type ExtrasMood =
  | 'drowsy'
  | 'happy'
  | 'surprised'
  | 'frustrated'
  | 'sad'
  | 'confused'
  | 'focused'
  | 'distracted'
  | 'neutral';

export const EXTRAS_MOODS: readonly ExtrasMood[] = [
  'drowsy',
  'happy',
  'surprised',
  'frustrated',
  'sad',
  'confused',
  'focused',
  'distracted',
  'neutral',
];

/** Where happy / surprised / frustrated / sad came from: trained model or hand-picked rules. */
export type ExtrasMoodSource = 'model' | 'rules';
export const EXTRAS_MOOD_SOURCES: readonly ExtrasMoodSource[] = ['model', 'rules'];

/** Hand-picked boredom rule (`src/core/heuristics/boredom.ts`), unvalidated. */
export type ExtrasBoredom = 'bored' | 'possibly_bored' | 'not_bored' | 'tired';
export const EXTRAS_BOREDOM: readonly ExtrasBoredom[] = [
  'bored',
  'possibly_bored',
  'not_bored',
  'tired',
];

/** Hand-picked overload rule (`src/core/heuristics/overload.ts`), unvalidated. */
export type ExtrasOverload = 'overloaded' | 'working_hard' | 'manageable';
export const EXTRAS_OVERLOAD: readonly ExtrasOverload[] = [
  'overloaded',
  'working_hard',
  'manageable',
];

export interface ExtraSignalsEvent {
  readonly kind: typeof EXTRAS_KIND;
  readonly extras_version: typeof EXTRAS_VERSION;
  /** ISO 8601 UTC with `Z`. Wall clock at emission (once per finished second). */
  readonly timestamp: string;
  /** Same value as `LoadStateEvent.status` at that moment. */
  readonly status: LoadSensorStatus;

  readonly mood: ExtrasMood | null;
  /** null when `mood` is null or expression features are off (FR3 ablation). */
  readonly mood_source: ExtrasMoodSource | null;
  readonly boredom: ExtrasBoredom | null;
  readonly overload: ExtrasOverload | null;

  /** Head angles of the latest frame in degrees, camera frame (not relative to the neutral). */
  readonly head_yaw_deg: number | null;
  readonly head_pitch_deg: number | null;
  readonly head_roll_deg: number | null;
  /** Blinks completed in the last finished second (0, 1, rarely 2); null if the second had no usable face. */
  readonly blinks_last_second: number | null;
  /** Fraction 0..1 of that second's frames with the eyes closed. */
  readonly eyes_closed_fraction: number | null;
  /** Fraction 0..1 of that second's frames with the gaze centred on the screen. */
  readonly gaze_centred_fraction: number | null;
}

export type ExtrasValidationResult =
  | { readonly ok: true; readonly event: ExtraSignalsEvent }
  | { readonly ok: false; readonly errors: readonly string[] };

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const ENUMS: readonly (readonly [keyof ExtraSignalsEvent, readonly string[]])[] = [
  ['mood', EXTRAS_MOODS],
  ['mood_source', EXTRAS_MOOD_SOURCES],
  ['boredom', EXTRAS_BOREDOM],
  ['overload', EXTRAS_OVERLOAD],
];

/** [field, min, max]; null is always allowed. */
const NUMBERS: readonly (readonly [keyof ExtraSignalsEvent, number, number])[] = [
  ['head_yaw_deg', -180, 180],
  ['head_pitch_deg', -180, 180],
  ['head_roll_deg', -180, 180],
  ['blinks_last_second', 0, 10],
  ['eyes_closed_fraction', 0, 1],
  ['gaze_centred_fraction', 0, 1],
];

/**
 * Checks an `ExtraSignalsEvent` (version 1). Like the load-state validator it
 * runs on both sides: before publishing, and on what a consumer receives.
 * Unknown fields are allowed (later additions) but must be primitives.
 */
export function validateExtraSignalsEvent(value: unknown): ExtrasValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['event must be a plain object'] };
  }
  const e = value as Record<string, unknown>;
  const errors: string[] = [];
  if (e.kind !== EXTRAS_KIND) errors.push(`kind must be ${EXTRAS_KIND}`);
  if (e.extras_version !== EXTRAS_VERSION) {
    errors.push(`extras_version must be ${String(EXTRAS_VERSION)}`);
  }
  if (typeof e.timestamp !== 'string' || !ISO_UTC.test(e.timestamp)) {
    errors.push('timestamp must be ISO 8601 UTC ending in Z');
  }
  if (!STATUSES.includes(e.status as LoadSensorStatus)) errors.push('status is not a known status');
  for (const [key, allowed] of ENUMS) {
    const v = e[key];
    if (v === undefined) errors.push(`${key} is missing`);
    else if (v !== null && !allowed.includes(v as string))
      errors.push(`${key} has an unknown value`);
  }
  for (const [key, min, max] of NUMBERS) {
    const v = e[key];
    if (v === undefined) errors.push(`${key} is missing`);
    else if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max)) {
      errors.push(`${key} must be a finite number in ${String(min)}..${String(max)} or null`);
    }
  }
  if (e.mood === null && e.mood_source !== null && e.mood_source !== undefined) {
    errors.push('mood_source must be null when mood is null');
  }
  for (const [key, field] of Object.entries(e)) {
    if (field !== null && typeof field === 'object') errors.push(`${key} must be a primitive`);
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, event: e as unknown as ExtraSignalsEvent };
}

/** Sensor side: validates and posts each event on `EXTRAS_CHANNEL`. */
export class ExtrasPublisher {
  readonly #channel: ChannelLike | null;
  #closed = false;

  constructor(factory: ChannelFactory = defaultChannelFactory, name: string = EXTRAS_CHANNEL) {
    this.#channel = factory(name);
  }

  get available(): boolean {
    return this.#channel !== null && !this.#closed;
  }

  /** Throws on an invalid event: a bug must not publish a malformed one. */
  publish(event: ExtraSignalsEvent): void {
    const result = validateExtraSignalsEvent(event);
    if (!result.ok) throw new Error(`invalid extras event: ${result.errors.join('; ')}`);
    if (!this.#channel || this.#closed) return;
    this.#channel.postMessage(event);
  }

  close(): void {
    if (!this.#channel || this.#closed) return;
    this.#closed = true;
    this.#channel.close();
  }
}

/**
 * Consumer side: calls `callback` with every valid extras event; invalid
 * messages are ignored. Returns a function that closes the channel. Events
 * arrive once per second while sensing runs, and stop when it is off.
 */
export function subscribeExtras(
  callback: (event: ExtraSignalsEvent) => void,
  factory: ChannelFactory = defaultChannelFactory,
  name: string = EXTRAS_CHANNEL,
): () => void {
  const channel = factory(name);
  if (!channel) return () => undefined;
  channel.onmessage = (message) => {
    const result = validateExtraSignalsEvent(message.data);
    if (result.ok) callback(result.event);
  };
  return () => {
    channel.onmessage = null;
    channel.close();
  };
}
