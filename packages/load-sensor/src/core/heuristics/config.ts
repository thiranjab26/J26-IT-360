/**
 * Thresholds of the documented heuristics behind `engagement`, `frustration`
 * (ARCHITECTURE.md §7) and the wellbeing fields `fatigue`, `affect`, `strain`,
 * `suggest_break` (§8a).
 *
 * None of these is a model output or a validated measure. All are hand-picked
 * starting points **(tune)**; the pilot NASA-TLX and the "how tired are you?"
 * item (B1) are what they can be checked against. Until then report them as
 * unvalidated. Time is counted in seconds of the feature pipeline (frame
 * clock), except `strain`'s day boundary, which needs the wall clock.
 */
export const HEURISTIC_CONFIG = Object.freeze({
  engagement: Object.freeze({
    /** Seconds averaged (same as the classifier window). */
    windowSeconds: 30,
    /**
     * Per-second engagement = face-present share × (half on-screen share +
     * half gaze-centred share). ≥ 0.75 averaged: looking at the screen most of
     * the time with steady gaze.
     */
    high: 0.75,
    /** Below 0.45: away from the screen or eyes elsewhere for over half the window. */
    low: 0.45,
    /** Seconds a new level must lead before it is published. */
    confirm: 3,
  }),
  frustration: Object.freeze({
    /** Published load must have been High for at least this long… */
    sustainedHighSeconds: 15,
    /** …and, over these last seconds, brows drawn together or lips pressed: */
    expressionWindowSeconds: 10,
    /** Mean z of (−brow_inner_gap) at least this: inner brows clearly closer than at baseline. */
    furrowZ: 1,
    /** Mean z of (−lip_thickness) at least this: lips clearly pressed. Expression feature (FR3). */
    pressZ: 1,
  }),
  fatigue: Object.freeze({
    /** PERCLOS proxy: mean eyes-closed fraction over this many seconds. */
    perclosSeconds: 60,
    /**
     * PERCLOS ≥ 0.15 is a drowsiness cut-off often used in driver-monitoring
     * work; 0.08 marks "more than usual". Neither is validated for learners
     * at a desk, and the camera cannot tell drowsy from asleep.
     */
    perclosMedium: 0.08,
    perclosHigh: 0.15,
    /** Eye closures longer than a blink (> 500 ms) within the PERCLOS window. */
    longClosuresMedium: 2,
    /** Yawns and nods are rarer: counted over the last five minutes. */
    eventSeconds: 300,
    yawnsMedium: 1,
    yawnsHigh: 3,
    nodsMedium: 1,
    nodsHigh: 2,
    /** Points from the rules above: ≥ 3 → High, ≥ 1 → Medium. */
    pointsHigh: 3,
    pointsMedium: 1,
    confirm: 5,
  }),
  affect: Object.freeze({
    /** Seconds of z-scores averaged before judging an expression. */
    windowSeconds: 10,
    /** Same meaning as in `frustration`. */
    furrowZ: 1,
    pressZ: 1,
    /** Brows clearly raised above baseline (surprise / puzzlement). */
    raiseZ: 1.5,
    confirm: 3,
  }),
  strain: Object.freeze({
    /** Time on task today (valid sensing seconds), minutes: +1 / +2 points. */
    onTaskMinutes: Object.freeze([180, 300]),
    /** Time at published High load today, minutes. */
    highLoadMinutes: Object.freeze([30, 60]),
    /** Time on task since the last break, minutes (50 ≈ a lecture without a pause). */
    sinceBreakMinutes: Object.freeze([50, 90]),
    /** Time at fatigue High today, minutes: +1 point. */
    fatigueHighMinutes: 10,
    /** Points: ≥ 4 → High, ≥ 2 → Medium. */
    pointsHigh: 4,
    pointsMedium: 2,
    /** No face (or sensing off) for at least this long counts as a break. */
    breakAfterAbsentMs: 5 * 60_000,
    /** `suggest_break` also when fatigue has been High continuously this long. */
    fatigueHighForBreakSeconds: 120,
    /** Day totals are written to storage at most this often (and on disable). */
    saveEveryMs: 30_000,
  }),
});

export type HeuristicConfig = typeof HEURISTIC_CONFIG;
