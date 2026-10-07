import { FEATURE_CONFIG } from '../features/config.js';
import { FEATURE_COUNT } from '../features/spec.js';

export interface WindowRow {
  readonly second: number;
  /** Baseline-normalised features. */
  readonly z: Float32Array;
  readonly valid: boolean;
}

export interface ModelInput {
  /** Row-major [T × F]: T seconds, oldest first. Invalid rows are all zeros. */
  readonly data: Float32Array;
  /** 1 for valid seconds, 0 for masked ones. */
  readonly mask: Uint8Array;
  readonly seconds: number;
  readonly features: number;
}

/**
 * The classifier's sliding window: the last T normalised seconds (§5.5).
 *
 * Fixed-size ring buffer, so memory is constant over a long session (NFR6).
 */
export class FeatureWindow {
  readonly #rows: (WindowRow | undefined)[];
  readonly #maxInvalid: number;
  #next = 0;
  #size = 0;

  constructor(
    readonly seconds: number = FEATURE_CONFIG.window.seconds,
    maxInvalidFraction: number = FEATURE_CONFIG.window.maxInvalidFraction,
  ) {
    if (!Number.isInteger(seconds) || seconds <= 0) {
      throw new RangeError(`seconds must be a positive integer, got ${String(seconds)}`);
    }
    this.#rows = new Array<WindowRow | undefined>(seconds);
    this.#maxInvalid = maxInvalidFraction;
  }

  get size(): number {
    return this.#size;
  }

  /** True once T seconds have been collected. */
  get full(): boolean {
    return this.#size === this.seconds;
  }

  get invalidFraction(): number {
    if (this.#size === 0) return 1;
    let invalid = 0;
    for (const row of this.#ordered()) if (!row.valid) invalid += 1;
    return invalid / this.#size;
  }

  /**
   * Whether the window may be classified: full, and no more than
   * `maxInvalidFraction` of its seconds invalid. Otherwise the sensor reports
   * `status: "no_face"` with `load_state: null` instead of guessing.
   */
  get classifiable(): boolean {
    return this.full && this.invalidFraction <= this.#maxInvalid;
  }

  push(row: WindowRow): void {
    this.#rows[this.#next] = row;
    this.#next = (this.#next + 1) % this.seconds;
    this.#size = Math.min(this.#size + 1, this.seconds);
  }

  rows(): WindowRow[] {
    return this.#ordered();
  }

  /**
   * Model input. Invalid seconds are masked to zeros, which after z-scoring is
   * the learner's baseline mean: a neutral value, never an interpolation of
   * data that was not observed.
   */
  toModelInput(): ModelInput {
    const ordered = this.#ordered();
    const data = new Float32Array(this.seconds * FEATURE_COUNT);
    const mask = new Uint8Array(this.seconds);
    const offset = this.seconds - ordered.length;
    ordered.forEach((row, i) => {
      if (!row.valid) return;
      mask[offset + i] = 1;
      data.set(row.z, (offset + i) * FEATURE_COUNT);
    });
    return { data, mask, seconds: this.seconds, features: FEATURE_COUNT };
  }

  clear(): void {
    this.#rows.fill(undefined);
    this.#next = 0;
    this.#size = 0;
  }

  #ordered(): WindowRow[] {
    const out: WindowRow[] = [];
    const start = this.#size === this.seconds ? this.#next : 0;
    for (let i = 0; i < this.#size; i += 1) {
      const row = this.#rows[(start + i) % this.seconds];
      if (row) out.push(row);
    }
    return out;
  }
}
