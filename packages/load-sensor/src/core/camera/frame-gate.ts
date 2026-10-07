/**
 * Decides which camera frames go to landmark inference (ARCHITECTURE.md §4).
 *
 * Two rules:
 *  1. Never queue. If the previous inference has not returned, the frame is
 *     dropped. A queue would grow without bound on a slow laptop and every
 *     result would describe an ever older frame.
 *  2. Rate cap. At most `targetFps` frames per second of *frame time* go
 *     through. 15 fps is the default because blinks last 100–400 ms, so 15 fps
 *     (67 ms spacing) still samples every blink at least once, at half the
 *     compute of 30 fps.
 *
 * Pure: time comes from frame timestamps passed in, never from a clock.
 */
export class FrameGate {
  /** Default inference rate (ARCHITECTURE.md §2, **tune**). */
  static readonly DEFAULT_TARGET_FPS = 15;

  /**
   * Fraction of the interval a frame may arrive early and still be accepted.
   * Camera timestamps jitter by a few ms; without slack a 30 fps camera
   * (33.3 ms) feeding a 15 fps gate (66.7 ms) would sometimes see 66.5 ms,
   * reject it and wait a whole extra frame, giving 10 fps instead of 15.
   * 20 % of 66.7 ms is 13 ms: larger than jitter, smaller than a 30 fps frame.
   */
  static readonly EARLY_TOLERANCE = 0.2;

  #intervalMs: number;
  #nextDueMs = Number.NEGATIVE_INFINITY;
  #busy = false;
  #accepted = 0;
  #droppedBusy = 0;
  #droppedRate = 0;

  constructor(targetFps: number = FrameGate.DEFAULT_TARGET_FPS) {
    this.#intervalMs = FrameGate.#intervalFor(targetFps);
  }

  get targetFps(): number {
    return 1000 / this.#intervalMs;
  }

  /** Changes the rate cap (adaptive rate, ARCHITECTURE.md §4). Takes effect from the next frame. */
  set targetFps(fps: number) {
    this.#intervalMs = FrameGate.#intervalFor(fps);
  }

  get busy(): boolean {
    return this.#busy;
  }

  get counts(): { accepted: number; droppedBusy: number; droppedRate: number } {
    return {
      accepted: this.#accepted,
      droppedBusy: this.#droppedBusy,
      droppedRate: this.#droppedRate,
    };
  }

  /**
   * Returns true if the frame at `tMs` should be processed. On true the gate
   * becomes busy until `release()` is called.
   */
  tryAcquire(tMs: number): boolean {
    if (this.#busy) {
      this.#droppedBusy += 1;
      return false;
    }
    if (tMs < this.#nextDueMs - this.#intervalMs * FrameGate.EARLY_TOLERANCE) {
      this.#droppedRate += 1;
      return false;
    }
    this.#busy = true;
    this.#accepted += 1;
    this.#nextDueMs = tMs + this.#intervalMs;
    return true;
  }

  /** Marks the current inference as finished (successfully or not). */
  release(): void {
    this.#busy = false;
  }

  /**
   * Forgets timing and counts, e.g. after a pause, so the first frame after
   * resume is taken. Deliberately leaves `busy` alone: an inference started
   * before the reset still owns the gate until it calls `release()`, so two
   * inferences can never overlap.
   */
  reset(): void {
    this.#nextDueMs = Number.NEGATIVE_INFINITY;
    this.#accepted = 0;
    this.#droppedBusy = 0;
    this.#droppedRate = 0;
  }

  static #intervalFor(fps: number): number {
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new RangeError(`targetFps must be a positive number, got ${String(fps)}`);
    }
    return 1000 / fps;
  }
}
