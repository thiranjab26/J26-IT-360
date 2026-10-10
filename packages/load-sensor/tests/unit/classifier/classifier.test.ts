import { describe, expect, it } from 'vitest';
import {
  EmaSmoother,
  HEURISTIC_MODEL_VERSION,
  HeuristicLoadClassifier,
  Hysteresis,
  LoadSmoother,
  scoreToProbabilities,
} from '../../../src/core/classifier/index.js';
import { FEATURE_COUNT, FEATURE_INDEX as I } from '../../../src/core/features/index.js';
import type { ModelInput } from '../../../src/core/window/index.js';

/** A 30 s window whose every valid row is `row`; `invalid` seconds are masked out. */
function window(row: Partial<Record<keyof typeof I, number>>, invalid: number[] = []): ModelInput {
  const seconds = 30;
  const data = new Float32Array(seconds * FEATURE_COUNT);
  const mask = new Uint8Array(seconds).fill(1);
  for (let t = 0; t < seconds; t += 1) {
    if (invalid.includes(t)) {
      mask[t] = 0;
      continue;
    }
    for (const [name, z] of Object.entries(row))
      data[t * FEATURE_COUNT + I[name as keyof typeof I]] = z;
  }
  return { data, mask, seconds, features: FEATURE_COUNT };
}

/** Index of the largest of three values (ties → Medium). */
const argmax = (p: ArrayLike<number>): number => {
  const [low = 0, med = 0, high = 0] = Array.from(p);
  if (high > med && high > low) return 2;
  return low > med ? 0 : 1;
};
const sum = (p: ArrayLike<number>): number => Array.from(p).reduce((a, b) => a + b, 0);

/** Deterministic noise (mulberry32) so the flapping test is repeatable. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('HeuristicLoadClassifier — placeholder, model_version heuristic-0 (FR4, FR5)', () => {
  const clf = new HeuristicLoadClassifier();

  it('is labelled so nobody mistakes it for the trained model', () => {
    expect(clf.modelVersion).toBe('heuristic-0');
    expect(HEURISTIC_MODEL_VERSION).toBe('heuristic-0');
  });

  it('baseline-like window (z = 0) → Medium most likely', () => {
    expect(argmax(clf.classify(window({})))).toBe(1);
  });

  it('suppressed blinking and drawn-together brows → High', () => {
    expect(argmax(clf.classify(window({ blink_count: -2, brow_inner_gap_mean: -2 })))).toBe(2);
  });

  it('more blinking and relaxed brows → Low', () => {
    expect(argmax(clf.classify(window({ blink_count: 2, brow_inner_gap_mean: 2 })))).toBe(0);
  });

  it('ignores masked seconds', () => {
    const clean = clf.score(window({ blink_count: -1 }));
    const masked = window({ blink_count: -1 }, [0, 1, 2]);
    expect(clf.score(masked)).toBeCloseTo(clean, 10);
  });

  it('features without a weight do not move the score', () => {
    expect(clf.score(window({ head_yaw_std: 5, gaze_dispersion_x: -5 }))).toBe(0);
  });

  it('FR3 ablation: without expression features the lip weight is dropped', () => {
    const lipOnly = window({ lip_thickness_mean: -3 });
    expect(clf.score(lipOnly)).toBeGreaterThan(0);
    expect(new HeuristicLoadClassifier({ useExpressionFeatures: false }).score(lipOnly)).toBe(0);
  });

  it('probabilities are a valid distribution for any score', () => {
    for (let s = -10; s <= 10; s += 0.25) {
      const p = scoreToProbabilities(s);
      expect(p.every((x) => x >= 0 && x <= 1)).toBe(true);
      expect(sum(p)).toBeCloseTo(1, 12);
    }
  });
});

describe('Smoothing: EMA + hysteresis (ARCHITECTURE.md §7)', () => {
  it('EMA follows (1 − α)·prev + α·new', () => {
    const ema = new EmaSmoother(0.3);
    expect([...ema.update([1, 0, 0])]).toEqual([1, 0, 0]);
    const next = ema.update([0, 1, 0]);
    expect(next[0]).toBeCloseTo(0.7, 12);
    expect(next[1]).toBeCloseTo(0.3, 12);
  });

  it('EMA rejects α outside (0, 1]', () => {
    expect(() => new EmaSmoother(0)).toThrow(RangeError);
    expect(() => new EmaSmoother(1.5)).toThrow(RangeError);
  });

  it('hysteresis publishes the first label at once and a new one only after 2 consecutive leads', () => {
    const h = new Hysteresis<string>(2);
    expect(h.update('Low')).toBe('Low');
    expect(h.update('High')).toBe('Low');
    expect(h.update('Medium')).toBe('Low'); // a different challenger restarts the count
    expect(h.update('Medium')).toBe('Medium');
    expect(h.update('Medium')).toBe('Medium');
  });

  it('does not flap on noisy input around one class', () => {
    // True state Medium; noise strong enough that raw arg-max is often wrong.
    const next = rng(42);
    const smoother = new LoadSmoother();
    let rawChanges = 0;
    let publishedChanges = 0;
    let lastRaw = -1;
    let lastPublished: string | null = null;
    for (let i = 0; i < 600; i += 1) {
      const noisy = [0.15 + 0.4 * next(), 0.4 + 0.4 * next(), 0.15 + 0.4 * next()];
      const total = sum(noisy);
      const p = Float64Array.from(noisy, (x) => x / total);
      const raw = argmax(p);
      if (lastRaw !== -1 && raw !== lastRaw) rawChanges += 1;
      lastRaw = raw;
      const { level } = smoother.update(p);
      if (lastPublished !== null && level !== lastPublished) publishedChanges += 1;
      lastPublished = level;
    }
    expect(rawChanges).toBeGreaterThan(100); // the input really is noisy
    expect(publishedChanges).toBe(0);
    expect(lastPublished).toBe('Medium');
  });

  it('still follows a real change within a few seconds', () => {
    const smoother = new LoadSmoother();
    for (let i = 0; i < 20; i += 1) smoother.update(Float64Array.of(0.1, 0.8, 0.1));
    let switchedAfter = -1;
    for (let i = 1; i <= 20; i += 1) {
      if (smoother.update(Float64Array.of(0.05, 0.15, 0.8)).level === 'High') {
        switchedAfter = i;
        break;
      }
    }
    expect(switchedAfter).toBeGreaterThanOrEqual(2);
    expect(switchedAfter).toBeLessThanOrEqual(5);
  });

  it('confidence is the smoothed probability of the published level', () => {
    const smoother = new LoadSmoother(0.9, 2);
    smoother.update(Float64Array.of(0.1, 0.8, 0.1));
    // Smoothed High now leads once: hysteresis keeps Medium, and confidence is
    // Medium's own probability (0.1·0.8), not High's.
    const out = smoother.update(Float64Array.of(0, 0, 1));
    expect(argmax(out.probabilities)).toBe(2);
    expect(out.level).toBe('Medium');
    expect(out.confidence).toBeCloseTo(0.1 * 0.8, 12);
  });
});
