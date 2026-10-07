import { FEATURE_CONFIG } from './config.js';

/**
 * The per-second feature vector (ARCHITECTURE.md §5.3): names, order, units.
 *
 * This list is the single source of truth. `pnpm feature-spec` writes it, with
 * FEATURE_CONFIG and a hash of the feature code, to feature_spec.json, which
 * the training code reads (§6). Never reorder or rename without regenerating
 * the spec and retraining: the model sees positions, not names.
 */

export type FeatureGroup = 'blink' | 'gaze' | 'head' | 'brow' | 'expression';

export interface FeatureDefinition {
  readonly name: string;
  readonly group: FeatureGroup;
  readonly unit: string;
  readonly description: string;
  /** Zeroed when `useExpressionFeatures` is false (FR3 ablation, proposal §3.3). */
  readonly ablatable: boolean;
}

export const FEATURES = [
  {
    name: 'blink_count',
    group: 'blink',
    unit: 'count',
    description: 'Blinks (80–500 ms closures) that ended in this second.',
    ablatable: false,
  },
  {
    name: 'blink_duration_mean',
    group: 'blink',
    unit: 'ms',
    description:
      'Mean duration of blinks ending in this second; carried forward from the last blink if none, 0 before the first.',
    ablatable: false,
  },
  {
    name: 'ear_mean',
    group: 'blink',
    unit: 'ratio',
    description: 'Mean eye aspect ratio (both eyes).',
    ablatable: false,
  },
  {
    name: 'eyes_closed_fraction',
    group: 'blink',
    unit: 'fraction',
    description:
      'Fraction of face frames with EAR below the blink threshold. Averaged over 60 s this is a PERCLOS proxy.',
    ablatable: false,
  },
  {
    name: 'gaze_dispersion_x',
    group: 'gaze',
    unit: 'eye widths',
    description: 'Standard deviation of the horizontal iris offset.',
    ablatable: false,
  },
  {
    name: 'gaze_dispersion_y',
    group: 'gaze',
    unit: 'eye widths',
    description: 'Standard deviation of the vertical iris offset.',
    ablatable: false,
  },
  {
    name: 'gaze_centred_fraction',
    group: 'gaze',
    unit: 'fraction',
    description: 'Fraction of face frames with the iris near its neutral position.',
    ablatable: false,
  },
  {
    name: 'head_yaw_std',
    group: 'head',
    unit: 'deg',
    description: 'Standard deviation of head yaw.',
    ablatable: false,
  },
  {
    name: 'head_pitch_std',
    group: 'head',
    unit: 'deg',
    description: 'Standard deviation of head pitch.',
    ablatable: false,
  },
  {
    name: 'head_angular_speed',
    group: 'head',
    unit: 'deg/s',
    description:
      'Mean angular speed of the head between consecutive face frames (rate-independent: divided by frame time).',
    ablatable: false,
  },
  {
    name: 'brow_raise_mean',
    group: 'brow',
    unit: 'IOD',
    description: 'Mean brow height above the upper eyelids.',
    ablatable: false,
  },
  {
    name: 'brow_inner_gap_mean',
    group: 'brow',
    unit: 'IOD',
    description: 'Mean distance between the inner brow ends; furrowing shows as a decrease.',
    ablatable: false,
  },
  {
    name: 'mouth_open_mean',
    group: 'expression',
    unit: 'IOD',
    description: 'Mean inner-lip gap.',
    ablatable: true,
  },
  {
    name: 'lip_thickness_mean',
    group: 'expression',
    unit: 'IOD',
    description: 'Mean visible lip thickness; pressing the lips shows as a decrease.',
    ablatable: true,
  },
] as const satisfies readonly FeatureDefinition[];

export type FeatureName = (typeof FEATURES)[number]['name'];

/** Number of features per second (F). */
export const FEATURE_COUNT = FEATURES.length;

export const FEATURE_NAMES: readonly FeatureName[] = FEATURES.map((f) => f.name);

/** Position of a feature in the vector. */
export const FEATURE_INDEX = Object.fromEntries(FEATURES.map((f, i) => [f.name, i])) as Readonly<
  Record<FeatureName, number>
>;

/** Increment when a feature's definition changes meaning (not for threshold tuning). */
export const FEATURE_SPEC_VERSION = 1;

/** Everything about the features that a trained model depends on, minus the code hash. */
export function featureSpecBody(): Record<string, unknown> {
  return {
    schema: 1,
    version: FEATURE_SPEC_VERSION,
    rate_hz: 1,
    window_seconds: FEATURE_CONFIG.window.seconds,
    feature_count: FEATURE_COUNT,
    features: FEATURES.map((f, index) => ({ index, ...f })),
    validity: {
      mask_field: 'valid',
      min_valid_ratio: FEATURE_CONFIG.second.minValidRatio,
      max_invalid_fraction: FEATURE_CONFIG.window.maxInvalidFraction,
      invalid_rows: 'set to 0 after z-scoring (the baseline mean); never interpolated',
    },
    normalisation: {
      method: 'z-score per learner',
      baseline: `first ${String(FEATURE_CONFIG.baseline.seconds)} valid seconds of the session (pilot study: the rest block)`,
      min_std: FEATURE_CONFIG.baseline.minStd,
      clip: FEATURE_CONFIG.baseline.zClip,
    },
    ablation: {
      flag: 'useExpressionFeatures',
      zeroed_when_false: FEATURES.filter((f) => f.ablatable).map((f) => f.name),
    },
    config: FEATURE_CONFIG,
  };
}
