import { HEURISTIC_MODEL_VERSION } from '../classifier/heuristic.js';
import { Hysteresis } from '../classifier/smoothing.js';
import type { Level, LoadStateEvent } from '../events/types.js';
import { FEATURE_INDEX as I } from '../features/spec.js';
import { HEURISTIC_CONFIG } from './config.js';
import { Rolling, type HeuristicSecond } from './estimators.js';

/**
 * Apparent boredom: a documented heuristic, display only (ARCHITECTURE.md §8b).
 *
 *   boredom = low demand + disengagement, with alert eyes.
 *
 * Load sits on an inverted U: too little demand (boredom), a workable amount,
 * too much (overload). Boredom in learning is usually described as low
 * arousal with attention drifting away from the task, and yawning, looking
 * away and restless movement are the behaviours most often reported with it.
 *
 * Evidence is scored in points; each cue is measured against the learner's
 * own baseline where it can be:
 *
 * | cue                                   | window | points |
 * |---------------------------------------|--------|--------|
 * | yawns (eyes otherwise alert)          | 5 min  | 1 / 2 / 3 for 1 / 2 / 3+ |
 * | published load mostly Low (underload) | 60 s   | 1 |
 * | engagement mostly Low                 | 60 s   | 1 |
 * | gaze wandering (dispersion z)         | 60 s   | 1 |
 * | restless head (angular speed z)       | 60 s   | 1 |
 *
 * `bored` at ≥ 3 points, `possibly_bored` at ≥ 2. So by yawning alone: one
 * yawn is not enough (people yawn when interested too), two in 5 min read as
 * possibly bored, three or more as bored. One yawn plus one other cue reads
 * as possibly bored; without yawns it takes three behavioural cues. Why
 * these counts: see `HEURISTIC_CONFIG.boredom.yawnPoints`.
 *
 * Two vetoes come first:
 * - drowsy eyes (PERCLOS proxy or a head nod) → `tired`. Yawning is shared
 *   by boredom and sleepiness; the eyes tell them apart, and the two need
 *   different help (a break, not a harder task). The eyes squeeze shut
 *   during a yawn, so seconds around each yawn are left out of the measure,
 *   and long closures are not used.
 * - load mostly High → `not_bored`: the overload side of the U. Only with
 *   a trained load model; off while load comes from `heuristic-0`. Load
 *   published while a yawn is still in the classifier window is left out:
 *   the yawn itself reads as High to the placeholder classifier.
 *
 * Low load is a point, not a gate: the placeholder classifier `heuristic-0`
 * rarely publishes Low, and a hard gate made boredom unreachable. Revisit
 * once the trained model ships.
 *
 * The cues are not independent (looking away lowers engagement and raises
 * gaze dispersion). Not in `LoadStateEvent`: adding it is a contract change
 * (CLAUDE.md invariant 5).
 */
export type BoredomState = 'bored' | 'possibly_bored' | 'not_bored' | 'tired';

/** Why the points were overruled, if they were. */
export type BoredomVeto = 'drowsy' | 'working_hard';

/** The event-stream fields the estimator reads, one per finished second. */
export type BoredomSignals = Pick<LoadStateEvent, 'load_state' | 'engagement' | 'meta'>;

/** What each cue measured, for the evidence rows and the method section. */
export interface BoredomEvidence {
  /** Yawns in the yawn window. */
  readonly yawns: number;
  /** Share of the last 60 s with published load Low / High (0..1). */
  readonly underload: number;
  readonly highLoad: number;
  /** Share of the last 60 s with engagement Low (0..1). */
  readonly lowEngagement: number;
  /** Mean z of the larger gaze dispersion axis over valid seconds. */
  readonly gazeWander: number;
  /** Mean z of head angular speed over valid seconds. */
  readonly fidget: number;
  /** Mean eyes-closed fraction over valid seconds of the last 60 s (PERCLOS proxy). */
  readonly perclos: number;
  /** Head nods in the yawn window. */
  readonly nods: number;
}

export interface BoredomCues {
  readonly yawn: boolean;
  readonly underload: boolean;
  readonly lowEngagement: boolean;
  readonly gazeWander: boolean;
  readonly fidget: boolean;
}

export interface BoredomReading {
  /** null: no estimate now (calibrating, no face this second, or sensing off). */
  readonly state: BoredomState | null;
  /** Evidence points before vetoes (0..7). */
  readonly points: number;
  readonly cues: BoredomCues;
  readonly veto: BoredomVeto | null;
  /**
   * Whether the busy veto may apply: only when load comes from a trained
   * model. Off while `meta.model_version` is the `heuristic-0` placeholder.
   */
  readonly busyVetoActive: boolean;
  readonly evidence: BoredomEvidence;
}

export interface BoredomEntry {
  readonly s: HeuristicSecond;
  readonly load: Level | null;
  readonly engagement: Level | null;
}

/**
 * For one-per-second `events` (oldest first): is second `i` within `before`
 * seconds before, or `after` seconds after, the end of a yawn? A yawn moves
 * the eyes, brows, lips and head, so heuristics leave these seconds out.
 */
export function yawnProximity(
  events: readonly { readonly s: HeuristicSecond }[],
  before: number,
): (i: number, after: number) => boolean {
  const ends: number[] = [];
  events.forEach(({ s }, i) => {
    if (s.aux.yawns > 0) ends.push(i);
  });
  return (i, after) => ends.some((j) => i >= j - before && i <= j + after);
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export class BoredomEstimator {
  readonly #cfg = HEURISTIC_CONFIG.boredom;
  readonly #seconds = new Rolling<BoredomEntry>(
    Math.max(this.#cfg.windowSeconds, this.#cfg.eventWindowSeconds),
  );
  readonly #gate = new Hysteresis<BoredomState>(this.#cfg.confirm);

  /** Feed once per finished second with the latest published event fields. */
  update(s: HeuristicSecond, signals: BoredomSignals): BoredomReading {
    const c = this.#cfg;
    this.#seconds.push({ s, load: signals.load_state, engagement: signals.engagement });
    const evidence = BoredomEstimator.evidence(
      this.#seconds.last(c.eventWindowSeconds),
      c.windowSeconds,
    );
    const cues: BoredomCues = {
      yawn: evidence.yawns >= 1,
      underload: evidence.underload >= c.underloadShare,
      lowEngagement: evidence.lowEngagement >= c.lowEngagementShare,
      gazeWander: evidence.gazeWander >= c.gazeWanderZ,
      fidget: evidence.fidget >= c.fidgetZ,
    };
    const points =
      BoredomEstimator.yawnPoints(evidence.yawns) +
      Number(cues.underload) +
      Number(cues.lowEngagement) +
      Number(cues.gazeWander) +
      Number(cues.fidget);
    // The busy veto trusts the load estimate over direct behaviour, so it
    // needs a trained model. `heuristic-0` is an unvalidated placeholder and
    // reads posture changes as High load: leaning back with the head low
    // gave 88 % High and vetoed four yawns (seen live 2026-10-20).
    const version = signals.meta?.model_version;
    const busyVetoActive = version !== undefined && version !== HEURISTIC_MODEL_VERSION;
    const veto: BoredomVeto | null =
      evidence.perclos >= c.drowsyPerclos || evidence.nods >= c.drowsyNods
        ? 'drowsy'
        : busyVetoActive && evidence.highLoad >= c.highLoadShare
          ? 'working_hard'
          : null;
    // Calibrating (no baseline yet) or no face this second: say nothing
    // rather than guess. A missing load estimate is fine: it only removes
    // the underload point and the busy veto.
    if (s.z === null || !s.valid) {
      return { state: null, points, cues, veto, busyVetoActive, evidence };
    }
    let candidate: BoredomState;
    if (veto === 'drowsy') candidate = 'tired';
    else if (veto === 'working_hard') candidate = 'not_bored';
    else if (points >= c.boredPoints) candidate = 'bored';
    else if (points >= c.possiblyBoredPoints) candidate = 'possibly_bored';
    else candidate = 'not_bored';
    return { state: this.#gate.update(candidate), points, cues, veto, busyVetoActive, evidence };
  }

  /** Points earned by `yawns` yawns in the event window (config `yawnPoints`). */
  static yawnPoints(yawns: number): number {
    const table = HEURISTIC_CONFIG.boredom.yawnPoints;
    if (yawns < 1) return 0;
    return table[Math.min(yawns, table.length) - 1] ?? 0;
  }

  /**
   * Cue measurements over `events` (oldest first, up to the 5-min event
   * window): yawns and nods over all of it, the continuous cues over its last
   * `windowSeconds`. Seconds near a yawn are left out of the eyes-closed,
   * gaze and head measures and the High-load share (config `yawnMask…`, `yawnLoadSeconds`).
   * Exported for tests and the method section.
   */
  static evidence(
    events: readonly BoredomEntry[],
    windowSeconds: number = events.length,
  ): BoredomEvidence {
    const c = HEURISTIC_CONFIG.boredom;
    const near = yawnProximity(events, c.yawnMaskBeforeSeconds);

    const wander: number[] = [];
    const fidget: number[] = [];
    const closed: number[] = [];
    let low = 0;
    let high = 0;
    let loadCounted = 0;
    let disengaged = 0;
    const start = Math.max(0, events.length - windowSeconds);
    for (let i = start; i < events.length; i += 1) {
      const entry = events[i];
      if (!entry) continue;
      const { s, load, engagement } = entry;
      if (load === 'Low') low += 1;
      if (!near(i, c.yawnLoadSeconds)) {
        loadCounted += 1;
        if (load === 'High') high += 1;
      }
      if (engagement === 'Low') disengaged += 1;
      if (!s.valid) continue;
      // A yawn moves everything: eyes shut, irises jump while squinting, head
      // tips back. Its seconds would count as drowsy eyes, wandering gaze and
      // a restless head, so they are left out; the yawn counts once, as a yawn.
      if (near(i, c.yawnMaskAfterSeconds)) continue;
      closed.push(s.raw[I.eyes_closed_fraction] ?? 0);
      if (!s.z) continue;
      wander.push(Math.max(s.z[I.gaze_dispersion_x] ?? 0, s.z[I.gaze_dispersion_y] ?? 0));
      fidget.push(s.z[I.head_angular_speed] ?? 0);
    }
    let yawns = 0;
    let nods = 0;
    for (const { s } of events) {
      yawns += s.aux.yawns;
      nods += s.aux.nods;
    }
    const n = Math.max(1, events.length - start);
    return {
      yawns,
      underload: low / n,
      highLoad: loadCounted > 0 ? high / loadCounted : 0,
      lowEngagement: disengaged / n,
      // Too few baseline-normalised seconds (just after calibration): no point yet.
      gazeWander: wander.length >= c.minCueSeconds ? mean(wander) : 0,
      fidget: fidget.length >= c.minCueSeconds ? mean(fidget) : 0,
      perclos: mean(closed),
      nods,
    };
  }

  reset(): void {
    this.#seconds.clear();
    this.#gate.reset();
  }
}
