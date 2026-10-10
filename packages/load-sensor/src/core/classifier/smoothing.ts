import type { Level } from '../events/types.js';
import { LOAD_CLASSES, type LoadProbabilities } from './types.js';

/**
 * Smoothing of the published load state (ARCHITECTURE.md §7). Both values are
 * starting points marked **(tune)**: adjust from pilot data, not by guessing.
 */
export const SMOOTHING_CONFIG = Object.freeze({
  /**
   * EMA weight of the newest inference (one per second). 0.3 gives a time
   * constant of about 3 s: a single odd window moves the average by under a
   * third, a real change dominates after ~5 s.
   */
  alpha: 0.3,
  /**
   * A different class must lead this many consecutive inferences before the
   * published state switches. Stops C01/C03/C04 reacting to a class that wins
   * once by a hair.
   */
  confirm: 2,
});

/** Exponential moving average over probability vectors. */
export class EmaSmoother {
  readonly #alpha: number;
  #state: Float64Array | null = null;

  constructor(alpha: number = SMOOTHING_CONFIG.alpha) {
    if (!(alpha > 0 && alpha <= 1))
      throw new RangeError(`alpha must be in (0, 1], got ${String(alpha)}`);
    this.#alpha = alpha;
  }

  /** Adds one vector; returns the smoothed vector (a copy). */
  update(values: ArrayLike<number>): Float64Array {
    const prev = this.#state;
    if (prev?.length !== values.length) {
      this.#state = Float64Array.from(values);
    } else {
      for (let i = 0; i < prev.length; i += 1) {
        prev[i] = (1 - this.#alpha) * (prev[i] ?? 0) + this.#alpha * (values[i] ?? 0);
      }
    }
    return Float64Array.from(this.#state ?? values);
  }

  reset(): void {
    this.#state = null;
  }
}

/**
 * Publishes a label only once it has been the candidate `confirm` times in a
 * row. The first label is published immediately: with nothing published yet
 * there is nothing to protect from flapping.
 */
export class Hysteresis<T> {
  readonly #confirm: number;
  #published: T | null = null;
  #pending: T | null = null;
  #count = 0;

  constructor(confirm: number = SMOOTHING_CONFIG.confirm) {
    if (!Number.isInteger(confirm) || confirm < 1) {
      throw new RangeError(`confirm must be a positive integer, got ${String(confirm)}`);
    }
    this.#confirm = confirm;
  }

  get value(): T | null {
    return this.#published;
  }

  update(candidate: T): T {
    if (this.#published === null || candidate === this.#published) {
      this.#published = candidate;
      this.#pending = null;
      this.#count = 0;
      return candidate;
    }
    if (candidate === this.#pending) this.#count += 1;
    else {
      this.#pending = candidate;
      this.#count = 1;
    }
    if (this.#count >= this.#confirm) {
      this.#published = candidate;
      this.#pending = null;
      this.#count = 0;
    }
    return this.#published;
  }

  reset(): void {
    this.#published = null;
    this.#pending = null;
    this.#count = 0;
  }
}

export interface SmoothedLoad {
  readonly level: Level;
  /**
   * Smoothed probability of the published level. Equals the maximum smoothed
   * probability (§7) except while hysteresis holds the old level against a
   * new leader; then it is the old level's own probability, so a consumer is
   * never told "High, 0.6" when 0.6 belongs to Medium.
   */
  readonly confidence: number;
  readonly probabilities: Float64Array;
}

/** EMA on class probabilities, then hysteresis on the arg-max (§7). */
export class LoadSmoother {
  readonly #ema: EmaSmoother;
  readonly #gate: Hysteresis<Level>;

  constructor(alpha: number = SMOOTHING_CONFIG.alpha, confirm: number = SMOOTHING_CONFIG.confirm) {
    this.#ema = new EmaSmoother(alpha);
    this.#gate = new Hysteresis<Level>(confirm);
  }

  update(probabilities: LoadProbabilities): SmoothedLoad {
    const p = this.#ema.update(probabilities);
    let best = 0;
    for (let i = 1; i < p.length; i += 1) if ((p[i] ?? 0) > (p[best] ?? 0)) best = i;
    const level = this.#gate.update(LOAD_CLASSES[best] ?? 'Medium');
    const confidence = p[LOAD_CLASSES.indexOf(level)] ?? 0;
    return { level, confidence: Math.min(1, Math.max(0, confidence)), probabilities: p };
  }

  reset(): void {
    this.#ema.reset();
    this.#gate.reset();
  }
}
