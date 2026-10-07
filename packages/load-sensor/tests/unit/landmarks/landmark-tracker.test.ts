import { describe, expect, it } from 'vitest';
import type { CameraFrame } from '../../../src/core/camera/index.js';
import {
  LANDMARK_COUNT,
  LandmarkTracker,
  type FaceResult,
  type FrameSource,
  type LandmarkProvider,
  type LandmarkSample,
} from '../../../src/core/landmarks/index.js';
import { flush } from '../helpers/fake-media.js';

class FakeSource implements FrameSource {
  #listeners = new Set<(f: CameraFrame) => void>();

  onFrame(listener: (f: CameraFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  emit(tMs: number): void {
    const frame = { video: {} as HTMLVideoElement, tMs, width: 640, height: 480 };
    for (const l of this.#listeners) l(frame);
  }
}

/** Provider whose estimates are resolved by hand, to control overlap. */
class ManualProvider implements LandmarkProvider {
  readonly name = 'manual';
  readonly backend = 'test';
  calls: number[] = [];
  #pending: { resolve: (r: FaceResult | null) => void; reject: (e: unknown) => void }[] = [];

  init(): Promise<void> {
    return Promise.resolve();
  }

  estimate(_frame: HTMLVideoElement, tMs: number): Promise<FaceResult | null> {
    this.calls.push(tMs);
    return new Promise((resolve, reject) => this.#pending.push({ resolve, reject }));
  }

  dispose(): void {
    // Nothing to release in the double.
  }

  get inFlight(): number {
    return this.#pending.length;
  }

  resolveNext(face: FaceResult | null = null): void {
    this.#pending.shift()?.resolve(face);
  }

  rejectNext(error: unknown): void {
    this.#pending.shift()?.reject(error);
  }
}

const FACE: FaceResult = { landmarks: new Float32Array(LANDMARK_COUNT * 3), score: null };

function setup() {
  const source = new FakeSource();
  const provider = new ManualProvider();
  let clock = 0;
  const tracker = new LandmarkTracker(source, provider, {
    targetFps: 15,
    now: () => clock,
  });
  const samples: LandmarkSample[] = [];
  tracker.onSample((s) => samples.push(s));
  return {
    source,
    provider,
    tracker,
    samples,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('LandmarkTracker skip-frame scheduling (ARCHITECTURE.md §4)', () => {
  it('never has more than one inference in flight and never queues frames', async () => {
    const { source, provider, tracker } = setup();
    tracker.start();
    for (let t = 0; t < 500; t += 33) source.emit(t);
    expect(provider.calls).toEqual([0]);
    expect(provider.inFlight).toBe(1);

    provider.resolveNext();
    await flush();
    source.emit(533);
    // The frames that arrived while busy were dropped, not replayed.
    expect(provider.calls).toEqual([0, 533]);
    expect(tracker.stats.droppedBusy).toBe(15);
  });

  it('emits one sample per processed frame with its frame timestamp and inference time', async () => {
    const { source, provider, tracker, samples, advance } = setup();
    tracker.start();
    source.emit(1000);
    advance(42);
    provider.resolveNext(FACE);
    await flush();
    expect(samples).toEqual([{ tMs: 1000, face: FACE, inferenceMs: 42 }]);
    expect(tracker.stats.inferenceP50).toBe(42);
  });

  it('processes about 15 fps from a 30 fps camera when inference is fast', async () => {
    const { source, provider, tracker } = setup();
    tracker.start();
    for (let i = 0; i < 60; i += 1) {
      source.emit((i * 1000) / 30);
      provider.resolveNext();
      await flush();
    }
    expect(provider.calls.length).toBe(30);
    expect(tracker.stats.fps).toBeCloseTo(15, 0);
  });
});

describe('LandmarkTracker degrades instead of crashing (FR8)', () => {
  it('counts a failed inference, reports it and keeps processing the next frame', async () => {
    const { source, provider, tracker, samples } = setup();
    const errors: unknown[] = [];
    tracker.onError((e) => errors.push(e));
    tracker.start();

    source.emit(0);
    provider.rejectNext(new Error('WebGL context lost'));
    await flush();
    source.emit(100);
    provider.resolveNext(FACE);
    await flush();

    expect(errors).toHaveLength(1);
    expect(tracker.stats.errors).toBe(1);
    expect(samples.map((s) => s.tMs)).toEqual([100]);
  });

  it('reports no face as a sample with face: null', async () => {
    const { source, provider, tracker, samples } = setup();
    tracker.start();
    source.emit(0);
    provider.resolveNext(null);
    await flush();
    expect(samples[0]?.face).toBeNull();
  });
});

describe('LandmarkTracker stop', () => {
  it('unsubscribes from frames and discards a result still in flight', async () => {
    const { source, provider, tracker, samples } = setup();
    tracker.start();
    source.emit(0);
    tracker.stop();
    expect(source.listenerCount).toBe(0);
    provider.resolveNext(FACE);
    await flush();
    expect(samples).toEqual([]);
    expect(tracker.running).toBe(false);
  });

  it('does not overlap an old in-flight inference with a new one after restart', async () => {
    const { source, provider, tracker } = setup();
    tracker.start();
    source.emit(0);
    tracker.stop();
    tracker.start();
    source.emit(1000);
    expect(provider.calls).toEqual([0]);
    provider.resolveNext();
    await flush();
    source.emit(1100);
    expect(provider.calls).toEqual([0, 1100]);
  });
});
