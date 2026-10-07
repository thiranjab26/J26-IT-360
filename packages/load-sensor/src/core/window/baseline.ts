import { FEATURE_CONFIG } from '../features/config.js';
import { FEATURE_COUNT } from '../features/spec.js';

export interface BaselineStats {
  readonly mean: Float32Array;
  readonly std: Float32Array;
  /** Valid seconds the statistics were computed from. */
  readonly seconds: number;
}

export interface BaselineOptions {
  readonly seconds?: number;
  readonly minStd?: number;
  readonly zClip?: number;
}

/**
 * Per-learner baseline (ARCHITECTURE.md §5.4).
 *
 * Differences between people (resting blink rate, brow position, glasses) are
 * larger than the effect of cognitive load, so every feature is expressed as a
 * z-score against the learner's own first `seconds` valid seconds. Training
 * data is normalised by exactly this code, using each participant's rest
 * block, so the model sees identically scaled inputs in the study and live.
 */
export class BaselineCalibrator {
  readonly #target: number;
  readonly #minStd: number;
  readonly #zClip: number;
  #rows: Float32Array[] = [];
  #stats: BaselineStats | null = null;

  constructor(options: BaselineOptions = {}) {
    const d = FEATURE_CONFIG.baseline;
    this.#target = options.seconds ?? d.seconds;
    this.#minStd = options.minStd ?? d.minStd;
    this.#zClip = options.zClip ?? d.zClip;
  }

  get ready(): boolean {
    return this.#stats !== null;
  }

  /** 0..1 while calibrating, 1 when ready. */
  get progress(): number {
    return this.#stats ? 1 : this.#rows.length / this.#target;
  }

  get collectedSeconds(): number {
    return this.#stats ? this.#stats.seconds : this.#rows.length;
  }

  get targetSeconds(): number {
    return this.#target;
  }

  get stats(): BaselineStats | null {
    return this.#stats;
  }

  /**
   * Adds one valid second while calibrating. Returns true on the second that
   * completes the baseline. Ignored once ready.
   */
  add(raw: Float32Array): boolean {
    if (this.#stats) return false;
    this.#rows.push(Float32Array.from(raw));
    if (this.#rows.length < this.#target) return false;
    this.#stats = computeStats(this.#rows);
    this.#rows = [];
    return true;
  }

  /**
   * z = (x − mean) / std, clipped to ±zClip. A feature that did not vary during
   * calibration (std below minStd) gets z = 0 instead of a division blow-up.
   */
  zScore(raw: Float32Array): Float32Array {
    const stats = this.#stats;
    if (!stats) throw new Error('BaselineCalibrator.zScore() before the baseline is ready');
    const z = new Float32Array(FEATURE_COUNT);
    for (let i = 0; i < FEATURE_COUNT; i += 1) {
      const sd = stats.std[i] ?? 0;
      const value = sd < this.#minStd ? 0 : ((raw[i] ?? 0) - (stats.mean[i] ?? 0)) / sd;
      z[i] = Math.max(-this.#zClip, Math.min(this.#zClip, value));
    }
    return z;
  }

  /** Starts a new calibration (new session, or after a long absence). */
  reset(): void {
    this.#rows = [];
    this.#stats = null;
  }
}

function computeStats(rows: readonly Float32Array[]): BaselineStats {
  const n = rows.length;
  const mean = new Float32Array(FEATURE_COUNT);
  const std = new Float32Array(FEATURE_COUNT);
  for (let i = 0; i < FEATURE_COUNT; i += 1) {
    let sum = 0;
    for (const row of rows) sum += row[i] ?? 0;
    const m = sum / n;
    let sq = 0;
    for (const row of rows) sq += ((row[i] ?? 0) - m) ** 2;
    mean[i] = m;
    // Population std, matching NumPy's default so the Python analysis agrees.
    std[i] = Math.sqrt(sq / n);
  }
  return { mean, std, seconds: n };
}
