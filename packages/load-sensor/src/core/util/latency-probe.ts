import type { FrameArrival, FrameArrivalOrigin } from '../camera/types.js';
import type { LoadClassifier } from '../classifier/types.js';
import { RollingSamples } from './rolling-stats.js';

/**
 * Latency measurement for the benchmark (TODO A7, NFR1), using the
 * definitions of ARCHITECTURE.md §11:
 *
 * - **Frame latency**: frame arrival (`FrameArrival`) → per-frame signals
 *   computed. Call `frameSignalsReady()` from the first `FeaturePipeline.onFrame`
 *   listener, before any UI listener runs.
 * - **Event latency (NFR1)**: arrival of the newest frame in a finished second
 *   → the hub has classified that window and emitted any resulting event.
 *   Call `decisionMade()` right after `LoadStateHub.pushSecond()` returns.
 *   A second is only known to be over when the first frame of the next one
 *   arrives, so this includes up to one frame interval of waiting: a real part
 *   of the delay, not an artefact.
 * - **Classifier time**: one `classify()` call (`timedClassifier`).
 * - **Inference time**: one face mesh `estimate()` (from `LandmarkSample`).
 *
 * The 30 s window means a *change* in the learner takes seconds to show; that
 * is by design and not what this measures (§11).
 *
 * Holds at most `capacity` samples per metric (fixed memory, NFR6), so a
 * summary covers the most recent `capacity` frames.
 */

/** Percentiles in ms; null when there were no samples. */
export interface LatencySummary {
  readonly n: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
  readonly mean: number | null;
}

export interface LatencyReport {
  readonly frameLatency: LatencySummary;
  readonly eventLatency: LatencySummary;
  readonly inference: LatencySummary;
  readonly classifier: LatencySummary;
  /** How the frame arrival times were obtained, by count. */
  readonly arrivalOrigins: Readonly<Partial<Record<FrameArrivalOrigin, number>>>;
  /** Frames timed for frame latency, and how many of them had a face. */
  readonly frames: number;
  readonly framesWithFace: number;
}

class Metric {
  readonly #samples: RollingSamples;
  #max = Number.NEGATIVE_INFINITY;
  #sum = 0;
  #n = 0;

  constructor(capacity: number) {
    this.#samples = new RollingSamples(capacity);
  }

  push(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this.#samples.push(ms);
    this.#max = Math.max(this.#max, ms);
    this.#sum += ms;
    this.#n += 1;
  }

  summary(): LatencySummary {
    if (this.#n === 0) return { n: 0, p50: null, p95: null, max: null, mean: null };
    return {
      n: this.#n,
      p50: this.#samples.percentile(50),
      p95: this.#samples.percentile(95),
      max: this.#max,
      mean: this.#sum / this.#n,
    };
  }

  clear(): void {
    this.#samples.clear();
    this.#max = Number.NEGATIVE_INFINITY;
    this.#sum = 0;
    this.#n = 0;
  }
}

export class LatencyProbe {
  /** About 18 min at 15 fps, about 9 min at 30 fps. */
  static readonly DEFAULT_CAPACITY = 16_384;

  readonly #now: () => number;
  readonly #frameListeners = new Set<() => void>();
  readonly #frame: Metric;
  readonly #event: Metric;
  readonly #inference: Metric;
  readonly #classifier: Metric;
  #origins: Partial<Record<FrameArrivalOrigin, number>> = {};
  #frames = 0;
  #framesWithFace = 0;
  /** Arrival of the most recent frame whose signals are ready. */
  #lastArrivalMs: number | null = null;

  constructor(
    capacity = LatencyProbe.DEFAULT_CAPACITY,
    now: () => number = () => performance.now(),
  ) {
    this.#now = now;
    this.#frame = new Metric(capacity);
    this.#event = new Metric(capacity);
    this.#inference = new Metric(capacity);
    this.#classifier = new Metric(capacity);
  }

  /**
   * Per-frame signals of a frame that arrived at `arrival` are now available.
   * `face`: whether a face was found (without one the landmark model never
   * runs, so the numbers would not represent real use).
   */
  frameSignalsReady(arrival: FrameArrival, face: boolean): void {
    this.#frame.push(this.#now() - arrival.ms);
    this.#origins[arrival.origin] = (this.#origins[arrival.origin] ?? 0) + 1;
    this.#frames += 1;
    if (face) this.#framesWithFace += 1;
    this.#lastArrivalMs = arrival.ms;
    for (const listener of this.#frameListeners) listener();
  }

  /**
   * Called after each timed frame. That moment is between inferences: the
   * tracker runs one at a time and reports a frame only after its inference
   * finished and released its tensors, so a TF.js tensor count read here has
   * no in-flight intermediates in it (used by the memory check of the bench).
   */
  onFrame(listener: () => void): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  /**
   * The hub finished with one second. `frames` is how many frames that second
   * held: a second with none (a gap, tab hidden) has no newest frame to time.
   *
   * Relies on the pipeline's order: a second is closed inside `push()` of the
   * next second's first frame, before that frame's signals are reported, so
   * the last frame seen by `frameSignalsReady()` is the closed second's newest.
   */
  decisionMade(frames: number): void {
    if (frames <= 0 || this.#lastArrivalMs === null) return;
    this.#event.push(this.#now() - this.#lastArrivalMs);
  }

  /** Frames timed since the last reset; cheap, for polling. */
  get frameCount(): number {
    return this.#frames;
  }

  inferenceTook(ms: number): void {
    this.#inference.push(ms);
  }

  classifierTook(ms: number): void {
    this.#classifier.push(ms);
  }

  report(): LatencyReport {
    return {
      frameLatency: this.#frame.summary(),
      eventLatency: this.#event.summary(),
      inference: this.#inference.summary(),
      classifier: this.#classifier.summary(),
      arrivalOrigins: { ...this.#origins },
      frames: this.#frames,
      framesWithFace: this.#framesWithFace,
    };
  }

  /** Forgets every sample, e.g. at the end of a warm-up period. */
  reset(): void {
    this.#frame.clear();
    this.#event.clear();
    this.#inference.clear();
    this.#classifier.clear();
    this.#origins = {};
    this.#frames = 0;
    this.#framesWithFace = 0;
    this.#lastArrivalMs = null;
  }

  /** The probe's clock, for timing other spans on the same clock. */
  now(): number {
    return this.#now();
  }
}

/**
 * Wraps a classifier so each `classify()` call is timed into `probe`. The
 * wrapper is transparent: same model version, same output, same disposal.
 */
export function timedClassifier(inner: LoadClassifier, probe: LatencyProbe): LoadClassifier {
  return {
    modelVersion: inner.modelVersion,
    classify(input) {
      const started = probe.now();
      const result = inner.classify(input);
      probe.classifierTook(probe.now() - started);
      return result;
    },
    dispose() {
      inner.dispose?.();
    },
  };
}
