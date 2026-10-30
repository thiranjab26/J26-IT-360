import { describe, expect, it } from 'vitest';
import {
  EXTRAS_CHANNEL,
  EXTRAS_MOODS,
  ExtrasPublisher,
  subscribeExtras,
  validateExtraSignalsEvent,
  type ExtraSignalsEvent,
  type ExtrasMood,
} from '../../../src/core/events/index.js';
import { FEATURE_COUNT, FEATURE_INDEX as I } from '../../../src/core/features/spec.js';
import type { FrameSignals } from '../../../src/core/features/index.js';
import type { BoredomReading, OverloadReading } from '../../../src/core/heuristics/index.js';
import type { NormalisedSecond } from '../../../src/core/window/index.js';
import { buildExtrasEvent } from '../../../src/demo/extras.js';
import type { Mood, MoodReading } from '../../../src/demo/mood.js';
import { FakeChannelBus, settle } from '../helpers/fake-channel.js';

const GOOD: ExtraSignalsEvent = {
  kind: 'adaptlearn.c02.extras',
  extras_version: 1,
  timestamp: '2026-10-30T22:50:00.000Z',
  status: 'active',
  mood: 'happy',
  mood_source: 'model',
  boredom: 'not_bored',
  overload: 'manageable',
  head_yaw_deg: 5.2,
  head_pitch_deg: -3.1,
  head_roll_deg: 0.4,
  blinks_last_second: 1,
  eyes_closed_fraction: 0.067,
  gaze_centred_fraction: 0.933,
};

describe('extra signals stream (owner decision 30 Oct; LoadStateEvent unchanged)', () => {
  it('accepts a well-formed event and an all-null one', () => {
    expect(validateExtraSignalsEvent(GOOD).ok).toBe(true);
    const empty = Object.fromEntries(
      Object.entries(GOOD).map(([k, v]) =>
        ['kind', 'extras_version', 'timestamp', 'status'].includes(k) ? [k, v] : [k, null],
      ),
    );
    expect(validateExtraSignalsEvent({ ...empty, status: 'no_face' }).ok).toBe(true);
  });

  it('rejects arrays and objects, so landmarks cannot ride along (FR7)', () => {
    const r = validateExtraSignalsEvent({ ...GOOD, mesh: [0.1, 0.2, 0.3] });
    expect(r.ok).toBe(false);
    expect(validateExtraSignalsEvent({ ...GOOD, frame: { w: 640 } }).ok).toBe(false);
  });

  it('rejects unknown values, out-of-range numbers and missing fields', () => {
    expect(validateExtraSignalsEvent({ ...GOOD, mood: 'ecstatic' }).ok).toBe(false);
    expect(validateExtraSignalsEvent({ ...GOOD, boredom: 'very' }).ok).toBe(false);
    expect(validateExtraSignalsEvent({ ...GOOD, eyes_closed_fraction: 1.5 }).ok).toBe(false);
    expect(validateExtraSignalsEvent({ ...GOOD, head_yaw_deg: Number.NaN }).ok).toBe(false);
    expect(validateExtraSignalsEvent({ ...GOOD, mood: null }).ok).toBe(false); // source without mood
    const missing: Record<string, unknown> = { ...GOOD };
    delete missing.overload;
    expect(validateExtraSignalsEvent(missing).ok).toBe(false);
    expect(validateExtraSignalsEvent({ ...GOOD, kind: 'adaptlearn.load-state' }).ok).toBe(false);
  });

  it('allows a later primitive field (additive changes)', () => {
    expect(validateExtraSignalsEvent({ ...GOOD, future_score: 0.5 }).ok).toBe(true);
  });

  it('publisher refuses an invalid event and posts a valid one on its own channel', async () => {
    const bus = new FakeChannelBus();
    const publisher = new ExtrasPublisher(bus.factory);
    expect(() => {
      publisher.publish({ ...GOOD, mood: 'ecstatic' } as unknown as ExtraSignalsEvent);
    }).toThrow(/invalid extras event/);
    const received: ExtraSignalsEvent[] = [];
    const off = subscribeExtras((e) => received.push(e), bus.factory);
    publisher.publish(GOOD);
    bus.inject(EXTRAS_CHANNEL, { hello: 'not an event' });
    await settle();
    expect(received).toEqual([GOOD]);
    expect(bus.posted.every((p) => p.name === EXTRAS_CHANNEL)).toBe(true);
    off();
    publisher.close();
    expect(bus.open.size).toBe(0);
  });

  it('every demo mood except no-face is a valid extras mood', () => {
    const demoMoods: Exclude<Mood, 'no-face'>[] = [
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
    // Compile-time: the demo's moods fit the wire type.
    const asWire: readonly ExtrasMood[] = demoMoods;
    expect([...asWire].sort()).toEqual([...EXTRAS_MOODS].sort());
  });
});

describe('buildExtrasEvent (demo)', () => {
  const raw = new Float32Array(FEATURE_COUNT);
  raw[I.blink_count] = 1;
  raw[I.eyes_closed_fraction] = 0.0666667;
  raw[I.gaze_centred_fraction] = 0.9333333;
  const second = { valid: true, raw } as unknown as NormalisedSecond;
  const mood = (m: Mood, expression = true) =>
    ({ mood: m, expression, source: 'model' }) as unknown as MoodReading;
  const boredom = { state: 'not_bored' } as unknown as BoredomReading;
  const overload = { state: 'manageable' } as unknown as OverloadReading;
  const frame = { yaw: 5.24, pitch: -3.06, roll: 0.41 } as unknown as FrameSignals;
  const now = new Date('2026-10-30T22:50:00.000Z');

  it('maps the readings onto a valid event, rounded', () => {
    const e = buildExtrasEvent({
      status: 'active',
      mood: mood('happy'),
      boredom,
      overload,
      frame,
      second,
      now,
    });
    expect(e).toEqual(GOOD);
    expect(validateExtraSignalsEvent(e).ok).toBe(true);
  });

  it('no face: mood and its source null; an invalid second: measures null', () => {
    const e = buildExtrasEvent({
      status: 'no_face',
      mood: mood('no-face'),
      boredom: { state: null } as unknown as BoredomReading,
      overload: { state: null } as unknown as OverloadReading,
      frame: null,
      second: { valid: false, raw } as unknown as NormalisedSecond,
      now,
    });
    expect(e.mood).toBeNull();
    expect(e.mood_source).toBeNull();
    expect(e.head_yaw_deg).toBeNull();
    expect(e.blinks_last_second).toBeNull();
    expect(e.eyes_closed_fraction).toBeNull();
    expect(validateExtraSignalsEvent(e).ok).toBe(true);
  });

  it('expression features off (FR3 ablation): no mood source', () => {
    const e = buildExtrasEvent({
      status: 'active',
      mood: mood('drowsy', false),
      boredom,
      overload,
      frame,
      second,
      now,
    });
    expect(e.mood).toBe('drowsy');
    expect(e.mood_source).toBeNull();
  });
});
