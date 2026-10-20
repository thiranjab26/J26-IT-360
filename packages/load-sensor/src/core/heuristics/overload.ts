import { HEURISTIC_MODEL_VERSION } from '../classifier/heuristic.js';
import { Hysteresis } from '../classifier/smoothing.js';
import type { Level, LoadStateEvent } from '../events/types.js';
import { FEATURE_INDEX as I } from '../features/spec.js';
import { yawnProximity } from './boredom.js';
import { HEURISTIC_CONFIG } from './config.js';
import { Rolling, type HeuristicSecond } from './estimators.js';

/**
 * Apparent cognitive overload: a documented heuristic, display only
 * (ARCHITECTURE.md §8c). The right-hand end of the inverted U whose left end
 * is boredom (boredom.ts):
 *
 *   overload = sustained high demand, shown in the face, while at the screen.
 *
 * Evidence is scored in points over the last 30 s (the classifier window),
 * each cue against the learner's own baseline:
 *
 * | cue                                   | measure (below baseline = positive) | points |
 * |---------------------------------------|-------------------------------------|--------|
 * | blink suppression                     | `blink_count`                       | 1      |
 * | brows drawn together (furrow)         | `brow_inner_gap_mean`               | 1      |
 * | lips pressed                          | `lip_thickness_mean`                | 1      |
 * | fixed gaze                            | larger of `gaze_dispersion_x/y`     | 1      |
 * | load mostly High (trained model only) | share of `load_state` High          | 1      |
 *
 * The baseline is this estimator's own, built from the raw values of the
 * calibration seconds: median and robust spread (1.4826·MAD), with a floor
 * on the spread in face units. The pipeline's z-scores divide by the plain
 * calibration SD, which after a very still calibration is near zero, so a
 * sub-pixel shift reads as z ≈ 5 (the same failure the Mood card had,
 * TODO A5 fix 2026-10-18). The floors keep landmark jitter under one spread
 * while a held frown still clears it.
 *
 * `overloaded` at ≥ 3 points, `working_hard` at 2, else `manageable`.
 * Fewer blinks, a furrowed brow, pressed lips and a narrowed gaze are the
 * facial signs most often reported with high mental effort; two of them is
 * effort, three or more together is read as more than the learner can
 * comfortably handle. These are design choices to be checked against
 * NASA-TLX in the pilot (B1), not validated cut-offs.
 *
 * The load point counts only when load comes from a trained model. The
 * `heuristic-0` placeholder is itself built from blinks, brow gap and lip
 * thickness, so counting it too would score the same evidence twice, and it
 * reads posture changes as High (seen live 2026-10-20).
 *
 * Seconds looking away from the screen and seconds around a yawn are left
 * out: both move the face for reasons other than effort. With too few
 * seconds left, the learner reads as `manageable` with the `away` flag.
 *
 * Lip press is an expression feature: with expression features off (FR3
 * ablation) the pipeline zeroes it, so the cue never scores. Not in `LoadStateEvent`:
 * adding it is a contract change (CLAUDE.md invariant 5).
 */
export type OverloadState = 'overloaded' | 'working_hard' | 'manageable';

/** The event-stream fields the estimator reads, one per finished second. */
export type OverloadSignals = Pick<LoadStateEvent, 'load_state' | 'meta'>;

/** Every cue as "positive = towards overload", for the evidence rows. */
export interface OverloadEvidence {
  /** Blinks below baseline, in baseline spreads: positive = fewer blinks. */
  readonly blinkSuppression: number;
  /** Inner-brow gap below baseline, in spreads: positive = brows closer. */
  readonly browFurrow: number;
  /** Lip thickness below baseline, in spreads: positive = lips pressed. */
  readonly lipPress: number;
  /** Gaze dispersion below baseline, in spreads: positive = steadier gaze. */
  readonly gazeFixation: number;
  /** Share of window seconds with published load High (0..1). */
  readonly highLoad: number;
  /** Share of window seconds looking away from the screen (0..1). */
  readonly offScreen: number;
  /** Valid, on-screen, yawn-free seconds the face cues were averaged over. */
  readonly seconds: number;
}

type Measure = 'blinks' | 'browGap' | 'lipThickness' | 'gazeDispersion';
const MEASURES: readonly Measure[] = ['blinks', 'browGap', 'lipThickness', 'gazeDispersion'];

/** Per-measure centre and spread from the calibration seconds. */
export interface OverloadBaseline {
  readonly centre: Readonly<Record<Measure, number>>;
  readonly spread: Readonly<Record<Measure, number>>;
}

function measures(s: HeuristicSecond): Record<Measure, number> {
  return {
    blinks: s.raw[I.blink_count] ?? 0,
    browGap: s.raw[I.brow_inner_gap_mean] ?? 0,
    lipThickness: s.raw[I.lip_thickness_mean] ?? 0,
    gazeDispersion: Math.max(s.raw[I.gaze_dispersion_x] ?? 0, s.raw[I.gaze_dispersion_y] ?? 0),
  };
}

export interface OverloadCues {
  readonly blinkSuppression: boolean;
  readonly browFurrow: boolean;
  readonly lipPress: boolean;
  readonly gazeFixation: boolean;
  readonly highLoad: boolean;
}

export interface OverloadReading {
  /** null: no estimate now (calibrating, no face this second, or sensing off). */
  readonly state: OverloadState | null;
  /** Evidence points (0..5). */
  readonly points: number;
  readonly cues: OverloadCues;
  /** Too few seconds at the screen to judge; shown as `manageable`. */
  readonly away: boolean;
  /** Whether the load point may count (trained model only). */
  readonly loadPointActive: boolean;
  readonly evidence: OverloadEvidence;
}

interface Entry {
  readonly s: HeuristicSecond;
  readonly load: Level | null;
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function median(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? (v[m] ?? 0) : ((v[m - 1] ?? 0) + (v[m] ?? 0)) / 2;
}

/**
 * Baseline from calibration seconds. Blinks are counts per second (mostly 0
 * or 1), where median and MAD collapse to 0, so they use mean and SD; the
 * face measures use median and 1.4826·MAD. Every spread has a floor.
 */
export function overloadBaseline(rows: readonly HeuristicSecond[]): OverloadBaseline | null {
  if (rows.length === 0) return null;
  const floor = HEURISTIC_CONFIG.overload.minSpread;
  const centre = {} as Record<Measure, number>;
  const spread = {} as Record<Measure, number>;
  for (const k of MEASURES) {
    const v = rows.map((r) => measures(r)[k]);
    if (k === 'blinks') {
      const m = mean(v);
      centre[k] = m;
      spread[k] = Math.max(floor[k], Math.sqrt(mean(v.map((x) => (x - m) ** 2))));
    } else {
      const m = median(v);
      centre[k] = m;
      spread[k] = Math.max(floor[k], 1.4826 * median(v.map((x) => Math.abs(x - m))));
    }
  }
  return { centre, spread };
}

export class OverloadEstimator {
  readonly #cfg = HEURISTIC_CONFIG.overload;
  // Room for a yawn that ends just after the window to still mask its start.
  readonly #seconds = new Rolling<Entry>(
    this.#cfg.windowSeconds + HEURISTIC_CONFIG.boredom.yawnMaskBeforeSeconds,
  );
  readonly #gate = new Hysteresis<OverloadState>(this.#cfg.confirm);
  /** Raw calibration seconds, until the baseline is frozen. */
  #calibration: HeuristicSecond[] = [];
  #baseline: OverloadBaseline | null = null;

  get baseline(): OverloadBaseline | null {
    return this.#baseline;
  }

  /** Feed once per finished second with the latest published event fields. */
  update(s: HeuristicSecond, signals: OverloadSignals): OverloadReading {
    const c = this.#cfg;
    if (s.z === null) {
      // Calibrating (again, if the pipeline recollects its baseline after a
      // long absence): collect raw seconds for a fresh baseline.
      if (this.#baseline) this.reset();
      if (s.valid) this.#calibration.push(s);
    } else if (!this.#baseline) {
      this.#baseline = overloadBaseline(this.#calibration);
      this.#calibration = [];
    }
    this.#seconds.push({ s, load: signals.load_state });
    const evidence = OverloadEstimator.evidence(
      this.#seconds.last(),
      this.#baseline,
      c.windowSeconds,
    );
    const version = signals.meta?.model_version;
    const loadPointActive = version !== undefined && version !== HEURISTIC_MODEL_VERSION;
    const enough = evidence.seconds >= c.minCueSeconds;
    const cues: OverloadCues = {
      blinkSuppression: enough && evidence.blinkSuppression >= c.blinkSuppressionZ,
      browFurrow: enough && evidence.browFurrow >= c.browFurrowZ,
      lipPress: enough && evidence.lipPress >= c.lipPressZ,
      gazeFixation: enough && evidence.gazeFixation >= c.gazeFixationZ,
      highLoad: loadPointActive && evidence.highLoad >= c.highLoadShare,
    };
    const points =
      Number(cues.blinkSuppression) +
      Number(cues.browFurrow) +
      Number(cues.lipPress) +
      Number(cues.gazeFixation) +
      Number(cues.highLoad);
    const away = !enough && evidence.offScreen >= c.awayShare;

    // Calibrating (no baseline yet) or no face this second: say nothing.
    if (s.z === null || !s.valid || !this.#baseline) {
      return { state: null, points, cues, away, loadPointActive, evidence };
    }
    let candidate: OverloadState = 'manageable';
    if (!away) {
      if (points >= c.overloadedPoints) candidate = 'overloaded';
      else if (points >= c.workingHardPoints) candidate = 'working_hard';
    }
    return {
      state: this.#gate.update(candidate),
      points,
      cues,
      away,
      loadPointActive,
      evidence,
    };
  }

  /**
   * Cue measurements over the last `windowSeconds` of `entries` (oldest
   * first; earlier entries only serve the yawn mask). Exported for tests and
   * the method section.
   */
  static evidence(
    entries: readonly Entry[],
    baseline: OverloadBaseline | null,
    windowSeconds: number = entries.length,
  ): OverloadEvidence {
    const c = HEURISTIC_CONFIG.overload;
    const near = yawnProximity(entries, HEURISTIC_CONFIG.boredom.yawnMaskBeforeSeconds);
    const blink: number[] = [];
    const furrow: number[] = [];
    const press: number[] = [];
    const fixation: number[] = [];
    let high = 0;
    let away = 0;
    const start = Math.max(0, entries.length - windowSeconds);
    for (let i = start; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry) continue;
      const { s, load } = entry;
      if (load === 'High') high += 1;
      if (s.valid && s.aux.offScreenFraction >= c.offScreenSecond) {
        away += 1;
        continue;
      }
      if (!baseline || !s.valid || !s.z) continue;
      if (near(i, HEURISTIC_CONFIG.boredom.yawnMaskAfterSeconds)) continue;
      const m = measures(s);
      // Below baseline, in baseline spreads: positive = towards overload.
      const below = (k: Measure): number => (baseline.centre[k] - m[k]) / baseline.spread[k];
      blink.push(below('blinks'));
      furrow.push(below('browGap'));
      press.push(below('lipThickness'));
      fixation.push(below('gazeDispersion'));
    }
    const n = Math.max(1, entries.length - start);
    return {
      blinkSuppression: mean(blink),
      browFurrow: mean(furrow),
      lipPress: mean(press),
      gazeFixation: mean(fixation),
      highLoad: high / n,
      offScreen: away / n,
      seconds: blink.length,
    };
  }

  reset(): void {
    this.#seconds.clear();
    this.#gate.reset();
    this.#calibration = [];
    this.#baseline = null;
  }
}
