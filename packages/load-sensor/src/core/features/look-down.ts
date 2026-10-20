import { FEATURE_CONFIG } from './config.js';

export interface LookDownOptions {
  readonly pitchDeg?: number;
  readonly irisDy?: number;
  readonly trustEarRatio?: number;
  readonly holdMs?: number;
}

/**
 * "Looking down" (keyboard, notes on the desk), timed on the frame clock.
 *
 * Looking down lowers the upper eyelid with the gaze, so the EAR falls towards
 * the blink threshold although the eyes are open. Without this state, typing
 * reads as eyes closed (PERCLOS, long closures, the asleep alarm) and as
 * looking away.
 *
 * Cue: head pitched down from neutral, or the iris lowered from neutral with
 * the head still. The iris landmarks drift while the lid is closing, so the
 * iris cue is only read on frames where the eye is clearly not shut
 * (EAR ≥ `trustEarRatio` of open); other frames keep the last decision, and
 * an iris-only change must hold for `holdMs`, longer than the closing phase
 * of a blink, so a blink cannot switch the state. Head pitch does not move
 * with the eyelids, so a head-down frame switches it on at once.
 */
export class LookDownTracker {
  readonly #pitchDeg: number;
  readonly #irisDy: number;
  readonly #trustEarRatio: number;
  readonly #holdMs: number;
  #down = false;
  #candidate = false;
  #changeSinceMs: number | null = null;

  constructor(options: LookDownOptions = {}) {
    const d = FEATURE_CONFIG.lookDown;
    this.#pitchDeg = options.pitchDeg ?? d.pitchDeg;
    this.#irisDy = options.irisDy ?? d.irisDy;
    this.#trustEarRatio = options.trustEarRatio ?? d.closeRatio;
    this.#holdMs = options.holdMs ?? d.holdMs;
  }

  get down(): boolean {
    return this.#down;
  }

  /**
   * @param pitchFromNeutral degrees, > 0 = head further down than neutral
   * @param irisDyFromNeutral eye widths, > 0 = iris lower than neutral
   * @param earRatio this frame's EAR / open-eye reference EAR
   */
  update(
    tMs: number,
    pitchFromNeutral: number,
    irisDyFromNeutral: number,
    earRatio: number,
  ): boolean {
    const headDown = pitchFromNeutral > this.#pitchDeg;
    if (headDown) this.#candidate = true;
    else if (earRatio >= this.#trustEarRatio) this.#candidate = irisDyFromNeutral > this.#irisDy;
    // else: eye nearly shut and head level; the iris is not trusted, keep the last candidate.

    if (this.#candidate === this.#down) {
      this.#changeSinceMs = null;
    } else if (headDown) {
      this.#down = true;
      this.#changeSinceMs = null;
    } else {
      this.#changeSinceMs ??= tMs;
      if (tMs - this.#changeSinceMs >= this.#holdMs) {
        this.#down = this.#candidate;
        this.#changeSinceMs = null;
      }
    }
    return this.#down;
  }

  reset(): void {
    this.#down = false;
    this.#candidate = false;
    this.#changeSinceMs = null;
  }
}
