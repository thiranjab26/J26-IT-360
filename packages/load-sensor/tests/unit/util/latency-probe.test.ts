import { describe, expect, it } from 'vitest';
import type { FrameArrival } from '../../../src/core/camera/index.js';
import type { LoadClassifier } from '../../../src/core/classifier/index.js';
import { LatencyProbe, timedClassifier } from '../../../src/core/util/latency-probe.js';
import { FeaturePipeline } from '../../../src/core/window/index.js';

// A7 bench, NFR1: the probe implements the latency definitions of
// ARCHITECTURE.md §11. These tests pin what is measured from where, so a
// reported number always means the same thing.

/** A clock the test moves by hand. */
function manualClock(start = 0): { now: () => number; set: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    set: (ms) => {
      t = ms;
    },
  };
}

const at = (ms: number): FrameArrival => ({ ms, origin: 'capture' });

describe('LatencyProbe (ARCHITECTURE.md §11)', () => {
  it('frame latency = arrival → per-frame signals ready', () => {
    const clock = manualClock();
    const probe = new LatencyProbe(64, clock.now);
    for (const [arrival, ready] of [
      [1000, 1010],
      [1066, 1086],
      [1133, 1163],
    ] as const) {
      clock.set(ready);
      probe.frameSignalsReady(at(arrival), arrival !== 1066);
    }
    const r = probe.report().frameLatency;
    expect(r.n).toBe(3);
    expect(r.p50).toBe(20);
    expect(r.max).toBe(30);
    expect(r.mean).toBe(20);
    // NumPy-style linear interpolation: 20 + 0.9 * (30 - 20).
    expect(r.p95).toBeCloseTo(29, 10);
    expect(probe.report().arrivalOrigins).toEqual({ capture: 3 });
    expect([probe.report().frames, probe.report().framesWithFace]).toEqual([3, 2]);
  });

  it('event latency = newest frame of the closed second → decision; empty seconds are skipped', () => {
    const clock = manualClock();
    const probe = new LatencyProbe(64, clock.now);
    probe.decisionMade(10); // nothing seen yet: no sample
    clock.set(1010);
    probe.frameSignalsReady(at(1000), true);
    clock.set(1100);
    probe.decisionMade(15);
    probe.decisionMade(0); // a gap second has no newest frame
    expect(probe.report().eventLatency).toMatchObject({ n: 1, p50: 100, max: 100 });
  });

  it('onFrame listeners run after each timed frame until unsubscribed', () => {
    const probe = new LatencyProbe(8, () => 0);
    let calls = 0;
    const off = probe.onFrame(() => {
      calls += 1;
    });
    probe.frameSignalsReady(at(0), true);
    probe.frameSignalsReady(at(1), false);
    off();
    probe.frameSignalsReady(at(2), true);
    expect(calls).toBe(2);
  });

  it('reports null, not 0, when nothing was measured', () => {
    const probe = new LatencyProbe(8, () => 0);
    expect(probe.report().classifier).toEqual({
      n: 0,
      p50: null,
      p95: null,
      max: null,
      mean: null,
    });
  });

  it('reset() forgets everything (end of warm-up)', () => {
    const clock = manualClock();
    const probe = new LatencyProbe(8, clock.now);
    probe.frameSignalsReady(at(0), true);
    probe.inferenceTook(5);
    probe.reset();
    const r = probe.report();
    expect([r.frameLatency.n, r.inference.n]).toEqual([0, 0]);
    expect(r.arrivalOrigins).toEqual({});
    expect(r.frames).toBe(0);
    probe.decisionMade(15);
    expect(probe.report().eventLatency.n).toBe(0);
  });

  it('timedClassifier is transparent and times each call', () => {
    const clock = manualClock();
    const probe = new LatencyProbe(8, clock.now);
    let disposed = false;
    const probabilities = new Float64Array([0.2, 0.5, 0.3]);
    const inner: LoadClassifier = {
      modelVersion: 'test-1',
      classify: () => {
        clock.set(clock.now() + 3);
        return probabilities;
      },
      dispose: () => {
        disposed = true;
      },
    };
    const timed = timedClassifier(inner, probe);
    expect(timed.modelVersion).toBe('test-1');
    expect(timed.classify({} as never)).toBe(probabilities);
    timed.dispose?.();
    expect(disposed).toBe(true);
    expect(probe.report().classifier).toMatchObject({ n: 1, p50: 3 });
  });
});

describe('LatencyProbe wired to a real FeaturePipeline', () => {
  it('times each second from the arrival of its own newest frame', () => {
    // Frames at 15 fps with no face. Each arrives 5 ms after its frame time
    // and is processed 7 ms after arrival.
    const clock = manualClock();
    const probe = new LatencyProbe(256, clock.now);
    const pipeline = new FeaturePipeline();
    let current = at(0);
    pipeline.onFrame((f) => {
      probe.frameSignalsReady(current, f.signals !== null);
    });
    pipeline.onSecond((s) => {
      probe.decisionMade(s.frames);
    });

    const interval = 1000 / 15;
    for (let i = 0; i < 15 * 4; i += 1) {
      const tMs = i * interval;
      current = at(tMs + 5);
      clock.set(tMs + 12);
      pipeline.push(tMs, null, 4 / 3);
    }

    const r = probe.report();
    // Seconds 0, 1 and 2 are closed by the first frames of seconds 1, 2 and 3.
    expect(r.eventLatency.n).toBe(3);
    // Closed while processing the next second's first frame (t + 12), timed
    // from the arrival of the frame before it (t − interval + 5): the one
    // frame interval of waiting is counted, as §11 intends.
    expect(r.eventLatency.p50).toBeCloseTo(interval + 7, 6);
    expect(r.eventLatency.max).toBeCloseTo(interval + 7, 6);
    expect(r.frameLatency.p50).toBe(7);
  });
});
