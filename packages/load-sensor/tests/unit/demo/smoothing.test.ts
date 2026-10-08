import { describe, expect, it } from 'vitest';
import { monotoneTangents } from '../../../src/demo/charts.js';
import { OneEuroVector } from '../../../src/demo/one-euro.js';

/** Deterministic pseudo-random jitter in [-1, 1]. */
function jitter(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

describe('OneEuroVector (overlay display smoothing)', () => {
  const opts = { minCutoff: 1.2, beta: 10, dCutoff: 1 };

  it('returns the first sample unchanged', () => {
    const f = new OneEuroVector(opts);
    expect(Array.from(f.filter([0.3, 0.7], 0))).toEqual([
      expect.closeTo(0.3, 6),
      expect.closeTo(0.7, 6),
    ]);
  });

  it('cuts the jitter of a still point by more than half at 15 fps', () => {
    const f = new OneEuroVector(opts);
    let rawVar = 0;
    let outVar = 0;
    const n = 300;
    for (let i = 0; i < n; i += 1) {
      const raw = 0.5 + 0.002 * jitter(i);
      const out = f.filter([raw], (i * 1000) / 15)[0] ?? 0;
      if (i >= 30) {
        rawVar += (raw - 0.5) ** 2;
        outVar += (out - 0.5) ** 2;
      }
    }
    expect(outVar).toBeLessThan(rawVar * 0.5);
  });

  it('follows a fast head turn closely (lag under 0.03 frame widths)', () => {
    const f = new OneEuroVector(opts);
    let worst = 0;
    for (let i = 0; i < 60; i += 1) {
      const t = (i * 1000) / 15;
      const raw = 0.2 + 0.6 * (t / 1000); // 0.6 frame widths per second
      const out = f.filter([raw], t)[0] ?? 0;
      if (i >= 15) worst = Math.max(worst, Math.abs(raw - out));
    }
    expect(worst).toBeLessThan(0.03);
  });

  it('restarts after reset instead of sliding from the old position', () => {
    const f = new OneEuroVector(opts);
    f.filter([0.1], 0);
    f.filter([0.1], 67);
    f.reset();
    expect(f.filter([0.9], 134)[0]).toBeCloseTo(0.9, 6);
  });
});

describe('monotoneTangents (chart curves)', () => {
  /** Samples the cubic Hermite segment between points i and i+1. */
  function segment(xs: number[], ys: number[], m: number[], i: number, steps = 20): number[] {
    const x0 = xs[i] ?? 0;
    const hx = (xs[i + 1] ?? 0) - x0;
    const y0 = ys[i] ?? 0;
    const y1 = ys[i + 1] ?? 0;
    const out: number[] = [];
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
      const h10 = t ** 3 - 2 * t ** 2 + t;
      const h01 = -2 * t ** 3 + 3 * t ** 2;
      const h11 = t ** 3 - t ** 2;
      out.push(h00 * y0 + h10 * hx * (m[i] ?? 0) + h01 * y1 + h11 * hx * (m[i + 1] ?? 0));
    }
    return out;
  }

  it('never overshoots the data, so a blink dip is drawn exactly as deep as it is', () => {
    // EAR-like trace: open, a 3-frame blink dip, open again.
    const xs = [0, 1, 2, 3, 4, 5, 6, 7];
    const ys = [0.3, 0.3, 0.29, 0.12, 0.1, 0.25, 0.3, 0.3];
    const m = monotoneTangents(xs, ys);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    for (let i = 0; i < xs.length - 1; i += 1) {
      const a = Math.min(ys[i] ?? 0, ys[i + 1] ?? 0);
      const b = Math.max(ys[i] ?? 0, ys[i + 1] ?? 0);
      for (const v of segment(xs, ys, m, i)) {
        expect(v).toBeGreaterThanOrEqual(Math.max(lo, a) - 1e-9);
        expect(v).toBeLessThanOrEqual(Math.min(hi, b) + 1e-9);
      }
    }
  });

  it('keeps flat stretches flat', () => {
    const m = monotoneTangents([0, 1, 2, 3], [0.5, 0.5, 0.5, 0.8]);
    expect(m[0]).toBe(0);
    expect(m[1]).toBe(0);
  });
});
