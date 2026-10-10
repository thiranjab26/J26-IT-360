import {
  AFFECT_STATES,
  LEVELS,
  PRESENCE_STATES,
  SCHEMA_VERSION,
  SENSING_STATUSES,
  STATUSES,
  type LoadSensorStatus,
  type LoadStateEvent,
} from './types.js';

export type ValidationResult =
  | { readonly ok: true; readonly event: LoadStateEvent }
  | { readonly ok: false; readonly errors: readonly string[] };

/** ISO 8601 in UTC with a `Z` suffix, as `Date.prototype.toISOString` writes it (ms optional). */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Estimates that only exist while a load estimate exists (`status: "active"`). */
const ACTIVE_ONLY = [
  'load_state',
  'confidence',
  'frustration',
  'engagement',
  'fatigue',
  'affect',
] as const;

/** Signals that exist whenever the camera is delivering frames. */
const SENSING_ONLY = ['presence', 'strain', 'suggest_break'] as const;

const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  'load_state',
  'confidence',
  'frustration',
  'engagement',
  'timestamp',
  'schema_version',
  'status',
  'meta',
  'presence',
  'fatigue',
  'affect',
  'strain',
  'suggest_break',
]);

/**
 * Checks that a value is a well-formed `LoadStateEvent` (schema version 1).
 *
 * Used on both sides of the contract: the sensor checks every event before it
 * leaves (a bug cannot publish a malformed event), and consumers check what
 * arrives on the BroadcastChannel (any same-origin script can post there).
 *
 * Besides types it enforces the rules consumers rely on:
 *  - `confidence` is null exactly when `load_state` is;
 *  - estimates are null unless `status` is `active`;
 *  - presence / strain are null unless the camera is delivering frames;
 *  - unknown fields are allowed (later additive fields) but must be primitives,
 *    so no array or object (e.g. landmarks) can travel inside an event (FR7).
 */
export function validateLoadStateEvent(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['event must be a plain object'] };
  const e = value;

  checkEnum(e, 'load_state', LEVELS, true, errors);
  checkEnum(e, 'engagement', LEVELS, true, errors);
  checkEnum(e, 'fatigue', LEVELS, true, errors);
  checkEnum(e, 'strain', LEVELS, true, errors);
  checkEnum(e, 'presence', PRESENCE_STATES, true, errors);
  checkEnum(e, 'affect', AFFECT_STATES, true, errors);
  checkEnum(e, 'status', STATUSES, false, errors);
  checkBooleanOrNull(e, 'frustration', errors);
  checkBooleanOrNull(e, 'suggest_break', errors);

  const confidence = e.confidence;
  if (confidence === undefined) errors.push('confidence is missing');
  else if (
    confidence !== null &&
    !(typeof confidence === 'number' && Number.isFinite(confidence)) // NaN/Infinity
  ) {
    errors.push('confidence must be a finite number or null');
  } else if (typeof confidence === 'number' && (confidence < 0 || confidence > 1)) {
    errors.push('confidence must be within 0..1');
  }
  if ((e.load_state === null) !== (confidence === null)) {
    errors.push('confidence must be null exactly when load_state is null');
  }

  if (typeof e.timestamp !== 'string' || !ISO_UTC.test(e.timestamp)) {
    errors.push('timestamp must be ISO 8601 UTC ending in Z');
  } else if (Number.isNaN(Date.parse(e.timestamp))) {
    errors.push('timestamp is not a real date');
  }

  if (e.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${String(SCHEMA_VERSION)}`);
  }

  if (e.meta !== undefined) checkMeta(e.meta, errors);

  for (const [key, field] of Object.entries(e)) {
    if (KNOWN_FIELDS.has(key)) continue;
    if (!isPrimitive(field)) errors.push(`unknown field ${key} must be a primitive`);
  }

  if (typeof e.status === 'string' && STATUSES.includes(e.status as LoadSensorStatus)) {
    const status = e.status as LoadSensorStatus;
    if (status !== 'active') {
      for (const key of ACTIVE_ONLY) {
        if (e[key] !== null && e[key] !== undefined) {
          errors.push(`${key} must be null when status is ${status}`);
        }
      }
    }
    if (!SENSING_STATUSES.has(status)) {
      for (const key of SENSING_ONLY) {
        if (e[key] !== null && e[key] !== undefined) {
          errors.push(`${key} must be null when status is ${status}`);
        }
      }
    }
  }

  return errors.length === 0
    ? { ok: true, event: value as unknown as LoadStateEvent }
    : { ok: false, errors };
}

/** Type guard form of `validateLoadStateEvent`. */
export function isLoadStateEvent(value: unknown): value is LoadStateEvent {
  return validateLoadStateEvent(value).ok;
}

function checkEnum(
  e: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
  nullable: boolean,
  errors: string[],
): void {
  const v = e[key];
  if (v === undefined) errors.push(`${key} is missing`);
  else if (v === null) {
    if (!nullable) errors.push(`${key} must not be null`);
  } else if (typeof v !== 'string' || !allowed.includes(v)) {
    errors.push(`${key} must be one of ${allowed.join(', ')}${nullable ? ' or null' : ''}`);
  }
}

function checkBooleanOrNull(e: Record<string, unknown>, key: string, errors: string[]): void {
  const v = e[key];
  if (v === undefined) errors.push(`${key} is missing`);
  else if (v !== null && typeof v !== 'boolean') errors.push(`${key} must be a boolean or null`);
}

function checkMeta(meta: unknown, errors: string[]): void {
  if (!isRecord(meta)) {
    errors.push('meta must be an object when present');
    return;
  }
  if (typeof meta.fps !== 'number' || !Number.isFinite(meta.fps) || meta.fps < 0) {
    errors.push('meta.fps must be a finite number ≥ 0');
  }
  if (typeof meta.backend !== 'string') errors.push('meta.backend must be a string');
  if (typeof meta.model_version !== 'string' || meta.model_version === '') {
    errors.push('meta.model_version must be a non-empty string');
  }
  for (const [key, field] of Object.entries(meta)) {
    if (!isPrimitive(field)) errors.push(`meta.${key} must be a primitive`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}
