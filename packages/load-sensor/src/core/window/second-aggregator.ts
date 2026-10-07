import { FEATURE_CONFIG } from '../features/config.js';
import type { EyeClosure } from '../features/blink.js';
import type { FrameSignals } from '../features/frame-signals.js';
import { FEATURE_COUNT, FEATURE_INDEX as I } from '../features/spec.js';

/** One processed frame with everything the per-second aggregation needs. */
export interface FrameObservation {
  readonly tMs: number;
  /** null when no face was found in this frame. */
  readonly signals: FrameSignals | null;
  readonly eyesClosed: boolean;
  readonly gazeCentred: boolean;
  readonly offScreen: boolean;
  /** An eye closure that ended on this frame. */
  readonly closure: EyeClosure | null;
  readonly yawn: boolean;
  readonly nod: boolean;
}

/** Counts and ratios kept next to the model features, for heuristics and quality checks. */
export interface SecondAux {
  /** Eye closures longer than a blink (drowsiness). */
  readonly longClosures: number;
  readonly yawns: number;
  readonly nods: number;
  /** Fraction of face frames looking off-screen. */
  readonly offScreenFraction: number;
  /** Mean inter-ocular distance in frame heights (face size; distance to camera). */
  readonly faceSize: number;
}

export interface SecondFeatures {
  /** Seconds since the session's first frame. */
  readonly second: number;
  readonly startMs: number;
  /** Raw (not normalised) feature vector, order as in FEATURES. */
  readonly raw: Float32Array;
  /** Frames processed in this second, with or without a face. */
  readonly frames: number;
  /** Fraction of those frames with a face (FR8 mask). */
  readonly validRatio: number;
  readonly valid: boolean;
  readonly aux: SecondAux;
}

export interface SecondAggregatorOptions {
  /** FR3 ablation: when false, the expression features are always 0. */
  readonly useExpressionFeatures?: boolean;
  readonly minValidRatio?: number;
}

/**
 * Speeds are only computed between face frames at most this far apart; across
 * a longer gap (face lost, tab paused) the change is not a movement speed.
 */
const MAX_SPEED_GAP_MS = 250;

/**
 * Turns per-frame observations into one feature vector per second of frame
 * time (ARCHITECTURE.md §5.3).
 *
 * Seconds are aligned to the first frame and counted on the frame clock.
 * A second with no frames at all (tab hidden, camera stalled) is still emitted,
 * as invalid, so the 30 s window keeps real time and gaps stay visible.
 *
 * Features use only the frames that had a face. §5.5 suggested holding the
 * last values through short face loss; that was not done because repeated
 * values would shrink the dispersion and speed features towards zero. The
 * second's `validRatio` decides whether it counts instead.
 */
export class SecondAggregator {
  readonly #useExpression: boolean;
  readonly #minValidRatio: number;
  readonly #listeners = new Set<(second: SecondFeatures) => void>();

  #t0: number | null = null;
  #current = 0;
  #acc = new Accumulator();
  #lastBlinkDurationMs = 0;
  #prevFace: { tMs: number; yaw: number; pitch: number; roll: number } | null = null;

  constructor(options: SecondAggregatorOptions = {}) {
    this.#useExpression = options.useExpressionFeatures ?? true;
    this.#minValidRatio = options.minValidRatio ?? FEATURE_CONFIG.second.minValidRatio;
  }

  onSecond(listener: (second: SecondFeatures) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  push(frame: FrameObservation): void {
    this.#t0 ??= frame.tMs;
    const second = Math.floor((frame.tMs - this.#t0) / 1000);
    if (second < this.#current) return; // out of order; frame clock is monotonic upstream
    while (second > this.#current) {
      this.#emit();
      this.#current += 1;
    }
    this.#add(frame);
  }

  /** Forgets everything, e.g. when sensing is turned off. */
  reset(): void {
    this.#t0 = null;
    this.#current = 0;
    this.#acc = new Accumulator();
    this.#lastBlinkDurationMs = 0;
    this.#prevFace = null;
  }

  #add(f: FrameObservation): void {
    const a = this.#acc;
    a.frames += 1;
    if (f.closure?.kind === 'blink') {
      a.blinks += 1;
      a.blinkDurationSum += f.closure.durationMs;
    } else if (f.closure?.kind === 'long') {
      a.longClosures += 1;
    }
    if (f.yawn) a.yawns += 1;
    if (f.nod) a.nods += 1;

    const s = f.signals;
    if (!s) {
      this.#prevFace = null;
      return;
    }
    a.faceFrames += 1;
    a.ear += s.ear;
    if (f.eyesClosed) a.eyesClosed += 1;
    if (f.gazeCentred) a.gazeCentred += 1;
    if (f.offScreen) a.offScreen += 1;
    a.irisDx.add(s.irisDx);
    a.irisDy.add(s.irisDy);
    a.yaw.add(s.yaw);
    a.pitch.add(s.pitch);
    a.browRaise += s.browRaise;
    a.browInnerGap += s.browInnerGap;
    a.mouthOpen += s.mouthOpen;
    a.lipThickness += s.lipThickness;
    a.iod += s.iod;

    const prev = this.#prevFace;
    const dt = prev ? f.tMs - prev.tMs : 0;
    if (prev && dt > 0 && dt <= MAX_SPEED_GAP_MS) {
      const change = Math.hypot(s.yaw - prev.yaw, s.pitch - prev.pitch, s.roll - prev.roll);
      a.speedSum += (change / dt) * 1000;
      a.speedCount += 1;
    }
    this.#prevFace = { tMs: f.tMs, yaw: s.yaw, pitch: s.pitch, roll: s.roll };
  }

  #emit(): void {
    const a = this.#acc;
    this.#acc = new Accumulator();
    const n = a.faceFrames;
    const validRatio = a.frames > 0 ? n / a.frames : 0;
    const mean = (sum: number): number => (n > 0 ? sum / n : 0);

    if (a.blinks > 0) this.#lastBlinkDurationMs = a.blinkDurationSum / a.blinks;

    const raw = new Float32Array(FEATURE_COUNT);
    raw[I.blink_count] = a.blinks;
    raw[I.blink_duration_mean] = this.#lastBlinkDurationMs;
    raw[I.ear_mean] = mean(a.ear);
    raw[I.eyes_closed_fraction] = mean(a.eyesClosed);
    raw[I.gaze_dispersion_x] = a.irisDx.std();
    raw[I.gaze_dispersion_y] = a.irisDy.std();
    raw[I.gaze_centred_fraction] = mean(a.gazeCentred);
    raw[I.head_yaw_std] = a.yaw.std();
    raw[I.head_pitch_std] = a.pitch.std();
    raw[I.head_angular_speed] = a.speedCount > 0 ? a.speedSum / a.speedCount : 0;
    raw[I.brow_raise_mean] = mean(a.browRaise);
    raw[I.brow_inner_gap_mean] = mean(a.browInnerGap);
    raw[I.mouth_open_mean] = this.#useExpression ? mean(a.mouthOpen) : 0;
    raw[I.lip_thickness_mean] = this.#useExpression ? mean(a.lipThickness) : 0;

    const second: SecondFeatures = {
      second: this.#current,
      startMs: (this.#t0 ?? 0) + this.#current * 1000,
      raw,
      frames: a.frames,
      validRatio,
      valid: n > 0 && validRatio >= this.#minValidRatio,
      aux: {
        longClosures: a.longClosures,
        yawns: a.yawns,
        nods: a.nods,
        offScreenFraction: mean(a.offScreen),
        faceSize: mean(a.iod),
      },
    };
    for (const listener of this.#listeners) listener(second);
  }
}

/** Population mean and standard deviation in one pass (Welford's algorithm, numerically stable). */
class RunningStd {
  #n = 0;
  #mean = 0;
  #m2 = 0;

  add(x: number): void {
    this.#n += 1;
    const d = x - this.#mean;
    this.#mean += d / this.#n;
    this.#m2 += d * (x - this.#mean);
  }

  std(): number {
    return this.#n > 1 ? Math.sqrt(this.#m2 / this.#n) : 0;
  }
}

class Accumulator {
  frames = 0;
  faceFrames = 0;
  blinks = 0;
  blinkDurationSum = 0;
  longClosures = 0;
  yawns = 0;
  nods = 0;
  ear = 0;
  eyesClosed = 0;
  gazeCentred = 0;
  offScreen = 0;
  irisDx = new RunningStd();
  irisDy = new RunningStd();
  yaw = new RunningStd();
  pitch = new RunningStd();
  speedSum = 0;
  speedCount = 0;
  browRaise = 0;
  browInnerGap = 0;
  mouthOpen = 0;
  lipThickness = 0;
  iod = 0;
}
