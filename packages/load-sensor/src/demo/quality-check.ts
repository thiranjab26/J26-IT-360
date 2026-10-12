/**
 * Camera quality check: how steady are the landmarks and per-frame signals
 * at a given capture resolution, while the learner holds still?
 *
 * Measurement only (TODO A7 evidence). It reads landmarks and the per-frame
 * signals the pipeline already computes and keeps running sums and short
 * lists of numbers. No frame, pixel or landmark array is stored or exported:
 * the result is a handful of summary numbers (invariants 1, 2).
 *
 * Noise estimates are frame-to-frame, so slow drift (breathing, settling in
 * the chair) is not counted as jitter, and median-based, so the odd blink or
 * glance does not inflate them:
 *
 * - landmark jitter: per frame pair, every landmark's 2D displacement minus
 *   the mean displacement (whole-face translation), RMS over landmarks, in
 *   inter-ocular distances (IOD). Median over frame pairs. For independent
 *   per-coordinate noise σ this is ≈ 2σ (each 2D step has variance 4σ²).
 * - signal noise (EAR, iris offset, yaw, pitch): σ ≈ 1.4826 · MAD(Δ) / √2,
 *   the robust standard deviation of one frame's value from its successive
 *   differences.
 */

/** Per-frame inputs. `aspect` = frame width / height; landmarks as the provider gives them. */
export interface QualityFrame {
  readonly tMs: number;
  /** Normalised [x0, y0, z0, x1, …] (x / width, y / height), or null without a face. */
  readonly landmarks: Float32Array | null;
  readonly aspect: number;
  /** Per-frame signals; null without a face. */
  readonly signals: {
    readonly ear: number;
    readonly irisDx: number;
    readonly irisDy: number;
    readonly yaw: number;
    readonly pitch: number;
    /** Inter-ocular distance in frame heights. */
    readonly iod: number;
  } | null;
}

export interface QualitySummary {
  readonly frames: number;
  /** Share of frames with a face. */
  readonly faceRatio: number;
  /** Frames per second over the measured span (frame clock). */
  readonly fps: number;
  /** Median landmark jitter, IOD per frame. NaN with fewer than 2 face frames in a row. */
  readonly landmarkJitterIod: number;
  /** Robust per-frame noise σ of each signal; NaN without enough data. */
  readonly earNoise: number;
  readonly irisNoiseX: number;
  readonly irisNoiseY: number;
  readonly yawNoiseDeg: number;
  readonly pitchNoiseDeg: number;
  /** Median face size, IOD in frame heights (bigger = closer / more pixels on the face). */
  readonly faceSizeIod: number;
}

/** Fewer frame pairs than this and a noise estimate is reported as NaN. */
const MIN_PAIRS = 10;

export class QualityMeter {
  #frames = 0;
  #faceFrames = 0;
  #firstT = Number.NaN;
  #lastT = Number.NaN;
  #prev: { landmarks: Float32Array; aspect: number } | null = null;
  #prevSignals: QualityFrame['signals'] = null;
  readonly #jitter: number[] = [];
  readonly #diffs = {
    ear: [] as number[],
    dx: [] as number[],
    dy: [] as number[],
    yaw: [] as number[],
    pitch: [] as number[],
  };
  readonly #sizes: number[] = [];

  push(f: QualityFrame): void {
    this.#frames += 1;
    if (Number.isNaN(this.#firstT)) this.#firstT = f.tMs;
    this.#lastT = f.tMs;
    const s = f.signals;
    if (!f.landmarks || !s) {
      this.#prev = null;
      this.#prevSignals = null;
      return;
    }
    this.#faceFrames += 1;
    this.#sizes.push(s.iod);
    const prev = this.#prev;
    if (prev?.landmarks.length === f.landmarks.length && s.iod > 0) {
      this.#jitter.push(landmarkJitter(prev.landmarks, f.landmarks, f.aspect) / s.iod);
    }
    const ps = this.#prevSignals;
    if (ps) {
      this.#diffs.ear.push(s.ear - ps.ear);
      this.#diffs.dx.push(s.irisDx - ps.irisDx);
      this.#diffs.dy.push(s.irisDy - ps.irisDy);
      this.#diffs.yaw.push(s.yaw - ps.yaw);
      this.#diffs.pitch.push(s.pitch - ps.pitch);
    }
    // Copy: the provider may reuse its buffer for the next frame.
    this.#prev = { landmarks: Float32Array.from(f.landmarks), aspect: f.aspect };
    this.#prevSignals = s;
  }

  summary(): QualitySummary {
    const spanS = (this.#lastT - this.#firstT) / 1000;
    return {
      frames: this.#frames,
      faceRatio: this.#frames > 0 ? this.#faceFrames / this.#frames : 0,
      fps: spanS > 0 ? (this.#frames - 1) / spanS : Number.NaN,
      landmarkJitterIod: this.#jitter.length >= MIN_PAIRS ? median(this.#jitter) : Number.NaN,
      earNoise: robustStepSigma(this.#diffs.ear),
      irisNoiseX: robustStepSigma(this.#diffs.dx),
      irisNoiseY: robustStepSigma(this.#diffs.dy),
      yawNoiseDeg: robustStepSigma(this.#diffs.yaw),
      pitchNoiseDeg: robustStepSigma(this.#diffs.pitch),
      faceSizeIod: this.#sizes.length > 0 ? median(this.#sizes) : Number.NaN,
    };
  }
}

/**
 * RMS of landmark displacement between two frames after removing the mean
 * displacement, in frame heights (x is scaled by the aspect ratio so both
 * axes share one unit). z is ignored: it is a model estimate, not a measurement.
 */
export function landmarkJitter(a: Float32Array, b: Float32Array, aspect: number): number {
  const n = Math.floor(Math.min(a.length, b.length) / 3);
  if (n === 0) return Number.NaN;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i += 1) {
    mx += ((b[i * 3] ?? 0) - (a[i * 3] ?? 0)) * aspect;
    my += (b[i * 3 + 1] ?? 0) - (a[i * 3 + 1] ?? 0);
  }
  mx /= n;
  my /= n;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = ((b[i * 3] ?? 0) - (a[i * 3] ?? 0)) * aspect - mx;
    const dy = (b[i * 3 + 1] ?? 0) - (a[i * 3 + 1] ?? 0) - my;
    sum += dx * dx + dy * dy;
  }
  return Math.sqrt(sum / n);
}

/** σ of one sample from successive differences: 1.4826 · MAD(Δ) / √2. NaN if too few. */
export function robustStepSigma(diffs: readonly number[]): number {
  if (diffs.length < MIN_PAIRS) return Number.NaN;
  const m = median(diffs);
  const mad = median(diffs.map((d) => Math.abs(d - m)));
  return (1.4826 * mad) / Math.SQRT2;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? Number.NaN) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Resolutions the check compares, smallest first (the shipped default is the first). */
export const QUALITY_RESOLUTIONS: readonly { readonly width: number; readonly height: number }[] = [
  { width: 640, height: 480 },
  { width: 960, height: 720 },
  { width: 1280, height: 720 },
];
