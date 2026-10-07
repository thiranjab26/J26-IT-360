import { describe, expect, it } from 'vitest';
import { percentile, RateMeter, RollingSamples } from '../../../src/core/util/rolling-stats.js';

describe('percentile (linear interpolation, NumPy default)', () => {
  it.each([
    [[1, 2, 3, 4], 50, 2.5],
    [[1, 2, 3, 4], 95, 3.85],
    [[1, 2, 3, 4], 0, 1],
    [[1, 2, 3, 4], 100, 4],
    [[7], 95, 7],
  ])('%j p%i = %f', (values, p, expected) => {
    expect(percentile(values, p)).toBeCloseTo(expected, 10);
  });

  it('is NaN for no data', () => {
    expect(percentile([], 50)).toBeNaN();
  });
});

describe('RollingSamples', () => {
  it('keeps only the newest `capacity` samples', () => {
    const r = new RollingSamples(3);
    for (const v of [100, 1, 2, 3]) r.push(v);
    expect(r.size).toBe(3);
    expect(r.percentile(100)).toBe(3);
    expect(r.percentile(50)).toBe(2);
  });

  it('sorts numerically, not as strings', () => {
    const r = new RollingSamples(4);
    for (const v of [10, 9, 100, 2]) r.push(v);
    expect(r.percentile(0)).toBe(2);
    expect(r.percentile(100)).toBe(100);
  });

  it('rejects a bad capacity', () => {
    expect(() => new RollingSamples(0)).toThrow(RangeError);
  });
});

describe('RateMeter', () => {
  it('measures events per second over the trailing window', () => {
    const m = new RateMeter(1000);
    for (let t = 0; t <= 3000; t += 1000 / 15) m.mark(t);
    expect(m.rate).toBeCloseTo(15, 5);
  });

  it('forgets events older than the window', () => {
    const m = new RateMeter(1000);
    for (let t = 0; t < 1000; t += 10) m.mark(t);
    for (let t = 2000; t <= 3000; t += 100) m.mark(t);
    expect(m.rate).toBeCloseTo(10, 5);
  });

  it('is 0 with fewer than two events', () => {
    const m = new RateMeter();
    expect(m.rate).toBe(0);
    m.mark(5);
    expect(m.rate).toBe(0);
  });
});
