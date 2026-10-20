import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT, FEATURE_INDEX as I } from '../../../src/core/features/index.js';
import {
  BoredomEstimator,
  HEURISTIC_CONFIG,
  type BoredomReading,
  type BoredomSignals,
  type HeuristicSecond,
} from '../../../src/core/heuristics/index.js';

type Named = Partial<Record<keyof typeof I, number>>;

function second(
  opts: {
    valid?: boolean;
    raw?: Named;
    z?: Named | null;
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
    raw: vec({ gaze_centred_fraction: 1, eyes_closed_fraction: 0.03, ...opts.raw }),
    z: opts.z === null ? null : vec(opts.z ?? {}),
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

const signals = (s: Partial<BoredomSignals> = {}): BoredomSignals => ({
  load_state: 'Medium',
  engagement: 'High',
  ...s,
});

/** Load from a trained model (any version other than the heuristic-0 placeholder). */
const TRAINED = { fps: 15, backend: 'webgl', model_version: 'cnn-gru-test' };

const C = HEURISTIC_CONFIG.boredom;
const calm = second();
const yawn = second({ aux: { yawns: 1 } });

function feed(
  b: BoredomEstimator,
  n: number,
  s: HeuristicSecond,
  sig: BoredomSignals = signals(),
): BoredomReading {
  let out!: BoredomReading;
  for (let i = 0; i < n; i += 1) out = b.update(s, sig);
  return out;
}

/** A settled estimator: enough calm seconds for a first reading. */
function warmed(): BoredomEstimator {
  const b = new BoredomEstimator();
  feed(b, C.windowSeconds, calm);
  return b;
}

describe('boredom heuristic (§8b)', () => {
  it('no reading while calibrating; not bored as soon as calibration ends', () => {
    const b = new BoredomEstimator();
    const calibrating = second({ z: null });
    expect(feed(b, 30, calibrating, signals({ load_state: null })).state).toBeNull();
    // First baseline-normalised second; the load estimate is not ready yet.
    expect(b.update(calm, signals({ load_state: null })).state).toBe('not_bored');
  });

  it('yawns right after calibration still count', () => {
    const b = new BoredomEstimator();
    feed(b, 30, second({ z: null }), signals({ load_state: null }));
    b.update(yawn, signals({ load_state: null }));
    b.update(yawn, signals({ load_state: null }));
    expect(feed(b, C.confirm, calm, signals({ load_state: null })).state).toBe('possibly_bored');
  });

  it('gaze and head cues need minCueSeconds of baseline data before earning a point', () => {
    const b = new BoredomEstimator();
    feed(b, 30, second({ z: null }));
    const restless = second({ z: { gaze_dispersion_x: 3, head_angular_speed: 3 } });
    expect(feed(b, C.minCueSeconds - 1, restless).points).toBe(0);
    expect(b.update(restless, signals()).points).toBe(2);
  });

  /** `n` yawns spaced like a bout (~20 s apart), then `confirm` calm seconds. */
  function yawns(b: BoredomEstimator, n: number): BoredomReading {
    for (let i = 0; i < n; i += 1) {
      b.update(yawn, signals());
      feed(b, 20, calm);
    }
    return feed(b, C.confirm, calm);
  }

  it('one yawn alone is not enough (people yawn when interested too)', () => {
    const r = yawns(warmed(), 1);
    expect(r.points).toBe(1);
    expect(r.cues.yawn).toBe(true);
    expect(r.state).toBe('not_bored');
  });

  it('two yawns in 5 min read as possibly bored', () => {
    const r = yawns(warmed(), 2);
    expect(r.points).toBe(2);
    expect(r.state).toBe('possibly_bored');
  });

  it('three or more yawns in 5 min read as bored', () => {
    expect(yawns(warmed(), 3).state).toBe('bored');
    const many = yawns(warmed(), 5);
    expect(many.points).toBe(3);
    expect(many.state).toBe('bored');
  });

  it('one yawn plus looking around reads as possibly bored; two yawns plus it as bored', () => {
    const wandering = second({ z: { gaze_dispersion_x: 2 } });
    const withYawn = second({ z: { gaze_dispersion_x: 2 }, aux: { yawns: 1 } });

    const one = warmed();
    one.update(withYawn, signals());
    const r1 = feed(one, C.windowSeconds, wandering);
    expect(r1.cues).toMatchObject({ yawn: true, gazeWander: true });
    expect(r1.state).toBe('possibly_bored');

    const two = warmed();
    two.update(withYawn, signals());
    two.update(withYawn, signals());
    expect(feed(two, C.windowSeconds, wandering).state).toBe('bored');
  });

  it("the yawns' own eye and head movement does not add gaze or head points", () => {
    const b = warmed();
    // Iris jumps and head tips back during each yawn, calm otherwise.
    const during = second({ z: { gaze_dispersion_x: 3, head_angular_speed: 3 } });
    for (let i = 0; i < 2; i += 1) {
      feed(b, 4, during);
      b.update(
        second({ z: { gaze_dispersion_x: 3, head_angular_speed: 3 }, aux: { yawns: 1 } }),
        signals(),
      );
      feed(b, 15, calm);
    }
    const r = feed(b, C.confirm, calm);
    expect(r.cues).toMatchObject({ yawn: true, gazeWander: false, fidget: false });
    expect(r.points).toBe(2);
    expect(r.state).toBe('possibly_bored');
  });

  it('yawns count for the 5-minute event window, then expire', () => {
    const b = warmed();
    b.update(yawn, signals());
    b.update(yawn, signals());
    expect(feed(b, C.eventWindowSeconds - 2, calm).evidence.yawns).toBe(2);
    expect(b.update(calm, signals()).evidence.yawns).toBe(1);
    expect(b.update(calm, signals()).cues.yawn).toBe(false);
    expect(feed(b, C.confirm, calm).state).toBe('not_bored');
  });

  it('yawn points follow the config table and cap at 3+', () => {
    expect([0, 1, 2, 3, 4, 10].map((n) => BoredomEstimator.yawnPoints(n))).toEqual([
      0, 1, 2, 3, 3, 3,
    ]);
  });

  it('three behavioural cues without yawning read as bored', () => {
    const b = warmed();
    const restless = second({ z: { gaze_dispersion_y: 1.5, head_angular_speed: 1.5 } });
    const r = feed(b, C.windowSeconds, restless, signals({ load_state: 'Low' }));
    expect(r.cues).toMatchObject({ underload: true, gazeWander: true, fidget: true });
    expect(r.points).toBe(3);
    expect(r.state).toBe('bored');
  });

  it('low engagement and underload together read as possibly bored', () => {
    const b = warmed();
    const r = feed(b, C.windowSeconds, calm, signals({ load_state: 'Low', engagement: 'Low' }));
    expect(r.points).toBe(2);
    expect(r.state).toBe('possibly_bored');
  });

  it('a single behavioural cue is not enough', () => {
    const b = warmed();
    const r = feed(b, C.windowSeconds, second({ z: { gaze_dispersion_x: 2 } }));
    expect(r.points).toBe(1);
    expect(r.state).toBe('not_bored');
  });

  it('tired, not bored, when the eyes are drowsy (PERCLOS), even with yawns', () => {
    const b = warmed();
    const drowsy = second({ raw: { eyes_closed_fraction: 0.3 } });
    feed(b, 30, drowsy);
    b.update(second({ raw: { eyes_closed_fraction: 0.3 }, aux: { yawns: 1 } }), signals());
    b.update(second({ raw: { eyes_closed_fraction: 0.3 }, aux: { yawns: 1 } }), signals());
    const r = feed(b, C.windowSeconds, drowsy);
    expect(r.cues.yawn).toBe(true);
    expect(r.veto).toBe('drowsy');
    expect(r.state).toBe('tired');
  });

  it('tired after a head nod', () => {
    const b = warmed();
    b.update(second({ aux: { yawns: 1, nods: 1 } }), signals());
    expect(feed(b, C.confirm, calm).state).toBe('tired');
  });

  it("a yawn's own eye squeeze does not make it tired", () => {
    const b = warmed();
    // Two yawns, each with ~2 s of shut eyes.
    for (let i = 0; i < 2; i += 1) {
      b.update(second({ raw: { eyes_closed_fraction: 1 }, aux: { yawns: 1 } }), signals());
      b.update(second({ raw: { eyes_closed_fraction: 1 } }), signals());
      feed(b, 10, calm);
    }
    const r = feed(b, C.confirm, calm);
    expect(r.veto).toBeNull();
    expect(r.state).toBe('possibly_bored');
  });

  it('many yawns in a row do not read as tired: eye squeeze during yawns is masked', () => {
    const b = warmed();
    // Five yawns in about a minute, each with ~4 s of shut eyes before it ends.
    for (let i = 0; i < 5; i += 1) {
      feed(b, 4, second({ raw: { eyes_closed_fraction: 1 } }));
      b.update(second({ raw: { eyes_closed_fraction: 1 }, aux: { yawns: 1 } }), signals());
      feed(b, 7, calm);
    }
    const r = feed(b, C.confirm, calm);
    expect(r.evidence.perclos).toBeLessThan(C.drowsyPerclos);
    expect(r.veto).toBeNull();
    expect(r.state).toBe('bored');
  });

  it('High load caused by the yawns themselves does not veto as busy', () => {
    const b = warmed();
    for (let i = 0; i < 3; i += 1) {
      b.update(yawn, signals({ load_state: 'High', meta: TRAINED }));
      feed(b, 10, calm, signals({ load_state: 'High', meta: TRAINED }));
    }
    const r = feed(b, C.confirm, calm, signals({ load_state: 'High', meta: TRAINED }));
    expect(r.evidence.highLoad).toBe(0);
    expect(r.veto).toBeNull();
    expect(r.state).toBe('bored');
  });

  it('not bored while load is mostly High (overload side), however restless', () => {
    const b = warmed();
    b.update(yawn, signals({ load_state: 'High', meta: TRAINED }));
    const restless = second({ z: { gaze_dispersion_x: 2, head_angular_speed: 2 } });
    const r = feed(b, C.windowSeconds, restless, signals({ load_state: 'High', meta: TRAINED }));
    expect(r.points).toBeGreaterThanOrEqual(C.boredPoints);
    expect(r.veto).toBe('working_hard');
    expect(r.state).toBe('not_bored');
  });

  it('busy veto is off while load comes from the heuristic-0 placeholder', () => {
    const b = warmed();
    const placeholder = { fps: 15, backend: 'webgl', model_version: 'heuristic-0' };
    const high = signals({ load_state: 'High', meta: placeholder });
    feed(b, C.windowSeconds, calm, high);
    for (let i = 0; i < 3; i += 1) {
      b.update(yawn, high);
      feed(b, 15, calm, high);
    }
    // Long after the yawns, so their 30 s load mask no longer applies.
    const r = feed(b, 40, calm, high);
    expect(r.evidence.highLoad).toBeGreaterThan(C.highLoadShare);
    expect(r.busyVetoActive).toBe(false);
    expect(r.veto).toBeNull();
    expect(r.state).toBe('bored');
  });

  it('no reading in a second without a face', () => {
    const b = warmed();
    const r = b.update(second({ valid: false, z: null }), signals({ load_state: null }));
    expect(r.state).toBeNull();
  });

  it('does not flap on evidence alternating around a threshold (hysteresis)', () => {
    const b = warmed();
    let changes = 0;
    let last = b.update(calm, signals()).state;
    for (let i = 0; i < 60; i += 1) {
      const s = second({ z: { gaze_dispersion_x: i % 2 === 0 ? 3 : -1 } });
      const now = b.update(s, signals({ load_state: i % 2 === 0 ? 'Low' : 'Medium' })).state;
      if (now !== last) changes += 1;
      last = now;
    }
    expect(changes).toBeLessThanOrEqual(2);
  });

  it('evidence ignores invalid seconds for z and eye cues', () => {
    const valid = {
      s: second({ z: { head_angular_speed: 2 }, raw: { eyes_closed_fraction: 0.1 } }),
      load: 'Low' as const,
      engagement: null,
    };
    const invalid = { s: second({ valid: false, z: null }), load: null, engagement: null };
    const rows = [...Array<typeof valid>(C.minCueSeconds).fill(valid), invalid];
    const e = BoredomEstimator.evidence(rows);
    expect(e.fidget).toBe(2);
    expect(e.perclos).toBeCloseTo(0.1, 6);
    expect(e.underload).toBeCloseTo(C.minCueSeconds / (C.minCueSeconds + 1), 6);
  });

  it('reset forgets everything', () => {
    const b = warmed();
    b.update(yawn, signals());
    b.update(yawn, signals());
    b.reset();
    const r = b.update(calm, signals());
    expect(r.evidence.yawns).toBe(0);
    expect(r.points).toBe(0);
    expect(r.state).toBe('not_bored');
  });
});
