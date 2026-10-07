import { describe, expect, it } from 'vitest';
import { startFrameLoop, type AnimationFrameApi } from '../../../src/core/camera/index.js';
import { FakeVideo } from '../helpers/fake-media.js';

class FakeRaf implements AnimationFrameApi {
  #callbacks = new Map<number, FrameRequestCallback>();
  #next = 1;

  requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const handle = this.#next++;
    this.#callbacks.set(handle, cb);
    return handle;
  };

  cancelAnimationFrame = (handle: number): void => {
    this.#callbacks.delete(handle);
  };

  get pending(): number {
    return this.#callbacks.size;
  }

  tick(): void {
    const cbs = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const cb of cbs) cb(0);
  }
}

describe('frame loop on requestVideoFrameCallback', () => {
  it('passes each frame media time in ms and keeps only increasing timestamps', () => {
    const video = new FakeVideo();
    const raf = new FakeRaf();
    const seen: number[] = [];
    const loop = startFrameLoop(video, (t) => seen.push(t), raf);

    expect(loop.clock).toBe('video-frame-callback');
    for (const t of [0.5, 0.533, 0.533, 0.4, 0.6]) video.presentFrame(t);

    expect(seen).toEqual([500, 533, 600]);
    expect(raf.pending).toBe(0);
  });

  it('stop() cancels the pending callback and ignores late ones', () => {
    const video = new FakeVideo();
    const seen: number[] = [];
    const loop = startFrameLoop(video, (t) => seen.push(t), new FakeRaf());
    loop.stop();
    expect(video.pendingCallbacks).toBe(0);
    video.presentFrame(1);
    expect(seen).toEqual([]);
  });
});

describe('frame loop fallback on requestAnimationFrame (browsers without rVFC)', () => {
  /** Only what a video without requestVideoFrameCallback offers the loop. */
  function videoWithoutRvfc(): { currentTime: number; readyState: number } {
    return { currentTime: 0, readyState: 4 };
  }

  it('uses currentTime and skips refreshes where the frame did not change', () => {
    const video = videoWithoutRvfc();
    const raf = new FakeRaf();
    const seen: number[] = [];
    const loop = startFrameLoop(video, (t) => seen.push(t), raf);
    expect(loop.clock).toBe('animation-frame');

    for (const t of [0.1, 0.1, 0.133, 0.133, 0.166]) {
      video.currentTime = t;
      raf.tick();
    }
    expect(seen).toEqual([100, 133, 166]);
  });

  it('waits until the video has a decoded frame', () => {
    const video = videoWithoutRvfc();
    const raf = new FakeRaf();
    const seen: number[] = [];
    startFrameLoop(video, (t) => seen.push(t), raf);
    video.readyState = 1;
    video.currentTime = 0.1;
    raf.tick();
    expect(seen).toEqual([]);
    video.readyState = 2;
    raf.tick();
    expect(seen).toEqual([100]);
  });

  it('stop() cancels the animation frame', () => {
    const raf = new FakeRaf();
    const loop = startFrameLoop(videoWithoutRvfc(), () => undefined, raf);
    loop.stop();
    expect(raf.pending).toBe(0);
  });
});
