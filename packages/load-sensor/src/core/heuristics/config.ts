/**
 * Thresholds of the documented heuristics behind `engagement`, `frustration`
 * (ARCHITECTURE.md §7), the wellbeing fields `fatigue`, `affect`, `strain`,
 * `suggest_break` (§8a) and the display-only `boredom` (§8b).
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
  /**
   * Apparent boredom (boredom.ts): display only, not in the event stream.
   * Checkable against a "how bored are you?" self-report in the pilot (B1).
   */
  boredom: Object.freeze({
    /**
     * Seconds the continuous cues are averaged over. Twice the classifier
     * window: a minute of drifting attention is "sustained", a 30 s easy
     * stretch is normal pacing.
     */
    windowSeconds: 60,
    /**
     * Yawns and nods are rare events: counted over the last five minutes.
     * Five minutes is about one yawn's worth at the rate reported while
     * watching boring material, and longer than a bout (yawns in a bout come
     * ~68 s apart), so one bout does not read as a trend at once.
     */
    eventWindowSeconds: 300,
    /**
     * The reading starts as soon as calibration ends: boredom does not wait
     * for the first load estimate (load only adds the underload point and
     * the busy veto, both skipped while it is null). The gaze and head cues
     * need at least this many baseline-normalised seconds before they can
     * earn a point, so the first reading is `not_bored` unless the learner
     * yawns, rather than a guess from two noisy seconds.
     */
    minCueSeconds: 10,
    /**
     * Points for 1 / 2 / 3+ yawns in the event window. Design choice, not a
     * validated threshold: no study gives a yawn count for boredom, and the
     * link is weak (Baenninger; Greco & Baenninger). Provine & Hamernik (1986)
     * report about 5.8 yawns per 30 min for a dull test pattern against 3.4
     * for music videos (via a secondary summary; check the paper, TODO E), so
     * people yawn about once per 9 min even when interested and once per
     * 5 min when bored. Hence one yawn is only supporting evidence (1 point),
     * two in 5 min (~2× the bored rate) reach `possibly_bored` alone, and
     * three or more (~3×) reach `bored` alone. Set from pilot data (ROC). (tune)
     */
    yawnPoints: Object.freeze([1, 2, 3] as const),
    /** Published load Low for at least this share of the window: +1 (underload). */
    underloadShare: 0.5,
    /** Engagement Low for at least this share of the window: +1. */
    lowEngagementShare: 0.5,
    /** Mean z of gaze dispersion (larger axis) at least this: eyes roam clearly more than at baseline. +1 */
    gazeWanderZ: 1,
    /** Mean z of head angular speed at least this: clearly more head movement than at baseline. +1 */
    fidgetZ: 1,
    /** Points for `bored` / `possibly_bored`. */
    boredPoints: 3,
    possiblyBoredPoints: 2,
    /**
     * Drowsy-eyes veto (→ `tired`): mean eyes-closed fraction over the window,
     * yawns masked out (below). 0.15 is the PERCLOS drowsiness cut-off used
     * for `fatigue`.
     */
    drowsyPerclos: 0.15,
    /**
     * Seconds around each yawn left out of the eyes-closed, gaze-wandering and
     * head-restless measures. The eyes squeeze shut during a yawn; unmasked,
     * five test yawns in a minute read 16 % "eyes closed" and turned boredom
     * into `tired`, and two yawns alone read as gaze wandering (z +1.2, irises
     * jump while squinting) and so as `bored` (both seen live 2026-10-20). A yawn is reported when the mouth closes, after it was open
     * ≥ 1.5 s and usually 4–6 s, so the mask reaches 8 s back and 2 s on.
     */
    yawnMaskBeforeSeconds: 8,
    yawnMaskAfterSeconds: 2,
    /**
     * Seconds after a yawn whose published load is not trusted for the
     * "busy" veto: the classifier window (30 s) still holds the yawn, and a
     * yawn reads as High load to `heuristic-0` (stretched lips look pressed,
     * shut eyes look like suppressed blinking). Seen live: 78 % High while
     * yawning.
     */
    yawnLoadSeconds: 30,
    /** Or at least this many head nods in the event window (→ `tired`). */
    drowsyNods: 1,
    /**
     * Published load High for at least this share of the window → `not_bored`
     * (overload side). Applies only when load comes from a trained model,
     * never from the `heuristic-0` placeholder (boredom.ts).
     */
    highLoadShare: 0.5,
    /** Seconds a new state must lead before it is shown. */
    confirm: 3,
  }),
  /**
   * Apparent overload (overload.ts): display only, not in the event stream.
   * The right-hand end of the inverted U; checkable against NASA-TLX Mental
   * Demand, Effort and Frustration in the pilot (B1). All values (tune).
   */
  overload: Object.freeze({
    /** Seconds averaged: the classifier window. */
    windowSeconds: 30,
    /** Usable seconds (face, at the screen, no yawn) needed before any face cue scores. */
    minCueSeconds: 10,
    /**
     * Blink suppression, in baseline spreads. Blink counts per second are
     * mostly 0 or 1: at a baseline of ~0.3 blinks/s (18/min) the spread is
     * ~0.46, so halving the blink rate gives (0.3 − 0.15) / 0.46 ≈ 0.33.
     * 0.3 ≈ "blink rate roughly halved".
     */
    blinkSuppressionZ: 0.3,
    /** Inner brows closer than baseline by at least one spread (furrow). */
    browFurrowZ: 1,
    /** Lips thinner than baseline by at least one spread (press). */
    lipPressZ: 1,
    /** Gaze dispersion below baseline by at least one spread (fixed gaze). */
    gazeFixationZ: 1,
    /** Published load High for at least this share of the window (trained model only). */
    highLoadShare: 0.5,
    /** Points for `overloaded` / `working_hard`. */
    overloadedPoints: 3,
    workingHardPoints: 2,
    /** A second counts as away when at least this share of its frames look off-screen. */
    offScreenSecond: 0.5,
    /** Away for at least this share of the window (and too few usable seconds) → `away`. */
    awayShare: 0.5,
    /**
     * Smallest baseline spread per measure. Face measures in IOD: landmark
     * jitter is ~0.005–0.015 IOD, so 0.02 (the Mood card's floor) keeps it
     * under one spread while a held frown or press (several pixels) clears
     * it. Gaze dispersion in eye widths: per-second SD of the iris offset is
     * ~0.02–0.05 while reading; 0.01 keeps jitter out. Blinks per second:
     * 0.3, so one stray blink in a still calibration cannot set the scale.
     */
    minSpread: Object.freeze({
      blinks: 0.3,
      browGap: 0.02,
      lipThickness: 0.02,
      gazeDispersion: 0.01,
    }),
    /** Seconds a new state must lead before it is shown. */
    confirm: 3,
  }),
});

export type HeuristicConfig = typeof HEURISTIC_CONFIG;
