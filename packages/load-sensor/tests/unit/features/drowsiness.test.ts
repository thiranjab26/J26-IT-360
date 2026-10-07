import { describe, expect, it } from 'vitest';
import { NodDetector, YawnDetector } from '../../../src/core/features/index.js';

function yawns(fps: number, signal: (t: number) => number, durationMs = 6000): number[] {
  const det = new YawnDetector();
  const out: number[] = [];
  for (let t = 0; t < durationMs; t += 1000 / fps) {
    const d = det.update(t, signal(t));
    if (d !== null) out.push(d);
  }
  return out;
}

function nods(fps: number, pitch: (t: number) => number, durationMs = 8000): number {
  const det = new NodDetector();
  let n = 0;
  for (let t = 0; t < durationMs; t += 1000 / fps) if (det.update(t, pitch(t))) n += 1;
  return n;
}

describe('YawnDetector (drowsiness, ARCHITECTURE.md §8a)', () => {
  it.each([10, 15, 30])('detects a 2.5 s yawn at %i fps', (fps) => {
    const d = yawns(fps, (t) => (t >= 1000 && t < 3500 ? 0.7 : 0.05));
    expect(d).toHaveLength(1);
    expect(Math.abs((d[0] ?? 0) - 2500)).toBeLessThanOrEqual(1000 / fps);
  });

  it('does not count speech-sized or brief openings', () => {
    expect(yawns(15, (t) => 0.2 + 0.1 * Math.sin(t / 100))).toEqual([]);
    expect(yawns(15, (t) => (t >= 1000 && t < 1600 ? 0.7 : 0.05))).toEqual([]);
  });
});

describe('NodDetector (drowsiness)', () => {
  it.each([10, 15, 30])('counts a head drop and catch at %i fps', (fps) => {
    expect(nods(fps, (t) => (t >= 2000 && t < 2800 ? 25 : 0))).toBe(1);
  });

  it('does not count looking down at the keyboard for a while', () => {
    expect(nods(15, (t) => (t >= 1000 && t < 6000 ? 25 : 0))).toBe(0);
  });

  it('does not count small movements or looking up', () => {
    expect(nods(15, (t) => 10 * Math.sin(t / 300))).toBe(0);
    expect(nods(15, (t) => (t >= 2000 && t < 2800 ? -25 : 0))).toBe(0);
  });
});
