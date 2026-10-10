import { describe, expect, it } from 'vitest';
import {
  isLoadStateEvent,
  validateLoadStateEvent,
  type LoadStateEvent,
} from '../../../src/core/events/index.js';

/** A complete active event, as the sensor emits it. */
const active: LoadStateEvent = {
  load_state: 'High',
  confidence: 0.84,
  frustration: true,
  engagement: 'Low',
  timestamp: '2026-10-15T14:30:00.000Z',
  schema_version: 1,
  status: 'active',
  presence: 'present',
  fatigue: 'Medium',
  affect: 'frustrated',
  strain: 'Low',
  suggest_break: false,
  meta: { fps: 14.8, backend: 'webgl', model_version: 'heuristic-0' },
};

const disabled: LoadStateEvent = {
  load_state: null,
  confidence: null,
  frustration: null,
  engagement: null,
  timestamp: '2026-10-15T14:30:00.000Z',
  schema_version: 1,
  status: 'disabled',
  presence: null,
  fatigue: null,
  affect: null,
  strain: null,
  suggest_break: null,
};

const errorsOf = (value: unknown): readonly string[] => {
  const r = validateLoadStateEvent(value);
  return r.ok ? [] : r.errors;
};

describe('validateLoadStateEvent (FR6, NFR8 contract)', () => {
  it('accepts an active event and a disabled event', () => {
    expect(errorsOf(active)).toEqual([]);
    expect(errorsOf(disabled)).toEqual([]);
    expect(isLoadStateEvent(active)).toBe(true);
  });

  it('accepts the proposal Appendix D fields with the additive ones', () => {
    // Appendix D example, completed with the agreed additive fields.
    const appendixD = { ...active, timestamp: '2026-10-15T14:30:00Z' };
    expect(errorsOf(appendixD)).toEqual([]);
  });

  it('accepts every proposed status (2026-10-10 decision)', () => {
    for (const status of ['starting', 'no_camera', 'camera_in_use', 'error'] as const) {
      expect(errorsOf({ ...disabled, status })).toEqual([]);
    }
  });

  it('accepts a sensing status with presence and strain but no load estimate', () => {
    const noFace = {
      ...disabled,
      status: 'no_face',
      presence: 'absent',
      strain: 'Low',
      suggest_break: false,
    };
    expect(errorsOf(noFace)).toEqual([]);
  });

  it.each([
    ['load_state', 'Extreme'],
    ['engagement', 'high'],
    ['fatigue', 3],
    ['strain', true],
    ['presence', 'gone'],
    ['affect', 'happy'],
    ['status', 'sleeping'],
    ['frustration', 'yes'],
    ['suggest_break', 1],
  ])('rejects %s = %j', (key, value) => {
    expect(errorsOf({ ...active, [key]: value }).length).toBeGreaterThan(0);
  });

  it.each(['load_state', 'confidence', 'timestamp', 'status', 'presence', 'suggest_break'])(
    'rejects a missing %s',
    (key) => {
      const copy = Object.fromEntries(Object.entries(active).filter(([k]) => k !== key));
      expect(errorsOf(copy).length).toBeGreaterThan(0);
    },
  );

  it('rejects confidence outside 0..1, NaN, or present without load_state', () => {
    expect(errorsOf({ ...active, confidence: 1.2 })).toContain('confidence must be within 0..1');
    expect(errorsOf({ ...active, confidence: -0.1 })).toContain('confidence must be within 0..1');
    expect(errorsOf({ ...active, confidence: Number.NaN }).length).toBeGreaterThan(0);
    expect(errorsOf({ ...active, confidence: null })).toContain(
      'confidence must be null exactly when load_state is null',
    );
  });

  it('rejects timestamps that are not UTC ISO 8601 with Z', () => {
    for (const timestamp of [
      '2026-10-15T14:30:00',
      '2026-10-15 14:30:00Z',
      '2026-10-15T14:30:00+05:30',
      '2026-13-45T99:99:99Z',
    ]) {
      expect(errorsOf({ ...active, timestamp }).length, timestamp).toBeGreaterThan(0);
    }
  });

  it('rejects another schema version', () => {
    expect(errorsOf({ ...active, schema_version: 2 })).toContain('schema_version must be 1');
  });

  it('requires estimates to be null unless status is active', () => {
    expect(errorsOf({ ...active, status: 'calibrating' })).toEqual(
      expect.arrayContaining([
        'load_state must be null when status is calibrating',
        'engagement must be null when status is calibrating',
      ]),
    );
  });

  it('requires presence and strain to be null when the camera is not delivering frames', () => {
    expect(errorsOf({ ...disabled, status: 'paused', presence: 'present' })).toContain(
      'presence must be null when status is paused',
    );
  });

  it('checks meta', () => {
    expect(
      errorsOf({ ...active, meta: { fps: -1, backend: 'webgl', model_version: 'x' } }).length,
    ).toBe(1);
    expect(
      errorsOf({ ...active, meta: { fps: 15, backend: 'webgl', model_version: '' } }).length,
    ).toBe(1);
    expect(errorsOf({ ...active, meta: 'webgl' }).length).toBe(1);
  });

  it('allows unknown primitive fields, so later additive fields do not break old consumers', () => {
    expect(errorsOf({ ...active, focus_score: 0.4, note: 'x', flag: null })).toEqual([]);
  });

  it('rejects arrays and objects in unknown fields: no landmarks or pixels can ride along (FR7)', () => {
    expect(errorsOf({ ...active, landmarks: [0.1, 0.2, 0.3] })).toEqual([
      'unknown field landmarks must be a primitive',
    ]);
    expect(errorsOf({ ...active, mesh: new Float32Array(1434) }).length).toBe(1);
    expect(errorsOf({ ...active, meta: { ...active.meta, frame: { w: 1 } } }).length).toBe(1);
  });

  it('rejects values that are not plain objects', () => {
    for (const value of [null, undefined, 'event', 42, [active], new Map()]) {
      expect(isLoadStateEvent(value)).toBe(false);
    }
  });
});
