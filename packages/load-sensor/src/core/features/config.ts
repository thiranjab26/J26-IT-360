/**
 * Every tunable constant of the feature pipeline, in one frozen object.
 *
 * All are starting points marked **(tune)** in ARCHITECTURE.md §5: adjust them
 * from recorded fixtures and pilot data, never by guessing. The whole object is
 * written into feature_spec.json, so a model always records the thresholds its
 * training features were computed with.
 */
export const FEATURE_CONFIG = Object.freeze({
  blink: Object.freeze({
    /**
     * Eye counts as closing below 75 % of the learner's own open-eye EAR
     * (ARCHITECTURE.md §5.2). Relative, not a fixed EAR value, because open-eye
     * EAR differs by person, eye shape and glasses.
     */
    closeRatio: 0.75,
    /**
     * Eye counts as open again above 85 %. The 10-point gap is hysteresis: EAR
     * jitter around a single threshold would split one blink into several.
     */
    reopenRatio: 0.85,
    /** Shorter closures are landmark noise. Real blinks last ~100–400 ms. */
    minMs: 80,
    /** Longer closures are not blinks but eye closures (drowsiness signal). */
    maxMs: 500,
  }),
  reference: Object.freeze({
    /**
     * Before calibration ends, the open-eye EAR and the neutral gaze/pose are
     * running medians over this many ms of frames with a face. A median
     * ignores the few percent of frames inside blinks.
     */
    windowMs: 10_000,
    /** Fewer samples than this and the reference is not trusted yet (~1 s at 15 fps). */
    minSamples: 15,
  }),
  gaze: Object.freeze({
    /**
     * Iris within this many eye widths of its neutral position = "roughly
     * centred". Iris travel across the whole eye is about ±0.25 eye widths,
     * so 0.08 tolerates reading across a screen line.
     */
    centredTolerance: 0.08,
  }),
  offScreen: Object.freeze({
    /** Head turned beyond these angles from neutral = looking away from the screen. */
    yawDeg: 25,
    pitchDeg: 20,
    /** Or the eyes far off-centre even with the head straight. */
    irisTolerance: 0.18,
  }),
  presence: Object.freeze({
    /** No face for longer than this = absent (ARCHITECTURE.md §5.5 uses 2 s). */
    absentAfterMs: 2_000,
    /** Looking off-screen continuously for longer than this = away. */
    awayAfterMs: 3_000,
  }),
  yawn: Object.freeze({
    /**
     * Inner-lip gap in inter-ocular distances. Talking stays well below ~0.3;
     * a yawn opens to ~0.5 or more.
     */
    openThreshold: 0.45,
    /** A yawn holds the mouth open for seconds; shorter openings are speech or a gasp. */
    minMs: 1_500,
  }),
  nod: Object.freeze({
    /** Head drops this far below neutral pitch… */
    dropDeg: 15,
    /** …and comes back to within this of neutral… */
    recoverDeg: 7.5,
    /** …within this time = one nod (head dropping while dozing off). */
    maxMs: 2_500,
  }),
  second: Object.freeze({
    /** A second is valid when at least this fraction of its frames had a face (§5.5). */
    minValidRatio: 0.5,
  }),
  window: Object.freeze({
    /** Seconds per classifier window (T). */
    seconds: 30,
    /** More invalid seconds than this fraction and the window is not classified (§5.5). */
    maxInvalidFraction: 0.3,
  }),
  baseline: Object.freeze({
    /** Valid seconds collected for per-learner normalisation (§5.4). */
    seconds: 60,
    /** Absent this long and the baseline is recollected (§5.5). */
    recalibrateAfterMs: 5 * 60_000,
    /** Standard deviations below this are treated as "no variation": z = 0. */
    minStd: 1e-6,
    /** z-scores are clipped to ±this so one odd second cannot dominate a window. */
    zClip: 5,
  }),
});

export type FeatureConfig = typeof FEATURE_CONFIG;
