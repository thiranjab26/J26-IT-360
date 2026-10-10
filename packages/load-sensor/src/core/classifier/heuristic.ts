import { FEATURE_COUNT, FEATURE_INDEX, FEATURES, type FeatureName } from '../features/spec.js';
import type { ModelInput } from '../window/feature-window.js';
import type { LoadClassifier, LoadProbabilities } from './types.js';

/**
 * PLACEHOLDER. Not a trained model, not validated, not a research result.
 *
 * Exists so the event stream, the integration and the demo can be built and
 * shown before the 1D-CNN + GRU is trained (TODO A5, C2). Every event it
 * produces says `meta.model_version: "heuristic-0"` so nobody mistakes it for
 * the model.
 *
 * The rule, in full:
 *
 *   1. per valid second t:  s_t = Σ w_i · z_t,i / Σ |w_i|
 *   2. window score:        s = mean of s_t over valid seconds
 *   3. ordinal logistic:    P(High) = σ(k (s − c)),  P(Low) = σ(k (−s − c)),
 *                           P(Medium) = 1 − P(High) − P(Low)
 *
 * z is the learner's own baseline z-score, so s = 0 means "like your first
 * minute" and maps mostly to Medium. Because c > 0, P(High) + P(Low) ≤ 1 for
 * every s, so P(Medium) is never negative.
 */
export const HEURISTIC_MODEL_VERSION = 'heuristic-0';

/**
 * Feature weights. Only the sign is motivated, by commonly reported findings;
 * the magnitudes are arbitrary.
 *  - blink_count −1: blinking is often reported to be suppressed while
 *    attending to demanding visual material.
 *  - brow_inner_gap_mean −1: the inner brows draw together (gap shrinks)
 *    with frowning, often seen with mental effort.
 *  - lip_thickness_mean −0.5: pressing the lips shows as thinner lips.
 *    Expression feature: dropped when `useExpressionFeatures` is false (FR3).
 */
export const HEURISTIC_WEIGHTS: Readonly<Partial<Record<FeatureName, number>>> = Object.freeze({
  blink_count: -1,
  brow_inner_gap_mean: -1,
  lip_thickness_mean: -0.5,
});

/** Score at which High (and, mirrored, Low) becomes as likely as not. */
export const HEURISTIC_THRESHOLD = 0.5;
/** Logistic slope: how quickly probabilities move as the score passes the threshold. */
export const HEURISTIC_SLOPE = 4;

export interface HeuristicOptions {
  readonly useExpressionFeatures?: boolean;
}

export class HeuristicLoadClassifier implements LoadClassifier {
  readonly modelVersion = HEURISTIC_MODEL_VERSION;
  readonly #weights: Float64Array;
  readonly #norm: number;

  constructor(options: HeuristicOptions = {}) {
    const useExpression = options.useExpressionFeatures ?? true;
    this.#weights = new Float64Array(FEATURE_COUNT);
    for (const [name, w] of Object.entries(HEURISTIC_WEIGHTS) as [FeatureName, number][]) {
      const i = FEATURE_INDEX[name];
      if (!useExpression && FEATURES[i]?.ablatable) continue;
      this.#weights[i] = w;
    }
    this.#norm = this.#weights.reduce((sum, w) => sum + Math.abs(w), 0);
  }

  /** The window score s (step 2 above); 0 when no second is valid. */
  score(input: ModelInput): number {
    let total = 0;
    let rows = 0;
    for (let t = 0; t < input.seconds; t += 1) {
      if (input.mask[t] !== 1) continue;
      let s = 0;
      const base = t * input.features;
      for (let i = 0; i < FEATURE_COUNT; i += 1) {
        s += (this.#weights[i] ?? 0) * (input.data[base + i] ?? 0);
      }
      total += s / this.#norm;
      rows += 1;
    }
    return rows > 0 ? total / rows : 0;
  }

  classify(input: ModelInput): LoadProbabilities {
    return scoreToProbabilities(this.score(input));
  }
}

export function scoreToProbabilities(score: number): LoadProbabilities {
  const k = HEURISTIC_SLOPE;
  const c = HEURISTIC_THRESHOLD;
  const high = sigmoid(k * (score - c));
  const low = sigmoid(k * (-score - c));
  return Float64Array.of(low, Math.max(0, 1 - high - low), high);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
