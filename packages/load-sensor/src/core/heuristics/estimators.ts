import { Hysteresis } from '../classifier/smoothing.js';
import type { AffectState, Level } from '../events/types.js';
import { FEATURE_INDEX as I } from '../features/spec.js';
import type { NormalisedSecond } from '../window/feature-pipeline.js';
import { HEURISTIC_CONFIG } from './config.js';

/** What the heuristics read from each finished second. Numbers only. */
export type HeuristicSecond = Pick<NormalisedSecond, 'valid' | 'validRatio' | 'raw' | 'z' | 'aux'>;

/**
 * The last `capacity` values, oldest first. Fixed memory over a long session
 * (NFR6): the longest window here is 300 entries.
 */
export class Rolling<T> {
  readonly #items: (T | undefined)[];
  #next = 0;
  #size = 0;

  constructor(readonly capacity: number) {
    this.#items = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.#size;
  }

  push(item: T): void {
    this.#items[this.#next] = item;
    this.#next = (this.#next + 1) % this.capacity;
    this.#size = Math.min(this.#size + 1, this.capacity);
  }

  /** Items from the most recent `count` (default all), oldest first. */
  last(count: number = this.#size): T[] {
    const n = Math.min(count, this.#size);
    const out: T[] = [];
    for (let k = n; k >= 1; k -= 1) {
      const item = this.#items[(this.#next - k + this.capacity) % this.capacity];
      if (item !== undefined) out.push(item);
    }
    return out;
  }

  clear(): void {
    this.#items.fill(undefined);
    this.#next = 0;
    this.#size = 0;
  }
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function levelFrom(value: number, low: number, high: number): Level {
  if (value >= high) return 'High';
  if (value < low) return 'Low';
  return 'Medium';
}

/**
 * `engagement` (§7): is the learner at the screen and looking at it?
 * Built from face-present ratio, head/gaze on-screen share and gaze-centred
 * share; no ground truth exists for it (state this in the report).
 */
export class EngagementEstimator {
  readonly #cfg = HEURISTIC_CONFIG.engagement;
  readonly #scores = new Rolling<number>(this.#cfg.windowSeconds);
  readonly #gate = new Hysteresis<Level>(this.#cfg.confirm);

  /** Per-second score in 0..1; exported for tests and the report's method section. */
  static secondScore(s: HeuristicSecond): number {
    if (s.validRatio <= 0) return 0;
    const onScreen = 1 - s.aux.offScreenFraction;
    const centred = s.raw[I.gaze_centred_fraction] ?? 0;
    return s.validRatio * (0.5 * onScreen + 0.5 * centred);
  }

  update(s: HeuristicSecond): Level {
    this.#scores.push(EngagementEstimator.secondScore(s));
    const score = mean(this.#scores.last());
    return this.#gate.update(levelFrom(score, this.#cfg.low, this.#cfg.high));
  }

  reset(): void {
    this.#scores.clear();
    this.#gate.reset();
  }
}

/** Mean of −z over the last valid seconds for one feature (positive = below baseline). */
function meanNegZ(rows: readonly HeuristicSecond[], index: number): number {
  const values: number[] = [];
  for (const r of rows) if (r.valid && r.z) values.push(-(r.z[index] ?? 0));
  return mean(values);
}

/**
 * `frustration` (§7): High load sustained, together with inner brows drawn
 * together or lips pressed relative to baseline. Checkable against the
 * NASA-TLX Frustration subscale in the pilot.
 */
export class FrustrationEstimator {
  readonly #cfg = HEURISTIC_CONFIG.frustration;
  readonly #useExpression: boolean;
  readonly #recent = new Rolling<HeuristicSecond>(this.#cfg.expressionWindowSeconds);
  #highSeconds = 0;

  constructor(useExpressionFeatures = true) {
    this.#useExpression = useExpressionFeatures;
  }

  update(s: HeuristicSecond, load: Level | null): boolean {
    this.#recent.push(s);
    this.#highSeconds = load === 'High' ? this.#highSeconds + 1 : 0;
    if (this.#highSeconds < this.#cfg.sustainedHighSeconds) return false;
    const rows = this.#recent.last();
    const furrow = meanNegZ(rows, I.brow_inner_gap_mean);
    const press = this.#useExpression ? meanNegZ(rows, I.lip_thickness_mean) : 0;
    return furrow >= this.#cfg.furrowZ || press >= this.#cfg.pressZ;
  }

  reset(): void {
    this.#recent.clear();
    this.#highSeconds = 0;
  }
}

/**
 * `fatigue` (§8a): drowsiness indicators from driver-monitoring work: PERCLOS
 * proxy, long eye closures, yawns, head nods. Points add up to a level.
 * Says "drowsy", never "asleep": a webcam cannot tell.
 */
export class FatigueEstimator {
  readonly #cfg = HEURISTIC_CONFIG.fatigue;
  readonly #seconds = new Rolling<HeuristicSecond>(
    Math.max(this.#cfg.perclosSeconds, this.#cfg.eventSeconds),
  );
  readonly #gate = new Hysteresis<Level>(this.#cfg.confirm);

  /** Points before thresholds, exported for tests. */
  points(): number {
    const c = this.#cfg;
    const recent = this.#seconds.last(c.perclosSeconds);
    const all = this.#seconds.last(c.eventSeconds);

    const closed: number[] = [];
    let longClosures = 0;
    for (const r of recent) {
      if (r.valid) closed.push(r.raw[I.eyes_closed_fraction] ?? 0);
      longClosures += r.aux.longClosures;
    }
    let yawns = 0;
    let nods = 0;
    for (const r of all) {
      yawns += r.aux.yawns;
      nods += r.aux.nods;
    }
    const perclos = mean(closed);

    let points = 0;
    if (perclos >= c.perclosHigh) points += 2;
    else if (perclos >= c.perclosMedium) points += 1;
    if (longClosures >= c.longClosuresMedium) points += 1;
    if (yawns >= c.yawnsHigh) points += 2;
    else if (yawns >= c.yawnsMedium) points += 1;
    if (nods >= c.nodsHigh) points += 2;
    else if (nods >= c.nodsMedium) points += 1;
    return points;
  }

  update(s: HeuristicSecond): Level {
    this.#seconds.push(s);
    const p = this.points();
    const c = this.#cfg;
    const level: Level = p >= c.pointsHigh ? 'High' : p >= c.pointsMedium ? 'Medium' : 'Low';
    return this.#gate.update(level);
  }

  reset(): void {
    this.#seconds.clear();
    this.#gate.reset();
  }
}

/**
 * `affect` (§8a): coarse mood from expression proxies against the learner's
 * own baseline. Weak by design. `frustrated` here is expression only; the
 * contract's `frustration` boolean also requires sustained High load.
 *
 * - frustrated: brows drawn together and lips pressed;
 * - confused:   brows drawn together without pressed lips, or brows raised;
 * - neutral:    otherwise.
 */
export class AffectEstimator {
  readonly #cfg = HEURISTIC_CONFIG.affect;
  readonly #recent = new Rolling<HeuristicSecond>(this.#cfg.windowSeconds);
  readonly #gate = new Hysteresis<AffectState>(this.#cfg.confirm);

  update(s: HeuristicSecond): AffectState {
    this.#recent.push(s);
    const rows = this.#recent.last();
    const furrow = meanNegZ(rows, I.brow_inner_gap_mean);
    const press = meanNegZ(rows, I.lip_thickness_mean);
    const raise = -meanNegZ(rows, I.brow_raise_mean);
    const c = this.#cfg;
    let affect: AffectState = 'neutral';
    if (furrow >= c.furrowZ && press >= c.pressZ) affect = 'frustrated';
    else if (furrow >= c.furrowZ || raise >= c.raiseZ) affect = 'confused';
    return this.#gate.update(affect);
  }

  reset(): void {
    this.#recent.clear();
    this.#gate.reset();
  }
}
