import { FEATURE_INDEX as I } from '../core/features/spec.js';
import { midpoint, point, type FaceMesh } from '../core/features/geometry.js';
import { EngagementEstimator, HEURISTIC_CONFIG } from '../core/heuristics/index.js';
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
 * Expression rules need z-scores, so they start once the 60 s baseline is
 * ready, and they switch off with the FR3 expression features (ablation).
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
  /** z thresholds against the learner's baseline. */
  smileZ: 1.5,
  smileWidthZ: 0.5,
  sadCornerZ: -1.2,
  sadMaxWidthZ: 0.5,
  surpriseBrowZ: 2,
  surpriseMouthZ: 1.5,
  furrowZ: HEURISTIC_CONFIG.affect.furrowZ,
  pressZ: HEURISTIC_CONFIG.affect.pressZ,
  confusedRaiseZ: HEURISTIC_CONFIG.affect.raiseZ,
  /** Smallest baseline spread (IOD), so a very still calibration does not make z explode. */
  minSpreadLift: 0.01,
  minSpreadWidth: 0.015,
  /** Frames with the head turned further than this are not used for mouth measures. */
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
  readonly signals: { readonly iod: number; readonly yaw: number; readonly pitch: number } | null;
}

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
}

export interface MoodSegment {
  readonly mood: Mood;
  readonly startMs: number;
  readonly endMs: number;
}

interface SecondRow {
  readonly startMs: number;
  readonly valid: boolean;
  readonly lift: number | null;
  readonly width: number | null;
  readonly z: Float32Array | null;
  readonly closed: number;
  readonly tired: number;
  readonly engagement: number;
}

export class MoodEstimator {
  #expression: boolean;
  #frameLift: number[] = [];
  #frameWidth: number[] = [];
  #baseLift: number[] = [];
  #baseWidth: number[] = [];
  #baseline: { lift: number; liftSd: number; width: number; widthSd: number } | null = null;
  #rows: SecondRow[] = [];
  #gate = new Hysteresis<Mood>(MOOD_CONFIG.confirm);
  #shown: Mood | null = null;
  #sinceMs = 0;
  #history: MoodSegment[] = [];
  #reading: MoodReading | null = null;

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

  /** Every landmark frame: collects the mouth measures for the current second. */
  pushFrame(f: MoodFrame): void {
    const s = f.signals;
    if (!f.landmarks || !s || s.iod <= 0) return;
    if (Math.abs(s.yaw) > MOOD_CONFIG.maxYawDeg || Math.abs(s.pitch) > MOOD_CONFIG.maxPitchDeg) {
      return;
    }
    const mesh = { landmarks: f.landmarks, aspect: f.aspect };
    const lift = mouthCornerLift(mesh, s.iod);
    const width = mouthWidth(mesh, s.iod);
    if (Number.isFinite(lift) && Number.isFinite(width)) {
      this.#frameLift.push(lift);
      this.#frameWidth.push(width);
    }
  }

  /** Every finished second from the feature pipeline. */
  pushSecond(s: NormalisedSecond): MoodReading {
    const lift = this.#frameLift.length > 0 ? mean(this.#frameLift) : null;
    const width = this.#frameWidth.length > 0 ? mean(this.#frameWidth) : null;
    this.#frameLift = [];
    this.#frameWidth = [];

    // Mouth baseline: the same calibration seconds as the pipeline's own baseline.
    if (s.phase === 'calibrating') {
      this.#baseline = null;
      if (s.valid && lift !== null && width !== null) {
        this.#baseLift.push(lift);
        this.#baseWidth.push(width);
      }
    } else if (!this.#baseline && this.#baseLift.length >= MOOD_CONFIG.minBaselineSeconds) {
      this.#baseline = {
        lift: median(this.#baseLift),
        liftSd: Math.max(MOOD_CONFIG.minSpreadLift, robustSd(this.#baseLift)),
        width: median(this.#baseWidth),
        widthSd: Math.max(MOOD_CONFIG.minSpreadWidth, robustSd(this.#baseWidth)),
      };
    }

    const a = s.aux;
    this.#rows.push({
      startMs: s.startMs,
      valid: s.valid,
      lift,
      width,
      z: s.z,
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

    const { mood, strength, evidence } = this.#classify(s.valid);
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
    };
    return this.#reading;
  }

  reset(): void {
    this.#frameLift = [];
    this.#frameWidth = [];
    this.#baseLift = [];
    this.#baseWidth = [];
    this.#baseline = null;
    this.#rows = [];
    this.#gate = new Hysteresis<Mood>(MOOD_CONFIG.confirm);
    this.#shown = null;
    this.#history = [];
    this.#reading = null;
  }

  #zReady(): boolean {
    return this.#baseline !== null && this.#rows.some((r) => r.z !== null);
  }

  #classify(valid: boolean): { mood: Mood; strength: number; evidence: MoodEvidence } {
    const c = MOOD_CONFIG;
    const drowsyRows = this.#rows.slice(-c.drowsyWindowSeconds).filter((r) => r.valid);
    const eyesClosed = drowsyRows.length > 0 ? mean(drowsyRows.map((r) => r.closed)) : null;
    const tiredEvents = this.#rows.slice(-c.drowsyWindowSeconds).reduce((n, r) => n + r.tired, 0);
    const engRows = this.#rows.slice(-c.engagementWindowSeconds);
    const onScreen = engRows.length > 0 ? mean(engRows.map((r) => r.engagement)) : null;

    const recent = this.#rows.slice(-c.expressionWindowSeconds).filter((r) => r.valid && r.z);
    const b = this.#baseline;
    const useExpr = this.#expression && b !== null && recent.length > 0;
    const zMean = (index: number, sign = 1): number | null =>
      useExpr ? sign * mean(recent.map((r) => r.z?.[index] ?? 0)) : null;
    const lifts = recent.flatMap((r) => (r.lift === null ? [] : [r.lift]));
    const widths = recent.flatMap((r) => (r.width === null ? [] : [r.width]));
    const smile = useExpr && lifts.length > 0 ? (mean(lifts) - b.lift) / b.liftSd : null;
    const widthZ = useExpr && widths.length > 0 ? (mean(widths) - b.width) / b.widthSd : null;
    const evidence: MoodEvidence = {
      smile,
      mouthWidth: widthZ,
      browRaise: zMean(I.brow_raise_mean),
      browFurrow: zMean(I.brow_inner_gap_mean, -1),
      lipPress: zMean(I.lip_thickness_mean, -1),
      mouthOpen: zMean(I.mouth_open_mean),
      eyesClosed,
      tiredEvents,
      onScreen,
    };

    if (!valid) return { mood: 'no-face', strength: 1, evidence };
    // `over(v, t)`: 0 at the threshold, 1 at twice it, clamped; used as strength.
    const over = (v: number, t: number): number => clamp01(0.4 + (0.6 * (v - t)) / Math.abs(t));

    if (
      (eyesClosed !== null && eyesClosed >= c.drowsyClosedFraction) ||
      tiredEvents >= c.drowsyEvents
    ) {
      const byClosed = eyesClosed === null ? 0 : over(eyesClosed, c.drowsyClosedFraction);
      return {
        mood: 'drowsy',
        strength: Math.max(byClosed, over(tiredEvents, c.drowsyEvents)),
        evidence,
      };
    }
    const e = evidence;
    if (e.smile !== null && e.mouthWidth !== null) {
      if (e.smile >= c.smileZ && e.mouthWidth >= c.smileWidthZ) {
        return { mood: 'happy', strength: over(e.smile, c.smileZ), evidence };
      }
    }
    if (e.browRaise !== null && e.mouthOpen !== null) {
      if (e.browRaise >= c.surpriseBrowZ && e.mouthOpen >= c.surpriseMouthZ) {
        return { mood: 'surprised', strength: over(e.browRaise, c.surpriseBrowZ), evidence };
      }
    }
    if (e.browFurrow !== null && e.lipPress !== null) {
      if (e.browFurrow >= c.furrowZ && e.lipPress >= c.pressZ) {
        return { mood: 'frustrated', strength: over(e.browFurrow, c.furrowZ), evidence };
      }
    }
    if (e.smile !== null && e.mouthWidth !== null) {
      if (e.smile <= c.sadCornerZ && e.mouthWidth <= c.sadMaxWidthZ) {
        return { mood: 'sad', strength: over(-e.smile, -c.sadCornerZ), evidence };
      }
    }
    if (e.browFurrow !== null && e.browRaise !== null) {
      if (e.browFurrow >= c.furrowZ || e.browRaise >= c.confusedRaiseZ) {
        const s = Math.max(over(e.browFurrow, c.furrowZ), over(e.browRaise, c.confusedRaiseZ));
        return { mood: 'confused', strength: s, evidence };
      }
    }
    if (onScreen !== null && onScreen >= c.focusedScore) {
      return {
        mood: 'focused',
        strength: clamp01((onScreen - c.focusedScore) / (1 - c.focusedScore) + 0.4),
        evidence,
      };
    }
    if (onScreen !== null && onScreen < c.distractedScore) {
      return {
        mood: 'distracted',
        strength: clamp01(1 - onScreen / c.distractedScore + 0.4),
        evidence,
      };
    }
    // Neutral: strong when every expression signal is quiet.
    const loud = [e.smile, e.browRaise, e.browFurrow, e.lipPress].reduce<number>(
      (m, v) => Math.max(m, v === null ? 0 : Math.abs(v)),
      0,
    );
    return { mood: 'neutral', strength: clamp01(1 - loud / 2), evidence };
  }
}

function mean(v: readonly number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
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
