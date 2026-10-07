import { FEATURE_CONFIG } from '../features/config.js';
import type { FrameSignals } from '../features/frame-signals.js';

/**
 * Median of the samples from the last `windowMs` of frame time. Memory is
 * capped at `maxSamples` so a 60-minute session uses the same memory as a
 * 1-minute one.
 */
export class RollingMedian {
  #times: number[] = [];
  #values: number[] = [];

  constructor(
    readonly windowMs: number,
    readonly maxSamples = 512,
  ) {}

  get size(): number {
    return this.#values.length;
  }

  push(tMs: number, value: number): void {
    if (!Number.isFinite(value)) return;
    this.#times.push(tMs);
    this.#values.push(value);
    const cutoff = tMs - this.windowMs;
    let drop = Math.max(0, this.#values.length - this.maxSamples);
    while (drop < this.#times.length && (this.#times[drop] ?? tMs) < cutoff) drop += 1;
    if (drop > 0) {
      this.#times.splice(0, drop);
      this.#values.splice(0, drop);
    }
  }

  median(): number {
    const sorted = Float64Array.from(this.#values).sort();
    const n = sorted.length;
    if (n === 0) return Number.NaN;
    const mid = n >> 1;
    return n % 2 === 1
      ? (sorted[mid] ?? Number.NaN)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }

  clear(): void {
    this.#times = [];
    this.#values = [];
  }
}

/** Per-learner reference values that thresholds are measured against. */
export interface ReferenceValues {
  /** Open-eye EAR: blink thresholds are fractions of this. */
  readonly ear: number;
  readonly irisDx: number;
  readonly irisDy: number;
  readonly yaw: number;
  readonly pitch: number;
}

type Key = keyof ReferenceValues;
const KEYS: readonly Key[] = ['ear', 'irisDx', 'irisDy', 'yaw', 'pitch'];

/**
 * The learner's "normal": open-eye EAR and neutral gaze and head pose.
 *
 * Until calibration finishes these are running medians (so blink detection
 * works from the first seconds). At the end of calibration they are frozen,
 * otherwise a learner who looked away for a while would slowly redefine "away"
 * as normal.
 */
export class ReferenceTracker {
  readonly #medians: Record<Key, RollingMedian>;
  readonly #minSamples: number;
  #frozen: ReferenceValues | null = null;

  constructor(
    windowMs: number = FEATURE_CONFIG.reference.windowMs,
    minSamples: number = FEATURE_CONFIG.reference.minSamples,
  ) {
    this.#medians = {
      ear: new RollingMedian(windowMs),
      irisDx: new RollingMedian(windowMs),
      irisDy: new RollingMedian(windowMs),
      yaw: new RollingMedian(windowMs),
      pitch: new RollingMedian(windowMs),
    };
    this.#minSamples = minSamples;
  }

  get frozen(): boolean {
    return this.#frozen !== null;
  }

  /** Adds a frame with a face. Ignored once frozen. */
  observe(tMs: number, s: FrameSignals): void {
    if (this.#frozen) return;
    for (const key of KEYS) this.#medians[key].push(tMs, s[key]);
  }

  /** Current references, or null while there are too few samples to trust. */
  current(): ReferenceValues | null {
    if (this.#frozen) return this.#frozen;
    if (this.#medians.ear.size < this.#minSamples) return null;
    return {
      ear: this.#medians.ear.median(),
      irisDx: this.#medians.irisDx.median(),
      irisDy: this.#medians.irisDy.median(),
      yaw: this.#medians.yaw.median(),
      pitch: this.#medians.pitch.median(),
    };
  }

  /** Fixes the references at their current values (end of calibration). */
  freeze(): ReferenceValues | null {
    const now = this.current();
    if (now) this.#frozen = now;
    return now;
  }

  reset(): void {
    this.#frozen = null;
    for (const key of KEYS) this.#medians[key].clear();
  }
}
