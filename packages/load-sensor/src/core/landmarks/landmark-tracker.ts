import { FrameGate } from '../camera/frame-gate.js';
import type { CameraFrame } from '../camera/types.js';
import { RateMeter, RollingSamples } from '../util/rolling-stats.js';
import type { FaceResult, LandmarkProvider } from './types.js';

/** One processed frame. `face` is null when no face was found in it. */
export interface LandmarkSample {
  /** Frame timestamp (ms, media clock) the landmarks belong to. */
  readonly tMs: number;
  readonly face: FaceResult | null;
  /** Wall time spent in `provider.estimate()` for this frame, in ms. */
  readonly inferenceMs: number;
}

export interface LandmarkTrackerStats {
  /** Effective inference rate over the last second of frame time. */
  readonly fps: number;
  readonly targetFps: number;
  /** Inference time percentiles over the last `STATS_WINDOW` frames (ms); NaN before the first. */
  readonly inferenceP50: number;
  readonly inferenceP95: number;
  readonly processed: number;
  /** Frames skipped because the previous inference had not returned (never queued). */
  readonly droppedBusy: number;
  /** Frames skipped by the rate cap. Expected: a 30 fps camera feeding 15 fps drops half. */
  readonly droppedRate: number;
  readonly errors: number;
}

/** A source of camera frames; `Camera` satisfies it. */
export interface FrameSource {
  onFrame(listener: (frame: CameraFrame) => void): () => void;
}

export interface LandmarkTrackerOptions {
  readonly targetFps?: number;
  /** Monotonic clock for measuring inference time only (default `performance.now`). */
  readonly now?: () => number;
}

/**
 * Connects a frame source to a landmark provider with skip-frame scheduling
 * (ARCHITECTURE.md §4): at most one inference in flight, at most `targetFps`
 * per second of frame time, never a queue.
 *
 * A failed inference is counted and reported to `onError` listeners, and the
 * next frame is tried as normal: one bad frame (e.g. a lost WebGL context
 * that the browser restores) must not end the session ("degrade, don't crash").
 */
export class LandmarkTracker {
  /** Frames kept for the p50/p95 inference time: about 8.5 s at 15 fps. */
  static readonly STATS_WINDOW = 128;

  readonly #source: FrameSource;
  readonly #provider: LandmarkProvider;
  readonly #gate: FrameGate;
  readonly #now: () => number;
  readonly #inferenceMs = new RollingSamples(LandmarkTracker.STATS_WINDOW);
  readonly #rate = new RateMeter(1000);
  readonly #sampleListeners = new Set<(sample: LandmarkSample) => void>();
  readonly #errorListeners = new Set<(error: unknown) => void>();

  #unsubscribe: (() => void) | null = null;
  #errors = 0;
  /** Bumped by stop(); results of inferences started before it are discarded. */
  #run = 0;

  constructor(
    source: FrameSource,
    provider: LandmarkProvider,
    options: LandmarkTrackerOptions = {},
  ) {
    this.#source = source;
    this.#provider = provider;
    this.#gate = new FrameGate(options.targetFps ?? FrameGate.DEFAULT_TARGET_FPS);
    this.#now = options.now ?? (() => performance.now());
  }

  get running(): boolean {
    return this.#unsubscribe !== null;
  }

  get stats(): LandmarkTrackerStats {
    const { accepted, droppedBusy, droppedRate } = this.#gate.counts;
    return {
      fps: this.#rate.rate,
      targetFps: this.#gate.targetFps,
      inferenceP50: this.#inferenceMs.percentile(50),
      inferenceP95: this.#inferenceMs.percentile(95),
      processed: accepted,
      droppedBusy,
      droppedRate,
      errors: this.#errors,
    };
  }

  onSample(listener: (sample: LandmarkSample) => void): () => void {
    this.#sampleListeners.add(listener);
    return () => this.#sampleListeners.delete(listener);
  }

  onError(listener: (error: unknown) => void): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  /** Starts consuming frames. The provider must already be initialised. */
  start(): void {
    if (this.#unsubscribe) return;
    this.#gate.reset();
    this.#rate.clear();
    this.#inferenceMs.clear();
    this.#errors = 0;
    this.#unsubscribe = this.#source.onFrame(this.#onFrame);
  }

  /** Stops consuming frames; a result still in flight is discarded. */
  stop(): void {
    this.#run += 1;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  readonly #onFrame = (frame: CameraFrame): void => {
    if (!this.#gate.tryAcquire(frame.tMs)) return;
    const run = this.#run;
    const started = this.#now();
    this.#provider
      .estimate(frame.video, frame.tMs)
      .then(
        (face) => {
          if (run !== this.#run) return;
          const inferenceMs = this.#now() - started;
          this.#inferenceMs.push(inferenceMs);
          this.#rate.mark(frame.tMs);
          const sample: LandmarkSample = { tMs: frame.tMs, face, inferenceMs };
          for (const listener of this.#sampleListeners) listener(sample);
        },
        (error: unknown) => {
          if (run !== this.#run) return;
          this.#errors += 1;
          for (const listener of this.#errorListeners) listener(error);
        },
      )
      .finally(() => {
        this.#gate.release();
      });
  };
}
