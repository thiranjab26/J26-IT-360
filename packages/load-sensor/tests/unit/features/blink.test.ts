import { describe, expect, it } from 'vitest';
import { BlinkDetector, type EyeClosure } from '../../../src/core/features/index.js';
import { blinkingEar } from '../../fixtures/synthetic-face.js';

const OPEN = 0.3;

/** Runs the detector over an EAR signal sampled at `fps`. */
function run(
  fps: number,
  durationMs: number,
  ear: (t: number) => number,
  openRef: number | null = OPEN,
): EyeClosure[] {
  const det = new BlinkDetector();
  const closures: EyeClosure[] = [];
  for (let t = 0; t < durationMs; t += 1000 / fps) {
    const u = det.update(t, ear(t), openRef);
    if (u.closure) closures.push(u.closure);
  }
  return closures;
}

const BLINKS = [
  { at: 1000, durationMs: 150 },
  { at: 2500, durationMs: 250 },
  { at: 4000, durationMs: 400 },
];

describe('BlinkDetector (FR2, ARCHITECTURE.md §5.2)', () => {
  it('detects every blink and classifies it as a blink', () => {
    const c = run(30, 5000, (t) => blinkingEar(t, BLINKS));
    expect(c.map((x) => x.kind)).toEqual(['blink', 'blink', 'blink']);
  });

  it.each([10, 15, 30, 60])(
    'measures blink durations within one frame interval at %i fps',
    (fps) => {
      const c = run(fps, 5000, (t) => blinkingEar(t, BLINKS));
      expect(c).toHaveLength(3);
      c.forEach((closure, i) => {
        expect(Math.abs(closure.durationMs - (BLINKS[i]?.durationMs ?? 0))).toBeLessThanOrEqual(
          1000 / fps,
        );
      });
    },
  );

  it('classifies a closure longer than 500 ms as a long closure (drowsiness), not a blink', () => {
    const c = run(15, 3000, (t) => blinkingEar(t, [{ at: 500, durationMs: 1200 }]));
    expect(c).toHaveLength(1);
    expect(c[0]?.kind).toBe('long');
    expect(c[0]?.durationMs).toBeGreaterThan(1100);
  });

  it('ignores closures shorter than 80 ms (landmark noise)', () => {
    expect(run(60, 2000, (t) => blinkingEar(t, [{ at: 500, durationMs: 40 }]))).toEqual([]);
  });

  it('uses a threshold relative to the learner’s own open EAR (narrow eyes / glasses)', () => {
    // Open EAR 0.18, closed 0.04: a fixed 0.2 threshold would call the open eye closed.
    const ear = (t: number): number => blinkingEar(t, BLINKS, 0.18, 0.04);
    expect(run(30, 5000, ear, 0.18)).toHaveLength(3);
  });

  it('hysteresis: jitter around the closing threshold does not split one blink', () => {
    // Dips just under 75 % and hovers between 75 % and 85 % before reopening.
    const ear = (t: number): number =>
      t >= 1000 && t < 1100
        ? 0.2
        : t >= 1100 && t < 1250
          ? Math.floor(t / 33) % 2
            ? 0.24
            : 0.23
          : OPEN;
    expect(run(30, 2000, ear)).toHaveLength(1);
  });

  it('detects nothing while the open-eye reference is unknown', () => {
    expect(run(30, 5000, (t) => blinkingEar(t, BLINKS), null)).toEqual([]);
  });

  it('abandons a closure in progress on reset (face lost mid-blink)', () => {
    const det = new BlinkDetector();
    det.update(0, OPEN, OPEN);
    det.update(33, 0.05, OPEN);
    det.reset();
    expect(det.update(66, OPEN, OPEN).closure).toBeNull();
  });

  it('rejects inverted hysteresis', () => {
    expect(() => new BlinkDetector({ closeRatio: 0.9, reopenRatio: 0.8 })).toThrow(RangeError);
  });
});
