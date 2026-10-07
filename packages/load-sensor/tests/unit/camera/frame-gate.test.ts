import { describe, expect, it } from 'vitest';
import { FrameGate } from '../../../src/core/camera/index.js';

/** Feeds frames at `cameraFps` for `seconds`, finishing each inference before the next frame. */
function acceptedRate(targetFps: number, cameraFps: number, seconds = 10, jitterMs = 0): number {
  const gate = new FrameGate(targetFps);
  let accepted = 0;
  const frames = Math.round(seconds * cameraFps);
  for (let i = 0; i < frames; i += 1) {
    // Deterministic jitter: alternate early and late.
    const t = (i * 1000) / cameraFps + (i % 2 === 0 ? -jitterMs : jitterMs);
    if (gate.tryAcquire(t)) {
      accepted += 1;
      gate.release();
    }
  }
  return accepted / seconds;
}

describe('FrameGate rate cap (target 15 fps)', () => {
  it.each([
    [30, 15],
    [60, 15],
    [15, 15],
    [10, 10],
  ])('camera at %i fps → about %i fps processed', (cameraFps, expected) => {
    expect(acceptedRate(15, cameraFps)).toBeCloseTo(expected, 0);
  });

  it('still gives 15 fps from a 30 fps camera with ±4 ms timestamp jitter', () => {
    expect(acceptedRate(15, 30, 10, 4)).toBeCloseTo(15, 0);
  });

  it('can be retargeted (adaptive rate)', () => {
    const gate = new FrameGate();
    gate.targetFps = 10;
    expect(gate.targetFps).toBe(10);
  });

  it('rejects a non-positive target', () => {
    expect(() => new FrameGate(0)).toThrow(RangeError);
    expect(() => new FrameGate(Number.NaN)).toThrow(RangeError);
  });
});

describe('FrameGate never queues', () => {
  it('drops every frame while an inference is in flight', () => {
    const gate = new FrameGate(15);
    expect(gate.tryAcquire(0)).toBe(true);
    // Slow inference: frames keep arriving for 300 ms.
    for (let t = 33; t <= 300; t += 33) expect(gate.tryAcquire(t)).toBe(false);
    gate.release();
    expect(gate.tryAcquire(333)).toBe(true);
    expect(gate.counts).toEqual({ accepted: 2, droppedBusy: 9, droppedRate: 0 });
  });

  it('reset() forgets timing but keeps an in-flight inference owning the gate', () => {
    const gate = new FrameGate(15);
    expect(gate.tryAcquire(0)).toBe(true);
    gate.reset();
    expect(gate.busy).toBe(true);
    expect(gate.tryAcquire(10)).toBe(false);
    gate.release();
    expect(gate.tryAcquire(10)).toBe(true);
  });
});
