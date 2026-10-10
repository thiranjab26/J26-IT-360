import type { Level } from '../events/types.js';
import type { ModelInput } from '../window/feature-window.js';

/** Class order of every probability vector: index 0 = Low, 1 = Medium, 2 = High. */
export const LOAD_CLASSES: readonly Level[] = ['Low', 'Medium', 'High'];

/** Three probabilities in `LOAD_CLASSES` order, summing to 1. */
export type LoadProbabilities = Float64Array;

/**
 * Anything that turns one 30 s window into load-class probabilities: the
 * placeholder rule now, the exported 1D-CNN + GRU later (ARCHITECTURE.md §7).
 *
 * Synchronous on purpose: one window per second is a few thousand
 * multiply-adds, and TF.js `predict` + `dataSync` on a model this small is
 * also synchronous. Keeping it sync keeps event order and tests deterministic.
 */
export interface LoadClassifier {
  /** Reported as `meta.model_version` in every event. */
  readonly modelVersion: string;
  classify(input: ModelInput): LoadProbabilities;
  /** Releases model memory, if any. */
  dispose?(): void;
}
