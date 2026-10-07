import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT } from '../../../src/core/features/index.js';
import {
  BaselineCalibrator,
  FeatureWindow,
  PresenceTracker,
  ReferenceTracker,
  RollingMedian,
} from '../../../src/core/window/index.js';
import type { FrameSignals } from '../../../src/core/features/index.js';

const row = (fill: (i: number) => number): Float32Array =>
  Float32Array.from({ length: FEATURE_COUNT }, (_, i) => fill(i));

describe('RollingMedian', () => {
  it('is the median of the samples inside the time window', () => {
    const m = new RollingMedian(1000);
    [5, 1, 9, 3, 7].forEach((v, i) => {
      m.push(i * 100, v);
    });
    expect(m.median()).toBe(5);
    m.push(1250, 100); // drops t < 250 → [3, 7, 100]
    expect(m.median()).toBe(7);
  });

  it('ignores the minority of blink frames when estimating open-eye EAR', () => {
    const m = new RollingMedian(10_000);
    for (let i = 0; i < 150; i += 1) m.push(i * 66, i % 20 === 0 ? 0.05 : 0.3);
    expect(m.median()).toBe(0.3);
  });

  it('caps memory', () => {
    const m = new RollingMedian(1e9, 10);
    for (let i = 0; i < 100; i += 1) m.push(i, i);
    expect(m.size).toBe(10);
  });
});

describe('ReferenceTracker', () => {
  const s = (ear: number, yaw = 0): FrameSignals =>
    ({ ear, irisDx: 0, irisDy: 0, yaw, pitch: 0 }) as FrameSignals;

  it('is null until enough samples, then the running median', () => {
    const r = new ReferenceTracker(10_000, 3);
    r.observe(0, s(0.3));
    r.observe(66, s(0.3));
    expect(r.current()).toBeNull();
    r.observe(133, s(0.28));
    expect(r.current()?.ear).toBe(0.3);
  });

  it('freezes at the end of calibration so looking away does not become the new normal', () => {
    const r = new ReferenceTracker(10_000, 1);
    for (let t = 0; t < 2000; t += 66) r.observe(t, s(0.3, 0));
    r.freeze();
    for (let t = 2000; t < 20_000; t += 66) r.observe(t, s(0.3, 40));
    expect(r.current()?.yaw).toBe(0);
    r.reset();
    expect(r.frozen).toBe(false);
  });
});

describe('BaselineCalibrator (ARCHITECTURE.md §5.4)', () => {
  it('collects N valid seconds, then z-scores against their mean and population std', () => {
    const b = new BaselineCalibrator({ seconds: 4 });
    const values = [1, 2, 3, 4];
    values.forEach((v, i) => {
      const done = b.add(row(() => v));
      expect(done).toBe(i === 3);
    });
    expect(b.ready).toBe(true);
    // mean 2.5, population std √1.25
    expect(b.zScore(row(() => 2.5))[0]).toBeCloseTo(0, 6);
    expect(b.zScore(row(() => 2.5 + Math.sqrt(1.25)))[0]).toBeCloseTo(1, 5);
  });

  it('gives z = 0 for a feature that never varied during calibration', () => {
    const b = new BaselineCalibrator({ seconds: 3 });
    for (let i = 0; i < 3; i += 1) b.add(row((f) => (f === 0 ? 0 : i)));
    expect(b.zScore(row(() => 7))[0]).toBe(0);
  });

  it('clips extreme z-scores', () => {
    const b = new BaselineCalibrator({ seconds: 2, zClip: 5 });
    b.add(row(() => 0));
    b.add(row(() => 1));
    expect(b.zScore(row(() => 1000))[3]).toBe(5);
    expect(b.zScore(row(() => -1000))[3]).toBe(-5);
  });

  it('reports progress and refuses to z-score early', () => {
    const b = new BaselineCalibrator({ seconds: 4 });
    b.add(row(() => 1));
    expect(b.progress).toBe(0.25);
    expect(() => b.zScore(row(() => 1))).toThrow();
  });
});

describe('FeatureWindow (ARCHITECTURE.md §5.5)', () => {
  const push = (w: FeatureWindow, n: number, valid: (i: number) => boolean) => {
    for (let i = 0; i < n; i += 1) w.push({ second: i, z: row(() => i + 1), valid: valid(i) });
  };

  it('keeps the last T seconds, oldest first', () => {
    const w = new FeatureWindow(3);
    push(w, 5, () => true);
    expect(w.rows().map((r) => r.second)).toEqual([2, 3, 4]);
    expect(w.full).toBe(true);
  });

  it('is classifiable only when full and at most 30 % invalid', () => {
    const w = new FeatureWindow(10, 0.3);
    push(w, 9, () => true);
    expect(w.classifiable).toBe(false);
    push(w, 1, () => true);
    expect(w.classifiable).toBe(true);
    const gappy = new FeatureWindow(10, 0.3);
    push(gappy, 10, (i) => i >= 4); // 4 invalid = 40 %
    expect(gappy.classifiable).toBe(false);
  });

  it('masks invalid seconds to zeros in the model input, never interpolating', () => {
    const w = new FeatureWindow(3);
    push(w, 3, (i) => i !== 1);
    const input = w.toModelInput();
    expect(Array.from(input.mask)).toEqual([1, 0, 1]);
    expect(input.data[FEATURE_COUNT]).toBe(0);
    expect(input.data[0]).toBe(1);
    expect(input.data[2 * FEATURE_COUNT]).toBe(3);
    expect(input.data).toHaveLength(3 * FEATURE_COUNT);
  });
});

describe('PresenceTracker', () => {
  it('present → absent only after 2 s without a face', () => {
    const p = new PresenceTracker(2000, 3000);
    expect(p.update(0, true, false)).toBe('present');
    expect(p.update(1500, false, false)).toBe('present');
    expect(p.update(2100, false, false)).toBe('absent');
    expect(p.update(2200, true, false)).toBe('present');
  });

  it('away only after looking off-screen continuously for 3 s', () => {
    const p = new PresenceTracker(2000, 3000);
    p.update(0, true, true);
    expect(p.update(2900, true, true)).toBe('present');
    expect(p.update(3100, true, true)).toBe('away');
    expect(p.update(3200, true, false)).toBe('present');
  });

  it('a glance back resets the away timer', () => {
    const p = new PresenceTracker(2000, 3000);
    p.update(0, true, true);
    p.update(2000, true, false);
    expect(p.update(4500, true, true)).toBe('present');
  });

  it('starts unknown', () => {
    expect(new PresenceTracker().update(0, false, false)).toBe('unknown');
  });
});
