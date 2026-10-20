import { FEATURE_CONFIG } from './config.js';

/*
 * Drowsiness events beyond blinks (ARCHITECTURE.md §8a): yawns and head nods.
 * Eye-closure based signals (long closures, eyes-closed fraction ≈ PERCLOS)
 * come from the BlinkDetector. All timing uses frame timestamps.
 */

/**
 * Yawn: the inner-lip gap stays above a large threshold for at least `minMs`.
 * One event is reported when the mouth closes again, with its duration.
 */
export class YawnDetector {
  readonly #threshold: number;
  readonly #minMs: number;
  #openSinceMs: number | null = null;

  constructor(
    threshold: number = FEATURE_CONFIG.yawn.openThreshold,
    minMs: number = FEATURE_CONFIG.yawn.minMs,
  ) {
    this.#threshold = threshold;
    this.#minMs = minMs;
  }

  /** Returns the yawn duration (ms) on the frame the mouth closes after a yawn, else null. */
  update(tMs: number, mouthOpen: number): number | null {
    if (mouthOpen > this.#threshold) {
      this.#openSinceMs ??= tMs;
      return null;
    }
    if (this.#openSinceMs === null) return null;
    const duration = tMs - this.#openSinceMs;
    this.#openSinceMs = null;
    return duration >= this.#minMs ? duration : null;
  }

  reset(): void {
    this.#openSinceMs = null;
  }
}

/**
 * Head nod: pitch drops more than `dropDeg` below the neutral pitch (head
 * falling forward) and recovers to within `recoverDeg` inside `maxMs`. That
 * drop-and-catch is the typical movement of someone dozing off at a desk;
 * looking down at a keyboard for longer than `maxMs` is not counted.
 *
 * The eyes must also have been closed at some point during the drop: a quick
 * glance down at the keys and back up has the same head movement with the
 * eyes open, and while typing that happens every few seconds.
 */
export class NodDetector {
  readonly #dropDeg: number;
  readonly #recoverDeg: number;
  readonly #maxMs: number;
  #droppedAtMs: number | null = null;
  #closedSeen = false;

  constructor(
    dropDeg: number = FEATURE_CONFIG.nod.dropDeg,
    recoverDeg: number = FEATURE_CONFIG.nod.recoverDeg,
    maxMs: number = FEATURE_CONFIG.nod.maxMs,
  ) {
    this.#dropDeg = dropDeg;
    this.#recoverDeg = recoverDeg;
    this.#maxMs = maxMs;
  }

  /**
   * `pitchFromNeutral` > 0 means the head is tilted further down than usual;
   * `eyesClosed` is this frame's blink-detector state. Returns true on a
   * completed nod.
   */
  update(tMs: number, pitchFromNeutral: number, eyesClosed: boolean): boolean {
    if (this.#droppedAtMs === null) {
      if (pitchFromNeutral > this.#dropDeg) {
        this.#droppedAtMs = tMs;
        this.#closedSeen = eyesClosed;
      }
      return false;
    }
    if (eyesClosed) this.#closedSeen = true;
    if (tMs - this.#droppedAtMs > this.#maxMs) {
      // Held down too long: looking down on purpose, not a nod. Wait for recovery.
      if (pitchFromNeutral < this.#recoverDeg) this.#droppedAtMs = null;
      return false;
    }
    if (pitchFromNeutral < this.#recoverDeg) {
      this.#droppedAtMs = null;
      return this.#closedSeen;
    }
    return false;
  }

  reset(): void {
    this.#droppedAtMs = null;
    this.#closedSeen = false;
  }
}
