import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT, FEATURE_INDEX as I } from '../../../src/core/features/index.js';
import {
  HEURISTIC_CONFIG,
  OverloadEstimator,
  overloadBaseline,
  type HeuristicSecond,
  type OverloadReading,
  type OverloadSignals,
} from '../../../src/core/heuristics/index.js';

type Named = Partial<Record<keyof typeof I, number>>;

/** A calm face at the screen: brow gap 0.60 IOD, lips 0.20 IOD, gaze dispersion 0.03. */
const NEUTRAL: Named = {
  blink_count: 0,
  brow_inner_gap_mean: 0.6,
  lip_thickness_mean: 0.2,
  gaze_dispersion_x: 0.03,
  gaze_dispersion_y: 0.02,
};

function second(
  opts: {
    valid?: boolean;
    calibrating?: boolean;
    raw?: Named;
    aux?: Partial<HeuristicSecond['aux']>;
  } = {},
): HeuristicSecond {
  const vec = (named: Named): Float32Array => {
    const v = new Float32Array(FEATURE_COUNT);
    for (const [k, x] of Object.entries(named)) v[I[k as keyof typeof I]] = x;
    return v;
  };
  const valid = opts.valid ?? true;
  return {
    valid,
    validRatio: valid ? 1 : 0,
    raw: vec({ ...NEUTRAL, ...opts.raw }),
    // The estimator only checks whether z exists (baseline ready); values unused.
    z: opts.calibrating || !valid ? null : vec({}),
    aux: {
      longClosures: 0,
      yawns: 0,
      nods: 0,
      offScreenFraction: 0,
      faceSize: 0.1,
      ...opts.aux,
    },
  };
}

const PLACEHOLDER = { fps: 15, backend: 'webgl', model_version: 'heuristic-0' };
const TRAINED = { fps: 15, backend: 'webgl', model_version: 'cnn-gru-test' };
const signals = (s: Partial<OverloadSignals> = {}): OverloadSignals => ({
  load_state: 'Medium',
  meta: PLACEHOLDER,
  ...s,
});

const C = HEURISTIC_CONFIG.overload;

function feed(
  o: OverloadEstimator,
  n: number,
  make: (i: number) => HeuristicSecond,
  sig: OverloadSignals = signals(),
): OverloadReading {
  let out!: OverloadReading;
  for (let i = 0; i < n; i += 1) out = o.update(make(i), sig);
  return out;
}

/** 30 s calibration with a blink every 3 s (20/min), as a learner sits normally. */
function calibrated(): OverloadEstimator {
  const o = new OverloadEstimator();
  feed(o, 30, (i) => second({ calibrating: true, raw: { blink_count: i % 3 === 0 ? 1 : 0 } }), {
    load_state: null,
  });
  return o;
}

/** Normal studying: same blink rate as calibration, neutral face. */
const normal = (i: number): HeuristicSecond =>
  second({ raw: { blink_count: i % 3 === 0 ? 1 : 0 } });

/** Concentrating hard: no blinks, brows drawn in, lips pressed, gaze fixed. */
const strained = (): HeuristicSecond =>
  second({
    raw: {
      blink_count: 0,
      brow_inner_gap_mean: 0.55,
      lip_thickness_mean: 0.15,
      gaze_dispersion_x: 0.005,
      gaze_dispersion_y: 0.005,
    },
  });

describe('overload heuristic (§8c)', () => {
  it('no reading while calibrating; manageable once calibration ends', () => {
    const o = new OverloadEstimator();
    const r = feed(o, 30, () => second({ calibrating: true }), { load_state: null });
    expect(r.state).toBeNull();
    expect(o.update(normal(0), signals({ load_state: null })).state).toBe('manageable');
  });

  it('manageable for normal studying', () => {
    const o = calibrated();
    const r = feed(o, C.windowSeconds, normal);
    expect(r.points).toBe(0);
    expect(r.state).toBe('manageable');
  });

  it('overloaded when blinks drop, brows furrow, lips press and gaze fixes', () => {
    const o = calibrated();
    const r = feed(o, C.windowSeconds, strained);
    expect(r.cues).toMatchObject({
      blinkSuppression: true,
      browFurrow: true,
      lipPress: true,
      gazeFixation: true,
    });
    expect(r.points).toBe(4);
    expect(r.state).toBe('overloaded');
  });

  it('working hard with two cues', () => {
    const o = calibrated();
    const twoCues = (): HeuristicSecond =>
      second({ raw: { blink_count: 0, brow_inner_gap_mean: 0.55 } });
    const r = feed(o, C.windowSeconds, twoCues);
    expect(r.points).toBe(2);
    expect(r.state).toBe('working_hard');
  });

  it('face cues need minCueSeconds before scoring', () => {
    const o = calibrated();
    expect(feed(o, C.minCueSeconds - 1, strained).points).toBe(0);
    expect(o.update(strained(), signals()).points).toBeGreaterThan(0);
  });

  it('landmark jitter after a very still calibration does not read as a frown (spread floor)', () => {
    const o = new OverloadEstimator();
    // Perfectly still calibration: zero spread in every face measure.
    feed(o, 30, () => second({ calibrating: true }), { load_state: null });
    // Jitter of ±0.01 IOD, half the 0.02 floor.
    const jitter = (i: number): HeuristicSecond =>
      second({
        raw: {
          brow_inner_gap_mean: 0.6 - (i % 2) * 0.01,
          lip_thickness_mean: 0.2 - (i % 2) * 0.01,
        },
      });
    const r = feed(o, C.windowSeconds, jitter);
    expect(r.cues.browFurrow).toBe(false);
    expect(r.cues.lipPress).toBe(false);
  });

  it('the heuristic-0 load does not add a point (it is built from the same cues)', () => {
    const o = calibrated();
    const r = feed(o, C.windowSeconds, normal, signals({ load_state: 'High' }));
    expect(r.loadPointActive).toBe(false);
    expect(r.cues.highLoad).toBe(false);
    expect(r.state).toBe('manageable');
  });

  it('a trained model reporting High load adds a point', () => {
    const o = calibrated();
    const furrowOnly = (i: number): HeuristicSecond =>
      second({ raw: { blink_count: i % 3 === 0 ? 1 : 0, brow_inner_gap_mean: 0.55 } });
    const r = feed(o, C.windowSeconds, furrowOnly, signals({ load_state: 'High', meta: TRAINED }));
    expect(r.loadPointActive).toBe(true);
    expect(r.points).toBe(2);
    expect(r.state).toBe('working_hard');
  });

  it('looking away from the screen is not overload', () => {
    const o = calibrated();
    const away = (): HeuristicSecond =>
      second({
        raw: { brow_inner_gap_mean: 0.5, lip_thickness_mean: 0.1 },
        aux: { offScreenFraction: 1 },
      });
    const r = feed(o, C.windowSeconds, away);
    expect(r.away).toBe(true);
    expect(r.points).toBe(0);
    expect(r.state).toBe('manageable');
  });

  it('a yawn does not read as pressed lips or a fixed gaze', () => {
    const o = calibrated();
    feed(o, C.windowSeconds, normal);
    // Stretched lips and squinting for 6 s, ending in a yawn.
    const yawning = (yawns: number): HeuristicSecond =>
      second({
        raw: { lip_thickness_mean: 0.08, gaze_dispersion_x: 0, gaze_dispersion_y: 0 },
        aux: { yawns },
      });
    for (let i = 0; i < 5; i += 1) o.update(yawning(0), signals());
    o.update(yawning(1), signals());
    const r = feed(o, 3, normal);
    expect(r.cues.lipPress).toBe(false);
    expect(r.cues.gazeFixation).toBe(false);
    expect(r.state).toBe('manageable');
  });

  it('a recalibration builds a fresh baseline', () => {
    const o = calibrated();
    feed(o, C.windowSeconds, normal);
    const first = o.baseline;
    // Pipeline recollects its baseline (z null again) with a new face position.
    feed(o, 30, () => second({ calibrating: true, raw: { brow_inner_gap_mean: 0.7 } }), {
      load_state: null,
    });
    o.update(normal(1), signals());
    expect(o.baseline).not.toBe(first);
    expect(o.baseline?.centre.browGap).toBeCloseTo(0.7, 6);
  });

  it('baseline: blinks use mean and SD, face measures median with a floor', () => {
    const rows = [0, 1, 0, 0, 1, 0].map((b) =>
      second({ calibrating: true, raw: { blink_count: b } }),
    );
    const base = overloadBaseline(rows);
    expect(base?.centre.blinks).toBeCloseTo(1 / 3, 6);
    expect(base?.spread.blinks).toBeCloseTo(Math.sqrt(2 / 9), 6);
    expect(base?.centre.browGap).toBeCloseTo(0.6, 6);
    expect(base?.spread.browGap).toBe(C.minSpread.browGap);
    expect(overloadBaseline([])).toBeNull();
  });

  it('no reading in a second without a face; reset forgets the baseline', () => {
    const o = calibrated();
    feed(o, C.windowSeconds, strained);
    expect(o.update(second({ valid: false }), signals({ load_state: null })).state).toBeNull();
    o.reset();
    expect(o.baseline).toBeNull();
    expect(o.update(normal(0), signals()).state).toBeNull();
  });
});
