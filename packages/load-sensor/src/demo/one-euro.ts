/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012) over a whole vector,
 * one independent filter per element.
 *
 * Display only: it steadies the landmark overlay. The feature pipeline gets the
 * raw landmarks, because smoothing there would blunt blinks that last only
 * 2–5 frames at 15 fps (TODO A4 note on EAR).
 *
 * The cutoff rises with speed: at rest a low cutoff removes jitter, in motion
 * a high cutoff removes lag. Each element gets its own cutoff, so fast eyelid
 * points during a blink are followed closely while the rest stays smoothed.
 */

export interface OneEuroOptions {
  /** Cutoff (Hz) at zero speed. Lower = steadier at rest, more lag. */
  readonly minCutoff: number;
  /** Cutoff increase per unit/s of speed. Higher = less lag in motion. */
  readonly beta: number;
  /** Cutoff (Hz) for the speed estimate itself. */
  readonly dCutoff: number;
}

export class OneEuroVector {
  readonly #opts: OneEuroOptions;
  #x: Float32Array | null = null;
  #dx: Float32Array | null = null;
  #tMs = 0;

  constructor(options: OneEuroOptions) {
    this.#opts = options;
  }

  /** Filters `input` sampled at `tMs` (frame time) and returns the smoothed vector. */
  filter(input: ArrayLike<number>, tMs: number): Float32Array {
    const n = input.length;
    if (!this.#x || !this.#dx || this.#x.length !== n || tMs <= this.#tMs) {
      this.#x = Float32Array.from(input);
      this.#dx = new Float32Array(n);
      this.#tMs = tMs;
      return this.#x;
    }
    const dt = (tMs - this.#tMs) / 1000;
    this.#tMs = tMs;
    const aD = alpha(this.#opts.dCutoff, dt);
    const { minCutoff, beta } = this.#opts;
    const x = this.#x;
    const dx = this.#dx;
    for (let i = 0; i < n; i += 1) {
      const v = input[i] ?? 0;
      const prev = x[i] ?? 0;
      const d = (dx[i] ?? 0) + aD * ((v - prev) / dt - (dx[i] ?? 0));
      dx[i] = d;
      x[i] = prev + alpha(minCutoff + beta * Math.abs(d), dt) * (v - prev);
    }
    return x;
  }

  reset(): void {
    this.#x = null;
    this.#dx = null;
  }
}

/** Smoothing factor of a first-order low-pass with cutoff `hz` at step `dt` (s). */
function alpha(hz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * hz);
  return 1 / (1 + tau / dt);
}
