/**
 * Small fixed-memory statistics for runtime diagnostics (frame time p50/p95,
 * effective fps). Fixed capacity so a 60-minute session uses the same memory
 * as a 1-minute one (NFR6).
 */

/**
 * Percentile of an ascending-sorted array by linear interpolation between
 * closest ranks (the same definition as NumPy's default), so numbers in the
 * report match what the Python analysis would compute. NaN when empty.
 */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const rank = (Math.min(Math.max(p, 0), 100) / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sorted[lo] ?? Number.NaN;
  const b = sorted[hi] ?? Number.NaN;
  return a + (b - a) * (rank - lo);
}

/** Ring buffer of the most recent `capacity` samples. */
export class RollingSamples {
  readonly #buffer: Float64Array;
  #next = 0;
  #size = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`capacity must be a positive integer, got ${String(capacity)}`);
    }
    this.#buffer = new Float64Array(capacity);
  }

  get size(): number {
    return this.#size;
  }

  push(value: number): void {
    this.#buffer[this.#next] = value;
    this.#next = (this.#next + 1) % this.capacity;
    this.#size = Math.min(this.#size + 1, this.capacity);
  }

  /** p in 0..100 over the samples currently held. NaN when empty. */
  percentile(p: number): number {
    return percentile(this.#buffer.slice(0, this.#size).sort(), p);
  }

  clear(): void {
    this.#next = 0;
    this.#size = 0;
  }
}

/**
 * Events per second over a trailing window of event timestamps (ms). Used for
 * the effective inference rate, measured on frame time like everything else.
 * Holds at most `maxEvents` stamps, so memory is bounded even if marks arrive
 * far faster than expected.
 */
export class RateMeter {
  #stamps: number[] = [];

  constructor(
    readonly windowMs = 1000,
    readonly maxEvents = 256,
  ) {}

  mark(tMs: number): void {
    this.#stamps.push(tMs);
    const cutoff = tMs - this.windowMs;
    let drop = Math.max(0, this.#stamps.length - this.maxEvents);
    while (drop < this.#stamps.length && (this.#stamps[drop] ?? tMs) < cutoff) drop += 1;
    if (drop > 0) this.#stamps.splice(0, drop);
  }

  /**
   * Events per second in the window ending at the newest mark: intervals
   * divided by the time they span. 0 with fewer than two marks.
   */
  get rate(): number {
    const n = this.#stamps.length;
    if (n < 2) return 0;
    const first = this.#stamps[0] ?? 0;
    const last = this.#stamps[n - 1] ?? 0;
    return last > first ? ((n - 1) * 1000) / (last - first) : 0;
  }

  clear(): void {
    this.#stamps = [];
  }
}
