import type { FrameClock } from './types.js';

/** The video element features this loop needs; narrowed so tests can pass a double. */
export type LoopVideo = Pick<HTMLVideoElement, 'currentTime' | 'readyState'> &
  Partial<Pick<HTMLVideoElement, 'requestVideoFrameCallback' | 'cancelVideoFrameCallback'>>;

export interface AnimationFrameApi {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

export interface FrameLoop {
  readonly clock: FrameClock;
  stop(): void;
}

/** HTMLMediaElement.HAVE_CURRENT_DATA: a decoded frame is available. */
const HAVE_CURRENT_DATA = 2;

/**
 * Calls `onFrame(tMs)` once per new camera frame, with the frame's media
 * timestamp in milliseconds.
 *
 * Prefers `requestVideoFrameCallback`: it fires exactly once per presented
 * frame and carries the frame's `mediaTime`. Without it (older Firefox), falls
 * back to `requestAnimationFrame` and uses `video.currentTime`, skipping
 * display refreshes where the frame did not change (a 60 Hz display shows each
 * 30 fps frame twice).
 *
 * Timestamps passed on are strictly increasing; a repeated or backwards
 * timestamp (seen on some drivers when the stream restarts) is dropped rather
 * than handed to feature code that divides by elapsed time.
 */
export function startFrameLoop(
  video: LoopVideo,
  onFrame: (tMs: number) => void,
  raf: AnimationFrameApi,
): FrameLoop {
  let lastTMs = Number.NEGATIVE_INFINITY;
  let stopped = false;

  const deliver = (tMs: number): void => {
    if (!Number.isFinite(tMs) || tMs <= lastTMs) return;
    lastTMs = tMs;
    onFrame(tMs);
  };

  const { requestVideoFrameCallback, cancelVideoFrameCallback } = video;
  if (typeof requestVideoFrameCallback === 'function') {
    let handle = 0;
    const tick: VideoFrameRequestCallback = (_now, metadata) => {
      if (stopped) return;
      handle = requestVideoFrameCallback.call(video, tick);
      deliver(metadata.mediaTime * 1000);
    };
    handle = requestVideoFrameCallback.call(video, tick);
    return {
      clock: 'video-frame-callback',
      stop() {
        stopped = true;
        cancelVideoFrameCallback?.call(video, handle);
      },
    };
  }

  let handle = 0;
  const tick: FrameRequestCallback = () => {
    if (stopped) return;
    handle = raf.requestAnimationFrame(tick);
    if (video.readyState >= HAVE_CURRENT_DATA) deliver(video.currentTime * 1000);
  };
  handle = raf.requestAnimationFrame(tick);
  return {
    clock: 'animation-frame',
    stop() {
      stopped = true;
      raf.cancelAnimationFrame(handle);
    },
  };
}
