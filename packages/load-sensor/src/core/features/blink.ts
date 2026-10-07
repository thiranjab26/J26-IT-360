import { FEATURE_CONFIG } from './config.js';

export type BlinkPhase = 'open' | 'closed';

export interface EyeClosure {
  /** Estimated closure start and end on the frame clock (ms). */
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  /** `blink` within the duration bounds; `long` = eye closure longer than a blink. */
  readonly kind: 'blink' | 'long';
}

export interface BlinkUpdate {
  readonly phase: BlinkPhase;
  /** True when this frame's EAR is below the closing threshold. */
  readonly eyesClosed: boolean;
  /** Set on the frame where a closure ended and was classified. */
  readonly closure: EyeClosure | null;
}

export interface BlinkOptions {
  readonly closeRatio?: number;
  readonly reopenRatio?: number;
  readonly minMs?: number;
  readonly maxMs?: number;
}

/**
 * Blink detector (ARCHITECTURE.md §5.2): a two-state machine on EAR with
 * hysteresis, timed from frame timestamps.
 *
 * Thresholds are relative to an open-eye reference EAR supplied per frame (the
 * learner's own baseline), so the same code works for narrow eyes and glasses.
 *
 * Frame-rate independence: a closure's start and end are taken as the midpoint
 * between the last frame on one side of the threshold and the first frame on
 * the other. At 15 fps that halves the timing error compared with using the
 * frame times themselves, and the estimate is unbiased at any rate.
 *
 * EAR is deliberately not smoothed first: at 15 fps a blink spans only 2–5
 * frames and any moving average would flatten it below the threshold.
 */
export class BlinkDetector {
  readonly #closeRatio: number;
  readonly #reopenRatio: number;
  readonly #minMs: number;
  readonly #maxMs: number;

  #phase: BlinkPhase = 'open';
  #lastFrameMs: number | null = null;
  #closeStartMs = 0;

  constructor(options: BlinkOptions = {}) {
    const d = FEATURE_CONFIG.blink;
    this.#closeRatio = options.closeRatio ?? d.closeRatio;
    this.#reopenRatio = options.reopenRatio ?? d.reopenRatio;
    this.#minMs = options.minMs ?? d.minMs;
    this.#maxMs = options.maxMs ?? d.maxMs;
    if (!(this.#closeRatio < this.#reopenRatio)) {
      throw new RangeError('closeRatio must be below reopenRatio (hysteresis)');
    }
  }

  get phase(): BlinkPhase {
    return this.#phase;
  }

  /**
   * Feeds one frame. `openEar` is the open-eye reference; while it is unknown
   * (null) no closure is detected and the state stays open.
   */
  update(tMs: number, ear: number, openEar: number | null): BlinkUpdate {
    const previousMs = this.#lastFrameMs ?? tMs;
    this.#lastFrameMs = tMs;
    if (openEar === null || !(openEar > 0) || !Number.isFinite(ear)) {
      this.#phase = 'open';
      return { phase: 'open', eyesClosed: false, closure: null };
    }

    const closeAt = openEar * this.#closeRatio;
    const reopenAt = openEar * this.#reopenRatio;
    const eyesClosed = ear < closeAt;
    let closure: EyeClosure | null = null;

    if (this.#phase === 'open' && eyesClosed) {
      this.#phase = 'closed';
      this.#closeStartMs = (previousMs + tMs) / 2;
    } else if (this.#phase === 'closed' && ear > reopenAt) {
      this.#phase = 'open';
      const endMs = (previousMs + tMs) / 2;
      const durationMs = endMs - this.#closeStartMs;
      if (durationMs >= this.#minMs) {
        closure = {
          startMs: this.#closeStartMs,
          endMs,
          durationMs,
          kind: durationMs <= this.#maxMs ? 'blink' : 'long',
        };
      }
    }
    return { phase: this.#phase, eyesClosed, closure };
  }

  /**
   * Call when the face is lost: a closure in progress is abandoned rather than
   * counted, because its end was not observed.
   */
  reset(): void {
    this.#phase = 'open';
    this.#lastFrameMs = null;
  }
}
