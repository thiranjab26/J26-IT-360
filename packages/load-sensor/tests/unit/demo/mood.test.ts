import { MEDIAPIPE_FACE_MESH_KEYPOINTS_BY_CONTOUR as CONTOURS } from '@tensorflow-models/face-landmarks-detection/dist/constants.js';
import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT, FEATURE_INDEX as I } from '../../../src/core/features/spec.js';
import type { NormalisedSecond } from '../../../src/core/window/index.js';
import {
  LEFT_MOUTH_CORNER,
  MOOD_CONFIG,
  MoodEstimator,
  mouthCornerLift,
  mouthWidth,
  RIGHT_MOUTH_CORNER,
  type Mood,
} from '../../../src/demo/mood.js';
import { DEFAULT_ASPECT, syntheticFace, type FaceParams } from '../../fixtures/synthetic-face.js';

const IOD = 0.18; // syntheticFace default size: IOD in frame heights

/** syntheticFace places its mouth corners at 61/291; copy them to the inner corners the estimator reads. */
function face(p: FaceParams = {}): Float32Array {
  const lm = syntheticFace(p);
  for (const [from, to] of [
    [61, RIGHT_MOUTH_CORNER],
    [291, LEFT_MOUTH_CORNER],
  ] as const) {
    lm.set(lm.subarray(from * 3, from * 3 + 3), to * 3);
  }
  return lm;
}

const mesh = (p: FaceParams = {}) => ({ landmarks: face(p), aspect: DEFAULT_ASPECT });

/** A second with a face looking at the screen; `z` overrides baseline z-scores by feature name. */
function second(
  t: number,
  opts: {
    phase?: 'calibrating' | 'ready';
    valid?: boolean;
    z?: Partial<Record<keyof typeof I, number>>;
    closed?: number;
    longClosures?: number;
    offScreen?: number;
    centred?: number;
  } = {},
): NormalisedSecond {
  const raw = new Float32Array(FEATURE_COUNT);
  raw[I.eyes_closed_fraction] = opts.closed ?? 0;
  raw[I.gaze_centred_fraction] = opts.centred ?? 0.6;
  const phase = opts.phase ?? 'ready';
  let z: Float32Array | null = null;
  if (phase === 'ready') {
    z = new Float32Array(FEATURE_COUNT);
    for (const [name, v] of Object.entries(opts.z ?? {})) z[I[name as keyof typeof I]] = v;
  }
  const valid = opts.valid ?? true;
  return {
    second: t,
    startMs: t * 1000,
    raw,
    frames: 15,
    validRatio: valid ? 1 : 0,
    valid,
    aux: {
      longClosures: opts.longClosures ?? 0,
      yawns: 0,
      nods: 0,
      offScreenFraction: opts.offScreen ?? 0.3,
      faceSize: IOD,
    },
    z,
    phase,
  };
}

/** Runs a calibration of `n` seconds with a neutral mouth, then returns the estimator. */
function calibrated(n = 20): { m: MoodEstimator; t: number } {
  const m = new MoodEstimator();
  // Small natural variation so the baseline spread is realistic, not the floor.
  for (let t = 0; t < n; t += 1) {
    const jitter = ((t % 5) - 2) * 0.004;
    m.pushFrame(frame({ smile: jitter, mouthWidth: 0.9 + jitter }));
    m.pushSecond(second(t, { phase: 'calibrating' }));
  }
  return { m, t: n };
}

function frame(p: FaceParams) {
  return {
    landmarks: face(p),
    aspect: DEFAULT_ASPECT,
    signals: { iod: IOD, yaw: p.yaw ?? 0, pitch: p.pitch ?? 0 },
  };
}

/** Feeds `seconds` identical seconds and returns the shown mood. */
function hold(
  m: MoodEstimator,
  from: number,
  seconds: number,
  p: FaceParams,
  opts: Parameters<typeof second>[1] = {},
): { mood: Mood | undefined; t: number } {
  let t = from;
  for (let k = 0; k < seconds; k += 1, t += 1) {
    for (let f = 0; f < 15; f += 1) m.pushFrame(frame(p));
    m.pushSecond(second(t, opts));
  }
  return { mood: m.reading?.mood, t };
}

describe('mood measures (display only)', () => {
  it('uses inner mouth corners that are on the MediaPipe lips contour', () => {
    expect(CONTOURS.lips).toContain(RIGHT_MOUTH_CORNER);
    expect(CONTOURS.lips).toContain(LEFT_MOUTH_CORNER);
  });

  it('corner lift recovers the smile height and ignores head roll', () => {
    expect(mouthCornerLift(mesh({ smile: 0.08 }), IOD)).toBeCloseTo(0.08, 4);
    expect(mouthCornerLift(mesh({ smile: -0.05 }), IOD)).toBeCloseTo(-0.05, 4);
    expect(mouthCornerLift(mesh({ smile: 0.08, roll: 20 }), IOD)).toBeCloseTo(0.08, 3);
  });

  it('mouth width is in inter-ocular distances', () => {
    expect(mouthWidth(mesh({ mouthWidth: 1.1 }), IOD)).toBeCloseTo(1.1, 4);
  });
});

describe('mood estimator', () => {
  it('shows "neutral" and waits for the baseline before expression moods', () => {
    const m = new MoodEstimator();
    m.pushFrame(frame({ smile: 0.2, mouthWidth: 1.2 }));
    const r = m.pushSecond(second(0, { phase: 'calibrating' }));
    expect(r.mood).toBe('neutral');
    expect(r.calibrating).toBe(true);
  });

  it('smile → happy, after the confirm delay (no flicker)', () => {
    const { m, t } = calibrated();
    expect(hold(m, t, MOOD_CONFIG.confirm - 1, { smile: 0.12, mouthWidth: 1.1 }).mood).not.toBe(
      'happy',
    );
    const r = hold(m, t + MOOD_CONFIG.confirm, 4, { smile: 0.12, mouthWidth: 1.1 });
    expect(r.mood).toBe('happy');
    expect(m.reading?.strength).toBeGreaterThan(0.4);
  });

  it('corners pulled down → sad', () => {
    const { m, t } = calibrated();
    expect(hold(m, t, 8, { smile: -0.1, mouthWidth: 0.9 }).mood).toBe('sad');
  });

  it('brows furrowed + lips pressed → frustrated; furrow alone → confused', () => {
    let { m, t } = calibrated();
    expect(
      hold(m, t, 8, {}, { z: { brow_inner_gap_mean: -1.5, lip_thickness_mean: -1.5 } }).mood,
    ).toBe('frustrated');
    ({ m, t } = calibrated());
    expect(hold(m, t, 8, {}, { z: { brow_inner_gap_mean: -1.5 } }).mood).toBe('confused');
  });

  it('brows high + mouth open → surprised', () => {
    const { m, t } = calibrated();
    expect(hold(m, t, 8, {}, { z: { brow_raise_mean: 2.5, mouth_open_mean: 2 } }).mood).toBe(
      'surprised',
    );
  });

  it('eyes closed a lot → drowsy, and drowsy wins over a smile', () => {
    const { m, t } = calibrated();
    expect(hold(m, t, 20, { smile: 0.12, mouthWidth: 1.1 }, { closed: 0.3 }).mood).toBe('drowsy');
  });

  it('steady gaze on the screen → focused; looking away → distracted', () => {
    let { m, t } = calibrated();
    expect(hold(m, t, 12, {}, { offScreen: 0, centred: 1 }).mood).toBe('focused');
    ({ m, t } = calibrated());
    expect(hold(m, t, 12, {}, { offScreen: 0.9, centred: 0.1 }).mood).toBe('distracted');
  });

  it('no face → "no-face", and the timeline records each change', () => {
    const { m, t } = calibrated();
    const a = hold(m, t, 6, { smile: 0.12, mouthWidth: 1.1 });
    expect(a.mood).toBe('happy');
    expect(hold(m, a.t, 6, {}, { valid: false }).mood).toBe('no-face');
    const moods = m.history.map((s) => s.mood);
    expect(moods.slice(-2)).toEqual(['happy', 'no-face']);
  });

  it('with expression features off (FR3 ablation) a smile is not read as happy', () => {
    const { m, t } = calibrated();
    m.setExpression(false);
    const r = hold(m, t, 8, { smile: 0.12, mouthWidth: 1.1 });
    expect(r.mood).not.toBe('happy');
    expect(m.reading?.expression).toBe(false);
  });

  it('a turned head is not used for mouth measures', () => {
    const { m, t } = calibrated();
    expect(hold(m, t, 8, { smile: 0.12, mouthWidth: 1.1, yaw: 40 }).mood).not.toBe('happy');
  });
});
