import { FEATURE_INDEX as I } from '../core/features/spec.js';
import type { FrameSignals } from '../core/features/frame-signals.js';
import { midpoint, point, type FaceMesh } from '../core/features/geometry.js';
import { EngagementEstimator, HEURISTIC_CONFIG } from '../core/heuristics/index.js';
import { EXPRESSION_CLASSES, type ExpressionClass } from '../core/classifier/mesh-model.js';
import { Hysteresis } from '../core/classifier/smoothing.js';
import type { NormalisedSecond } from '../core/window/index.js';

/**
 * Apparent mood for the Signals tab: a display-only read-out of what the face
 * and eyes show, compared with the learner's own calibration baseline.
 *
 * What it is not: a measure of how someone feels. Facial movements do not map
 * one-to-one onto emotions (Barrett et al., 2019, Psychol. Sci. Public
 * Interest 20(1)), so every state is named for the expression or behaviour
 * that triggers it, the evidence is shown beside it, and none of it leaves the
 * page: it is not in the event stream, not a model input, not in
 * feature_spec.json. Thresholds are hand-picked starting points (tune), not
 * validated.
 *
 * Each second it checks these rules in order; the first match is the
 * candidate, and a candidate must win MOOD_CONFIG.confirm seconds in a row
 * before the shown mood changes (no flicker on a single frame):
 *
 *  no face    no valid face this second
 *  drowsy     eyes closed ≥ 15 % of the last 30 s (PERCLOS high cut-off, as
 *             `fatigue`) or ≥ 2 long closures / yawns / nods in 30 s
 *  happy      mouth corners lifted and mouth widened (smile, AU12)
 *  surprised  brows raised a lot and mouth open (AU1+2, AU26)
 *  frustrated brows drawn together and lips pressed (AU4, AU24; as `affect`)
 *  sad        mouth corners pulled down, not widened (AU15)
 *  confused   brows drawn together, or raised (AU4 / AU1+2; as `affect`)
 *  focused    looking at the screen with steady gaze (engagement score high)
 *  distracted mostly looking away (engagement score low)
 *  neutral    none of the above
 *
 * Expression rules need z-scores, so they start once the 30 s baseline is
 * ready, and they switch off with the FR3 expression features (ablation).
 *
 * The z-scores here are the mood's own, not the pipeline's: every face measure
 * is collected per frame, skipping frames with the head turned or the eyes
 * closed (a blink drops the upper lid, which reads as a brow raise), and is
 * scored against a robust baseline (median, MAD) with a floor on the spread.
 * Without the floor, a learner who sat very still while calibrating gets a
 * spread of under a pixel, and ordinary landmark jitter then crosses every
 * threshold: that was why moods appeared at random. The pipeline's z-scores
 * are left alone because they are the model input (feature_spec.json).
 *
 * A mood that is showing needs less evidence to stay than it needed to start
 * (MOOD_CONFIG.keep), so a reading near a threshold does not flip back and
 * forth.
 *
 * Trained model (TODO P4/P5, the PP1 panel's request): with the expression
 * source set to 'model' and the model loaded, happy / surprised / frustrated /
 * sad come from the trained expression model (src/core/classifier/mesh-model.ts)
 * instead of the z-score rules: its class probabilities are averaged over the
 * same frames and window, and a mood shows when its probability reaches
 * MOOD_CONFIG.modelShow. frustrated = anger + disgust (brows down, lips
 * pressed or raised: the closest of the 7 classes). Fear has no mood here.
 * drowsy, confused, focused and distracted are not expressions of those 7
 * classes and keep their rules. Source 'rules' is the ablation; if the model
 * is missing the rules are used.
 */

export type Mood =
  | 'no-face'
  | 'drowsy'
  | 'happy'
  | 'surprised'
  | 'frustrated'
  | 'sad'
  | 'confused'
  | 'focused'
  | 'distracted'
  | 'neutral';

export const MOOD_CONFIG = Object.freeze({
  /** Seconds a new mood must lead before it is shown. */
  confirm: 3,
  /** Seconds of z-scores averaged for expression rules (a held expression, not a twitch). */
  expressionWindowSeconds: 4,
  /** Seconds for drowsiness evidence. */
  drowsyWindowSeconds: 30,
  /** Same PERCLOS cut-off as `fatigue` High. */
  drowsyClosedFraction: HEURISTIC_CONFIG.fatigue.perclosHigh,
  /** Long eye closures + yawns + nods within the drowsy window. */
  drowsyEvents: 2,
  /** Seconds averaged for the engagement score. */
  engagementWindowSeconds: 10,
  focusedScore: HEURISTIC_CONFIG.engagement.high,
  distractedScore: HEURISTIC_CONFIG.engagement.low,
  /**
   * z thresholds against the learner's baseline. The brow and lip ones are
   * stricter than `affect`'s (HEURISTIC_CONFIG.affect: 1 / 1 / 1.5) because a
   * named mood on screen should need a deliberate expression, not a drift.
   */
  smileZ: 1.5,
  smileWidthZ: 0.5,
  sadCornerZ: -1.5,
  sadMaxWidthZ: 0.5,
  surpriseBrowZ: 2.5,
  surpriseMouthZ: 2,
  furrowZ: 1.5,
  pressZ: 1.5,
  confusedRaiseZ: 2,
  /**
   * Trained model: mean class probability over the expression window needed
   * to show an expression mood. 0.5 means the model puts more weight on that
   * expression than on all others together. The keep factor applies as for
   * the rules (0.35 to stay). (tune) on pilot data.
   */
  modelShow: 0.5,
  /**
   * While a mood is showing, its thresholds are multiplied by this (a Schmitt
   * trigger): it stays until the evidence falls clearly below the entry level.
   */
  keep: 0.7,
  /** Engagement band around the focused / distracted cut-offs, same idea as `keep`. */
  engagementBand: 0.05,
  /**
   * Smallest baseline spread per measure (IOD). Landmark jitter on a laptop
   * webcam is roughly 0.005-0.015 IOD (under 1 px at a 70 px IOD), so a floor
   * of 0.02 keeps jitter well under z = 1, while a held furrow or raise
   * (several pixels) still clears the thresholds. The mouth-opening floor is
   * higher because speech moves it all the time. (tune)
   */
  minSpread: Object.freeze({
    lift: 0.01,
    width: 0.015,
    browRaise: 0.02,
    browGap: 0.02,
    lipThick: 0.02,
    mouthOpen: 0.03,
  }),
  /** Frames with the head turned further than this are not used for face measures. */
  maxYawDeg: 25,
  maxPitchDeg: 20,
  /** Baseline seconds needed before the mouth measures are trusted. */
  minBaselineSeconds: 10,
  /** History kept for the timeline. */
  historySeconds: 300,
});

/** Inner mouth corners (MediaPipe 78 = subject's right, 308 = left), checked against the lips contour in the tests. */
export const RIGHT_MOUTH_CORNER = 78;
export const LEFT_MOUTH_CORNER = 308;
const RIGHT_EYE_OUTER = 33;
const LEFT_EYE_OUTER = 263;
const UPPER_LIP_INNER = 13;
const LOWER_LIP_INNER = 14;

/**
 * How far the mouth corners sit above the lip centre, along the face's own
 * vertical axis (perpendicular to the eye line, so head roll cancels), in IOD.
 * Rises with a smile, falls when the corners are pulled down. Image plane only.
 */
export function mouthCornerLift(mesh: FaceMesh, iod: number): number {
  const eyeR = point(mesh, RIGHT_EYE_OUTER);
  const eyeL = point(mesh, LEFT_EYE_OUTER);
  const ex = eyeL.x - eyeR.x;
  const ey = eyeL.y - eyeR.y;
  const len = Math.hypot(ex, ey);
  if (len === 0 || iod <= 0) return Number.NaN;
  // Image y grows downwards, so the eye axis turned by +90° points to the chin.
  const downX = -ey / len;
  const downY = ex / len;
  const centre = midpoint(point(mesh, UPPER_LIP_INNER), point(mesh, LOWER_LIP_INNER));
  const corners = midpoint(point(mesh, RIGHT_MOUTH_CORNER), point(mesh, LEFT_MOUTH_CORNER));
  return ((centre.x - corners.x) * downX + (centre.y - corners.y) * downY) / iod;
}

/** Corner-to-corner mouth width in IOD (image plane). Widens with a smile. */
export function mouthWidth(mesh: FaceMesh, iod: number): number {
  if (iod <= 0) return Number.NaN;
  const a = point(mesh, RIGHT_MOUTH_CORNER);
  const b = point(mesh, LEFT_MOUTH_CORNER);
  return Math.hypot(b.x - a.x, b.y - a.y) / iod;
}

export interface MoodFrame {
  readonly landmarks: Float32Array | null;
  readonly aspect: number;
  /** From the per-frame signals; null without a face. */
  readonly signals: Pick<
    FrameSignals,
    'iod' | 'yaw' | 'pitch' | 'browRaise' | 'browInnerGap' | 'mouthOpen' | 'lipThickness'
  > | null;
  /** Eyes closed in this frame (blink detector); such frames are skipped. */
  readonly eyesClosed?: boolean;
  /** Trained expression model output for this frame, in EXPRESSION_CLASSES order; null/absent if not run. */
  readonly expression?: Float32Array | null;
}

/** Where the four expression moods come from. */
export type ExpressionSource = 'model' | 'rules';

/** Face measures the mood scores against its own baseline, all in IOD. */
const MEASURES = ['lift', 'width', 'browRaise', 'browGap', 'lipThick', 'mouthOpen'] as const;
type Measure = (typeof MEASURES)[number];
type Measures = Readonly<Record<Measure, number>>;

/** Evidence behind the reading, each in "how unusual for you" units (z) or a share. */
export interface MoodEvidence {
  readonly smile: number | null;
  readonly mouthWidth: number | null;
  readonly browRaise: number | null;
  readonly browFurrow: number | null;
  readonly lipPress: number | null;
  readonly mouthOpen: number | null;
  /** Share of the last 30 s with eyes closed (0..1). */
  readonly eyesClosed: number | null;
  /** Long closures + yawns + nods in the last 30 s. */
  readonly tiredEvents: number;
  /** Engagement score over the last 10 s (0..1). */
  readonly onScreen: number | null;
  /** Trained model: mean class probabilities over the expression window; null when the rules are used. */
  readonly model: Readonly<Record<ExpressionClass, number>> | null;
}

export interface MoodReading {
  readonly mood: Mood;
  /** Frame-clock time (ms) the shown mood started. */
  readonly sinceMs: number;
  /** How clearly the evidence crosses the rule, 0..1 (neutral: how quiet the face is). */
  readonly strength: number;
  readonly evidence: MoodEvidence;
  /** Expression rules are waiting for the baseline. */
  readonly calibrating: boolean;
  /** Expression rules are switched on (FR3). */
  readonly expression: boolean;
  /** Where happy / surprised / frustrated / sad came from this second. */
  readonly source: ExpressionSource;
}

export interface MoodSegment {
  readonly mood: Mood;
  readonly startMs: number;
  readonly endMs: number;
}

interface SecondRow {
  readonly startMs: number;
  readonly valid: boolean;
  /** Mean face measures over the usable frames of this second; null if none. */
  readonly m: Measures | null;
  /** Mean trained-model probabilities over the usable frames of this second; null if none. */
  readonly p: Float32Array | null;
  readonly closed: number;
  readonly tired: number;
  readonly engagement: number;
}

export class MoodEstimator {
  #expression: boolean;
  #source: ExpressionSource = 'rules';
  #frames: Measures[] = [];
  #probFrames: Float32Array[] = [];
  #base: Measures[] = [];
  #baseline: { mid: Measures; sd: Measures } | null = null;
  #lastPhase: NormalisedSecond['phase'] | null = null;
  #rows: SecondRow[] = [];
  #gate = new Hysteresis<Mood>(MOOD_CONFIG.confirm);
  #shown: Mood | null = null;
  #sinceMs = 0;
  #history: MoodSegment[] = [];
  #reading: MoodReading | null = null;
  #hidden = new Set<Mood>();

  constructor(useExpressionFeatures = true) {
    this.#expression = useExpressionFeatures;
  }

  get reading(): MoodReading | null {
    return this.#reading;
  }

  /** Mood segments over the last few minutes, oldest first (the current one is open-ended). */
  get history(): readonly MoodSegment[] {
    return this.#history;
  }

  /** FR3 switch; a change restarts the estimate (the pipeline recalibrates too). */
  setExpression(enabled: boolean): void {
    if (enabled === this.#expression) return;
    this.#expression = enabled;
    this.reset();
  }

  /**
   * Trained model or hand-picked rules for the expression moods (ablation
   * switch). The baseline is kept; only the shown mood restarts.
   */
  setExpressionSource(source: ExpressionSource): void {
    if (source === this.#source) return;
    this.#source = source;
    this.#gate = new Hysteresis<Mood>(MOOD_CONFIG.confirm);
  }

  /**
   * Moods switched off in the admin panel: their rule is skipped, so the next
   * matching rule wins (at worst "neutral"). "no-face" cannot be hidden.
   * A hidden mood that is showing now is replaced on the next second, without
   * the confirm delay.
   */
  setHidden(moods: Iterable<Mood>): void {
    this.#hidden = new Set([...moods].filter((m) => m !== 'no-face' && m !== 'neutral'));
    if (this.#shown !== null && this.#hidden.has(this.#shown)) {
      this.#gate = new Hysteresis<Mood>(MOOD_CONFIG.confirm);
    }
  }

  /** Every landmark frame: collects the face measures for the current second. */
  pushFrame(f: MoodFrame): void {
    const s = f.signals;
    if (!f.landmarks || !s || s.iod <= 0 || f.eyesClosed) return;
    if (Math.abs(s.yaw) > MOOD_CONFIG.maxYawDeg || Math.abs(s.pitch) > MOOD_CONFIG.maxPitchDeg) {
      return;
    }
    // Same usable frames as the rules (face, eyes open, head roughly frontal).
    const p = f.expression;
    if (p?.length === EXPRESSION_CLASSES.length && p.every(Number.isFinite)) {
      this.#probFrames.push(p);
    }
    const mesh = { landmarks: f.landmarks, aspect: f.aspect };
    const m: Measures = {
      lift: mouthCornerLift(mesh, s.iod),
      width: mouthWidth(mesh, s.iod),
      browRaise: s.browRaise,
      browGap: s.browInnerGap,
      lipThick: s.lipThickness,
      mouthOpen: s.mouthOpen,
    };
    if (MEASURES.every((k) => Number.isFinite(m[k]))) this.#frames.push(m);
  }

  /** Every finished second from the feature pipeline. */
  pushSecond(s: NormalisedSecond): MoodReading {
    const m = this.#frames.length > 0 ? meanMeasures(this.#frames) : null;
    this.#frames = [];
    const p = this.#probFrames.length > 0 ? meanVectors(this.#probFrames) : null;
    this.#probFrames = [];

    // Face baseline: the same calibration seconds as the pipeline's own baseline.
    if (s.phase === 'calibrating') {
      // A new calibration (the pipeline recalibrated after a long absence):
      // the old seconds describe a different sitting, so start again.
      if (this.#lastPhase === 'ready') this.#base = [];
      this.#baseline = null;
      if (s.valid && m) this.#base.push(m);
    } else if (!this.#baseline && this.#base.length >= MOOD_CONFIG.minBaselineSeconds) {
      this.#baseline = robustBaseline(this.#base);
      this.#base = [];
    }
    this.#lastPhase = s.phase;

    const a = s.aux;
    this.#rows.push({
      startMs: s.startMs,
      valid: s.valid,
      m,
      p,
      closed: s.raw[I.eyes_closed_fraction] ?? 0,
      tired: a.longClosures + a.yawns + a.nods,
      engagement: EngagementEstimator.secondScore(s),
    });
    const keep = Math.max(
      MOOD_CONFIG.drowsyWindowSeconds,
      MOOD_CONFIG.engagementWindowSeconds,
      MOOD_CONFIG.expressionWindowSeconds,
    );
    while (this.#rows.length > keep) this.#rows.shift();

    const { mood, strength, evidence, source } = this.#classify(s.valid);
    const shown = this.#gate.update(mood);
    const endMs = s.startMs + 1000;
    if (shown !== this.#shown) {
      this.#shown = shown;
      this.#sinceMs = s.startMs;
      this.#history.push({ mood: shown, startMs: s.startMs, endMs });
    } else {
      const last = this.#history[this.#history.length - 1];
      if (last) this.#history[this.#history.length - 1] = { ...last, endMs };
    }
    const cutoff = endMs - MOOD_CONFIG.historySeconds * 1000;
    while ((this.#history[0]?.endMs ?? Infinity) < cutoff) this.#history.shift();

    this.#reading = {
      mood: shown,
      sinceMs: this.#sinceMs,
      // Strength belongs to the shown mood; while a change is pending, show it as weak.
      strength: shown === mood ? strength : 0.3,
      evidence,
      calibrating: this.#expression && !this.#zReady(),
      expression: this.#expression,
      source,
    };
    return this.#reading;
  }

  reset(): void {
    this.#frames = [];
    this.#probFrames = [];
    this.#base = [];
    this.#baseline = null;
    this.#lastPhase = null;
    this.#rows = [];
    this.#gate = new Hysteresis<Mood>(MOOD_CONFIG.confirm);
    this.#shown = null;
    this.#history = [];
    this.#reading = null;
  }

  #zReady(): boolean {
    return this.#baseline !== null;
  }

  #classify(valid: boolean): {
    mood: Mood;
    strength: number;
    evidence: MoodEvidence;
    source: ExpressionSource;
  } {
    const c = MOOD_CONFIG;
    const drowsyRows = this.#rows.slice(-c.drowsyWindowSeconds).filter((r) => r.valid);
    const eyesClosed = drowsyRows.length > 0 ? mean(drowsyRows.map((r) => r.closed)) : null;
    const tiredEvents = this.#rows.slice(-c.drowsyWindowSeconds).reduce((n, r) => n + r.tired, 0);
    const engRows = this.#rows.slice(-c.engagementWindowSeconds);
    const onScreen = engRows.length > 0 ? mean(engRows.map((r) => r.engagement)) : null;

    const recent = this.#rows
      .slice(-c.expressionWindowSeconds)
      .flatMap((r) => (r.valid && r.m ? [r.m] : []));
    const b = this.#baseline;
    const useExpr = this.#expression && b !== null && recent.length > 0;
    // Mean of a measure over the expression window, as z against the baseline.
    const z = (k: Measure, sign = 1): number | null =>
      useExpr ? (sign * (mean(recent.map((r) => r[k])) - b.mid[k])) / b.sd[k] : null;
    // Trained model: needs no baseline, only probabilities in the window.
    const recentP = this.#rows
      .slice(-c.expressionWindowSeconds)
      .flatMap((r) => (r.valid && r.p ? [r.p] : []));
    const probs =
      this.#expression && this.#source === 'model' && recentP.length > 0
        ? meanVectors(recentP)
        : null;
    const source: ExpressionSource = probs ? 'model' : 'rules';
    const evidence: MoodEvidence = {
      smile: z('lift'),
      mouthWidth: z('width'),
      browRaise: z('browRaise'),
      browFurrow: z('browGap', -1),
      lipPress: z('lipThick', -1),
      mouthOpen: z('mouthOpen'),
      eyesClosed,
      tiredEvents,
      onScreen,
      model: probs
        ? (Object.fromEntries(EXPRESSION_CLASSES.map((name, i) => [name, probs[i] ?? 0])) as Record<
            ExpressionClass,
            number
          >)
        : null,
    };

    if (!valid) return { mood: 'no-face', strength: 1, evidence, source };
    // Threshold scale: the mood already showing needs less to stay (MOOD_CONFIG.keep).
    const k = (mood: Mood): number => (this.#shown === mood ? c.keep : 1);
    const on = (mood: Mood): boolean => !this.#hidden.has(mood);
    // `over(v, t)`: 0 at the threshold, 1 at twice it, clamped; used as strength.
    const over = (v: number, t: number): number => clamp01(0.4 + (0.6 * (v - t)) / Math.abs(t));

    if (
      on('drowsy') &&
      ((eyesClosed !== null && eyesClosed >= c.drowsyClosedFraction * k('drowsy')) ||
        tiredEvents >= Math.max(1, Math.round(c.drowsyEvents * k('drowsy'))))
    ) {
      const byClosed = eyesClosed === null ? 0 : over(eyesClosed, c.drowsyClosedFraction);
      return {
        mood: 'drowsy',
        strength: Math.max(byClosed, over(tiredEvents, c.drowsyEvents)),
        evidence,
        source,
      };
    }
    const e = evidence;
    const pm = evidence.model;
    if (pm) {
      // Trained model, same order as the rules below.
      const expressionMoods: readonly [Mood, number][] = [
        ['happy', pm.happy],
        ['surprised', pm.surprise],
        ['frustrated', pm.anger + pm.disgust],
        ['sad', pm.sad],
      ];
      for (const [mood, p] of expressionMoods) {
        if (on(mood) && p >= c.modelShow * k(mood)) {
          return { mood, strength: over(p, c.modelShow), evidence, source };
        }
      }
    } else {
      if (on('happy') && e.smile !== null && e.mouthWidth !== null) {
        if (e.smile >= c.smileZ * k('happy') && e.mouthWidth >= c.smileWidthZ * k('happy')) {
          return { mood: 'happy', strength: over(e.smile, c.smileZ), evidence, source };
        }
      }
      if (on('surprised') && e.browRaise !== null && e.mouthOpen !== null) {
        if (
          e.browRaise >= c.surpriseBrowZ * k('surprised') &&
          e.mouthOpen >= c.surpriseMouthZ * k('surprised')
        ) {
          return {
            mood: 'surprised',
            strength: over(e.browRaise, c.surpriseBrowZ),
            evidence,
            source,
          };
        }
      }
      if (on('frustrated') && e.browFurrow !== null && e.lipPress !== null) {
        if (
          e.browFurrow >= c.furrowZ * k('frustrated') &&
          e.lipPress >= c.pressZ * k('frustrated')
        ) {
          return { mood: 'frustrated', strength: over(e.browFurrow, c.furrowZ), evidence, source };
        }
      }
      if (on('sad') && e.smile !== null && e.mouthWidth !== null) {
        if (e.smile <= c.sadCornerZ * k('sad') && e.mouthWidth <= c.sadMaxWidthZ) {
          return { mood: 'sad', strength: over(-e.smile, -c.sadCornerZ), evidence, source };
        }
      }
    }
    if (on('confused') && e.browFurrow !== null && e.browRaise !== null) {
      if (
        e.browFurrow >= c.furrowZ * k('confused') ||
        e.browRaise >= c.confusedRaiseZ * k('confused')
      ) {
        const s = Math.max(over(e.browFurrow, c.furrowZ), over(e.browRaise, c.confusedRaiseZ));
        return { mood: 'confused', strength: s, evidence, source };
      }
    }
    const focusedAt = c.focusedScore - (this.#shown === 'focused' ? c.engagementBand : 0);
    const distractedAt = c.distractedScore + (this.#shown === 'distracted' ? c.engagementBand : 0);
    if (on('focused') && onScreen !== null && onScreen >= focusedAt) {
      return {
        mood: 'focused',
        strength: clamp01((onScreen - c.focusedScore) / (1 - c.focusedScore) + 0.4),
        evidence,
        source,
      };
    }
    if (on('distracted') && onScreen !== null && onScreen < distractedAt) {
      return {
        mood: 'distracted',
        strength: clamp01(1 - onScreen / c.distractedScore + 0.4),
        evidence,
        source,
      };
    }
    // Neutral: strong when every expression signal is quiet (model: its neutral probability).
    const loud = [e.smile, e.browRaise, e.browFurrow, e.lipPress].reduce<number>(
      (m, v) => Math.max(m, v === null ? 0 : Math.abs(v)),
      0,
    );
    const strength = pm ? clamp01(pm.neutral) : clamp01(1 - loud / 2);
    return { mood: 'neutral', strength, evidence, source };
  }
}

function mean(v: readonly number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function meanVectors(rows: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(rows[0]?.length ?? 0);
  for (const r of rows)
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + (r[i] ?? 0);
  for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) / rows.length;
  return out;
}

function meanMeasures(rows: readonly Measures[]): Measures {
  const out = {} as Record<Measure, number>;
  for (const k of MEASURES) out[k] = mean(rows.map((r) => r[k]));
  return out;
}

/** Median and floored robust spread of each measure over the calibration seconds. */
function robustBaseline(rows: readonly Measures[]): { mid: Measures; sd: Measures } {
  const mid = {} as Record<Measure, number>;
  const sd = {} as Record<Measure, number>;
  for (const k of MEASURES) {
    const v = rows.map((r) => r[k]);
    mid[k] = median(v);
    sd[k] = Math.max(MOOD_CONFIG.minSpread[k], robustSd(v));
  }
  return { mid, sd };
}

function median(v: readonly number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** 1.4826 · MAD: a standard deviation that ignores the odd outlier second. */
function robustSd(v: readonly number[]): number {
  const m = median(v);
  return 1.4826 * median(v.map((x) => Math.abs(x - m)));
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
