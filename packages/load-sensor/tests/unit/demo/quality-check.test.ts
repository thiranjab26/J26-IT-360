import { describe, expect, it } from 'vitest';
import { computeFrameSignals } from '../../../src/core/features/frame-signals.js';
import { landmarkJitter, QualityMeter, robustStepSigma } from '../../../src/demo/quality-check.js';
import { DEFAULT_ASPECT, syntheticFace } from '../../fixtures/synthetic-face.js';

/** Deterministic standard normal (mulberry32 + Box–Muller), so tests never flake. */
function gaussian(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** A still synthetic face with independent noise σ (frame heights) on every x and y. */
function noisyFace(sigma: number, rand: () => number, size = 0.15): Float32Array {
  const face = syntheticFace({ size });
  const out = Float32Array.from(face);
  for (let i = 0; i < out.length; i += 3) {
    // x is stored as x / width, so noise of σ frame heights is σ / aspect there.
    out[i] = (out[i] ?? 0) + (sigma * rand()) / DEFAULT_ASPECT;
    out[i + 1] = (out[i + 1] ?? 0) + sigma * rand();
    // Depth is noisy too (head pose reads it); jitter ignores z, pose does not.
    out[i + 2] = (out[i + 2] ?? 0) + (sigma * rand()) / DEFAULT_ASPECT;
  }
  return out;
}

function measure(sigma: number, frames = 300, size = 0.15): ReturnType<QualityMeter['summary']> {
  const rand = gaussian(42);
  const meter = new QualityMeter();
  for (let k = 0; k < frames; k += 1) {
    const landmarks = noisyFace(sigma, rand, size);
    const s = computeFrameSignals({ landmarks, aspect: DEFAULT_ASPECT });
    meter.push({ tMs: k * 66.7, landmarks, aspect: DEFAULT_ASPECT, signals: s });
  }
  return meter.summary();
}

describe('camera quality check: noise metrics recover known noise', () => {
  it('a perfectly still face has zero jitter', () => {
    const face = syntheticFace();
    expect(landmarkJitter(face, face, DEFAULT_ASPECT)).toBe(0);
  });

  it('whole-face movement is not jitter (translation is removed)', () => {
    const a = syntheticFace({ cx: 0.5 });
    const b = syntheticFace({ cx: 0.52 });
    expect(landmarkJitter(a, b, DEFAULT_ASPECT)).toBeLessThan(1e-6);
  });

  it('landmark jitter ≈ 2σ / IOD for per-coordinate noise σ', () => {
    for (const sigma of [0.0005, 0.002]) {
      const r = measure(sigma);
      const expected = (2 * sigma) / 0.15;
      expect(r.landmarkJitterIod).toBeGreaterThan(expected * 0.9);
      expect(r.landmarkJitterIod).toBeLessThan(expected * 1.1);
    }
  });

  it('the same pixel noise on a smaller face is more jitter in IOD (why resolution can matter)', () => {
    const near = measure(0.001, 200, 0.2);
    const far = measure(0.001, 200, 0.1);
    expect(far.landmarkJitterIod).toBeGreaterThan(near.landmarkJitterIod * 1.8);
  });

  it('signal noise grows with landmark noise and is zero without it', () => {
    const still = measure(0);
    const noisy = measure(0.001);
    expect(still.earNoise).toBe(0);
    expect(noisy.earNoise).toBeGreaterThan(0);
    expect(noisy.yawNoiseDeg).toBeGreaterThan(0);
  });

  it('robust σ from successive differences recovers σ and ignores rare spikes (blinks)', () => {
    const rand = gaussian(7);
    const values = Array.from({ length: 3000 }, () => 0.01 * rand());
    // 2 % large spikes, like blinks in an EAR trace.
    for (let i = 0; i < values.length; i += 50) values[i] = (values[i] ?? 0) - 0.2;
    const diffs = values.slice(1).map((v, i) => v - (values[i] ?? 0));
    const s = robustStepSigma(diffs);
    expect(s).toBeGreaterThan(0.009);
    expect(s).toBeLessThan(0.0115);
  });

  it('reports face ratio, fps and NaN noise when there is too little data', () => {
    const meter = new QualityMeter();
    for (let k = 0; k < 20; k += 1) {
      meter.push({ tMs: k * 100, landmarks: null, aspect: DEFAULT_ASPECT, signals: null });
    }
    const r = meter.summary();
    expect(r.faceRatio).toBe(0);
    expect(r.fps).toBeCloseTo(10, 5);
    expect(r.landmarkJitterIod).toBeNaN();
    expect(r.earNoise).toBeNaN();
  });
});
