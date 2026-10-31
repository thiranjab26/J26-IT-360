import { BlinkDetector, type EyeClosure } from '../features/blink.js';
import { FEATURE_CONFIG } from '../features/config.js';
import { NodDetector, YawnDetector } from '../features/drowsiness.js';
import { computeFrameSignals, type FrameSignals } from '../features/frame-signals.js';
import { LookDownTracker } from '../features/look-down.js';
import { BaselineCalibrator } from './baseline.js';
import { FeatureWindow } from './feature-window.js';
import { PresenceTracker, type Presence } from './presence.js';
import { ReferenceTracker, type ReferenceValues } from './references.js';
import {
  SecondAggregator,
  type FrameObservation,
  type SecondFeatures,
} from './second-aggregator.js';

/** Everything known about one processed frame, for the overlay and charts. */
export interface FrameFeatures extends FrameObservation {
  readonly presence: Presence;
  /**
   * Looking down at the keyboard or desk (look-down.ts). Eye closure uses
   * the look-down thresholds, and it does not count as off-screen unless the
   * head is also turned or dropped past FEATURE_CONFIG.lookDown.maxPitchDeg.
   */
  readonly lookingDown: boolean;
  /** References the thresholds were measured against; null in the first second. */
  readonly reference: ReferenceValues | null;
}

export type CalibrationPhase = 'calibrating' | 'ready';

/** A finished second: raw features, and z-scores once the baseline is ready. */
export interface NormalisedSecond extends SecondFeatures {
  /** Baseline z-scores; null while calibrating. */
  readonly z: Float32Array | null;
  readonly phase: CalibrationPhase;
}

export interface PipelineState {
  readonly phase: CalibrationPhase;
  /** 0..1 calibration progress. */
  readonly calibrationProgress: number;
  readonly calibrationSeconds: number;
  readonly calibrationTarget: number;
  readonly presence: Presence;
  /** True when the window may be classified (full and ≤ 30 % invalid). */
  readonly classifiable: boolean;
  readonly windowSeconds: number;
  readonly windowInvalidFraction: number;
}

export interface FeaturePipelineOptions {
  /**
   * FR3 ablation switch. Fixed for the pipeline's lifetime: changing it
   * mid-session would mix features normalised against different baselines,
   * so the caller creates a new pipeline (and recalibrates) instead.
   */
  readonly useExpressionFeatures?: boolean;
  readonly calibrationSeconds?: number;
  readonly windowSeconds?: number;
}

/**
 * Landmarks in, features out (ARCHITECTURE.md §2, §5):
 *
 *   face mesh → per-frame signals → blink / yawn / nod / presence
 *             → per-second vector → baseline z-score → 30 s window
 *
 * Driven entirely by `push()` with frame timestamps: no timers, no DOM, no
 * TF.js, so the identical code runs in the browser, in unit tests and in the
 * Node script that converts public datasets (§6).
 *
 * Only numbers leave this class. It never holds more than the current mesh.
 */
export class FeaturePipeline {
  readonly useExpressionFeatures: boolean;

  readonly #references = new ReferenceTracker();
  readonly #blink = new BlinkDetector();
  readonly #yawn = new YawnDetector();
  readonly #nod = new NodDetector();
  readonly #lookDown = new LookDownTracker();
  readonly #presence = new PresenceTracker();
  readonly #aggregator: SecondAggregator;
  readonly #baseline: BaselineCalibrator;
  readonly #window: FeatureWindow;
  readonly #frameListeners = new Set<(f: FrameFeatures) => void>();
  readonly #secondListeners = new Set<(s: NormalisedSecond) => void>();

  #lastValidSecondMs: number | null = null;

  constructor(options: FeaturePipelineOptions = {}) {
    this.useExpressionFeatures = options.useExpressionFeatures ?? true;
    this.#aggregator = new SecondAggregator({
      useExpressionFeatures: this.useExpressionFeatures,
    });
    this.#baseline = new BaselineCalibrator(
      options.calibrationSeconds === undefined ? {} : { seconds: options.calibrationSeconds },
    );
    this.#window = new FeatureWindow(options.windowSeconds);
    this.#aggregator.onSecond(this.#onSecond);
  }

  get state(): PipelineState {
    return {
      phase: this.#baseline.ready ? 'ready' : 'calibrating',
      calibrationProgress: this.#baseline.progress,
      calibrationSeconds: this.#baseline.collectedSeconds,
      calibrationTarget: this.#baseline.targetSeconds,
      presence: this.#presence.state,
      classifiable: this.#window.classifiable,
      windowSeconds: this.#window.size,
      windowInvalidFraction: this.#window.invalidFraction,
    };
  }

  get window(): FeatureWindow {
    return this.#window;
  }

  get baseline(): BaselineCalibrator {
    return this.#baseline;
  }

  onFrame(listener: (f: FrameFeatures) => void): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  onSecond(listener: (s: NormalisedSecond) => void): () => void {
    this.#secondListeners.add(listener);
    return () => this.#secondListeners.delete(listener);
  }

  /**
   * Feeds one processed frame.
   *
   * @param tMs frame timestamp (ms, media clock, strictly increasing)
   * @param landmarks 478×3 normalised landmarks, or null when no face was found
   * @param aspect frame width / height
   */
  push(tMs: number, landmarks: Float32Array | null, aspect: number): FrameFeatures {
    return this.pushSignals(tMs, landmarks ? computeFrameSignals({ landmarks, aspect }) : null);
  }

  /**
   * Feeds one frame's already-computed signals (null = no face). Used to
   * replay a study-session export, which stores per-frame signals but never
   * the mesh (ARCHITECTURE.md §9), through the same per-second code: the
   * training data then comes from this TypeScript, never from Python (§6).
   */
  pushSignals(tMs: number, signals: FrameSignals | null): FrameFeatures {
    const frame = signals ? this.#withFace(tMs, signals) : this.#withoutFace(tMs);
    this.#aggregator.push(frame);
    for (const listener of this.#frameListeners) listener(frame);
    return frame;
  }

  /** Starts over: new calibration, empty window. Call when sensing is turned off. */
  reset(): void {
    this.#references.reset();
    this.#blink.reset();
    this.#yawn.reset();
    this.#nod.reset();
    this.#lookDown.reset();
    this.#presence.reset();
    this.#aggregator.reset();
    this.#baseline.reset();
    this.#window.clear();
    this.#lastValidSecondMs = null;
  }

  #withFace(tMs: number, s: FrameSignals): FrameFeatures {
    this.#references.observe(tMs, s);
    const ref = this.#references.current();
    const wasLookingDown = this.#lookDown.down;
    const lookingDown =
      ref !== null && ref.ear > 0
        ? this.#lookDown.update(tMs, s.pitch - ref.pitch, s.irisDy - ref.irisDy, s.ear / ref.ear)
        : false;
    // The lid drops with the gaze a moment before the look-down state is
    // confirmed; a "closure" started then is that drop, not a blink: drop it.
    if (lookingDown && !wasLookingDown) this.#blink.reset();
    const blink = this.#blink.update(tMs, s.ear, ref?.ear ?? null, lookingDown);

    let gazeCentred = false;
    let offScreen = false;
    let nod = false;
    if (ref) {
      const dx = s.irisDx - ref.irisDx;
      const dy = s.irisDy - ref.irisDy;
      const yawOff = Math.abs(s.yaw - ref.yaw);
      const pitchDown = s.pitch - ref.pitch;
      const g = FEATURE_CONFIG.gaze.centredTolerance;
      const o = FEATURE_CONFIG.offScreen;
      gazeCentred = Math.abs(dx) <= g && Math.abs(dy) <= g;
      // Typing: eyes on the keys is part of the task, not looking away.
      const atKeyboard =
        lookingDown && yawOff <= o.yawDeg && pitchDown <= FEATURE_CONFIG.lookDown.maxPitchDeg;
      offScreen =
        !atKeyboard &&
        (yawOff > o.yawDeg ||
          Math.abs(pitchDown) > o.pitchDeg ||
          Math.hypot(dx, dy) > o.irisTolerance);
      // Head dropped means looking down, so only the strict look-down threshold
      // counts as shut eyes for a nod (not the lid lowering at the onset).
      nod = this.#nod.update(tMs, pitchDown, blink.eyesClosed && lookingDown);
    }
    const yawn = this.#yawn.update(tMs, s.mouthOpen) !== null;
    const presence = this.#presence.update(tMs, true, offScreen);

    return {
      tMs,
      signals: s,
      eyesClosed: blink.eyesClosed,
      gazeCentred,
      offScreen,
      closure: blink.closure,
      yawn,
      nod,
      presence,
      reference: ref,
      lookingDown,
    };
  }

  #withoutFace(tMs: number): FrameFeatures {
    // A closure or yawn whose end was not seen is dropped, not guessed.
    this.#blink.reset();
    this.#yawn.reset();
    this.#nod.reset();
    this.#lookDown.reset();
    const closure: EyeClosure | null = null;
    return {
      tMs,
      signals: null,
      eyesClosed: false,
      gazeCentred: false,
      offScreen: false,
      closure,
      yawn: false,
      nod: false,
      presence: this.#presence.update(tMs, false, false),
      reference: this.#references.current(),
      lookingDown: false,
    };
  }

  readonly #onSecond = (second: SecondFeatures): void => {
    if (second.valid) {
      // Back after a long absence (§5.5): lighting, seating and glasses may all
      // have changed, so the old baseline no longer describes this learner.
      const gap = this.#lastValidSecondMs === null ? 0 : second.startMs - this.#lastValidSecondMs;
      if (this.#baseline.ready && gap > FEATURE_CONFIG.baseline.recalibrateAfterMs) {
        this.#baseline.reset();
        this.#references.reset();
        this.#window.clear();
      }
      this.#lastValidSecondMs = second.startMs;
    }

    let z: Float32Array | null = null;
    if (!this.#baseline.ready) {
      if (second.valid && this.#baseline.add(second.raw)) this.#references.freeze();
    } else {
      z = this.#baseline.zScore(second.raw);
      this.#window.push({ second: second.second, z, valid: second.valid });
    }

    // The second that completes the baseline is itself part of calibration (no z).
    const out: NormalisedSecond = { ...second, z, phase: z ? 'ready' : 'calibrating' };
    for (const listener of this.#secondListeners) listener(out);
  };
}
