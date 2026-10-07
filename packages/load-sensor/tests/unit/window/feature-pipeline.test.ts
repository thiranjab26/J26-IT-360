import { describe, expect, it } from 'vitest';
import { FEATURE_INDEX as I, FEATURE_NAMES } from '../../../src/core/features/index.js';
import { FeaturePipeline, type NormalisedSecond } from '../../../src/core/window/index.js';
import {
  blinkingEar,
  DEFAULT_ASPECT,
  renderSequence,
  type FaceParams,
} from '../../fixtures/synthetic-face.js';

function run(
  fps: number,
  durationMs: number,
  face: (t: number) => FaceParams | null,
  options: ConstructorParameters<typeof FeaturePipeline>[0] = {},
  jitterMs = 0,
) {
  const pipeline = new FeaturePipeline(options);
  const seconds: NormalisedSecond[] = [];
  pipeline.onSecond((s) => seconds.push(s));
  for (const f of renderSequence({ fps, durationMs, face, jitterMs })) {
    pipeline.push(f.tMs, f.landmarks, DEFAULT_ASPECT);
  }
  return { pipeline, seconds };
}

/** A lively but repeatable scenario: blinks every ~2.3 s, slow head sway, saccades. */
const BLINKS = Array.from({ length: 40 }, (_, k) => ({ at: 700 + k * 2300, durationMs: 200 }));
const scenario = (t: number): FaceParams => ({
  ear: blinkingEar(t, BLINKS),
  yaw: 6 * Math.sin((2 * Math.PI * t) / 4000),
  pitch: 3 * Math.sin((2 * Math.PI * t) / 6100),
  irisDx: Math.floor(t / 500) % 3 === 0 ? 0.05 : -0.03,
  browLift: 0.02 * Math.sin(t / 900),
  mouthOpen: 0.05,
});

describe('FeaturePipeline per-second features (FR2)', () => {
  it('emits one 14-feature vector per second of frame time', () => {
    const { seconds } = run(15, 10_500, scenario);
    expect(seconds.map((s) => s.second)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(seconds.every((s) => s.raw.length === FEATURE_NAMES.length)).toBe(true);
    expect(seconds.every((s) => s.valid && s.validRatio === 1)).toBe(true);
  });

  it('counts blinks per second', () => {
    const { seconds } = run(30, 20_500, scenario);
    const total = seconds.reduce((n, s) => n + (s.raw[I.blink_count] ?? 0), 0);
    // The open-eye reference needs 15 frames (0.5 s at 30 fps) before blinks can be detected.
    const expected = BLINKS.filter((b) => b.at > 500 && b.at + b.durationMs < 20_000).length;
    expect(total).toBe(expected);
  });

  it('same scenario at 10 fps and 30 fps gives the same features (rate independence)', () => {
    const at10 = run(10, 40_500, scenario, {}, 3).seconds;
    const at30 = run(30, 40_500, scenario, {}, 3).seconds;
    // Compare totals/means over 30 s (seconds 5..34): single seconds legitimately
    // differ when a blink ends near a second boundary.
    const mean = (rows: NormalisedSecond[], f: number): number =>
      rows.slice(5, 35).reduce((a, s) => a + (s.raw[f] ?? 0), 0) / 30;
    const tolerances: Record<string, number> = {
      blink_count: 0.02,
      blink_duration_mean: 30, // ms; one frame at 10 fps is 100 ms, midpoint estimate halves it
      ear_mean: 0.01,
      eyes_closed_fraction: 0.03,
      gaze_dispersion_x: 0.01,
      gaze_dispersion_y: 0.005,
      gaze_centred_fraction: 0.05,
      head_yaw_std: 0.4,
      head_pitch_std: 0.3,
      head_angular_speed: 1.0,
      brow_raise_mean: 0.005,
      brow_inner_gap_mean: 0.001,
      mouth_open_mean: 0.001,
      lip_thickness_mean: 0.001,
    };
    for (const name of FEATURE_NAMES) {
      const f = I[name];
      expect(Math.abs(mean(at10, f) - mean(at30, f)), name).toBeLessThanOrEqual(
        tolerances[name] ?? 0,
      );
    }
  });

  it('measures head angular speed in deg/s regardless of frame rate', () => {
    // Constant yaw rotation of 10°/s.
    const turning = (t: number): FaceParams => ({ yaw: -20 + (10 * t) / 1000 });
    for (const fps of [10, 15, 30]) {
      const { seconds } = run(fps, 4500, turning);
      expect(seconds[2]?.raw[I.head_angular_speed]).toBeCloseTo(10, 1);
    }
  });
});

describe('FeaturePipeline calibration and normalisation (ARCHITECTURE.md §5.4)', () => {
  it('calibrates over the first N valid seconds, then emits z-scores and fills the window', () => {
    const { pipeline, seconds } = run(15, 20_500, scenario, {
      calibrationSeconds: 10,
      windowSeconds: 5,
    });
    expect(seconds.slice(0, 10).every((s) => s.phase === 'calibrating' && s.z === null)).toBe(true);
    expect(seconds[9]?.phase).toBe('calibrating');
    expect(seconds[10]?.phase).toBe('ready');
    expect(seconds[10]?.z).toBeInstanceOf(Float32Array);
    expect(pipeline.state.phase).toBe('ready');
    expect(pipeline.state.classifiable).toBe(true);
  });

  it('z-scores of a steady scenario stay near 0 after calibration', () => {
    const { seconds } = run(15, 40_500, scenario, { calibrationSeconds: 20 });
    const ready = seconds.filter((s) => s.z);
    const ear = ready.map((s) => s.z?.[I.ear_mean] ?? 0);
    expect(Math.max(...ear.map(Math.abs))).toBeLessThan(3);
  });
});

describe('FeaturePipeline face loss (FR8, ARCHITECTURE.md §5.5)', () => {
  it('marks seconds without enough face frames invalid and does not calibrate on them', () => {
    const gone = (t: number): FaceParams | null => (t >= 3000 && t < 6000 ? null : scenario(t));
    const { seconds, pipeline } = run(15, 8500, gone, { calibrationSeconds: 60 });
    expect(seconds.slice(3, 6).every((s) => !s.valid && s.validRatio === 0)).toBe(true);
    expect(pipeline.state.calibrationSeconds).toBe(5);
  });

  it('stops being classifiable when more than 30 % of the window has no face', () => {
    const away = (t: number): FaceParams | null => (t >= 20_000 && t < 26_000 ? null : scenario(t));
    const { pipeline } = run(15, 26_000, away, { calibrationSeconds: 5, windowSeconds: 15 });
    expect(pipeline.state.classifiable).toBe(false);
    expect(pipeline.state.presence).toBe('absent');
  });

  it('emits empty invalid seconds across a gap in frames (tab hidden)', () => {
    const pipeline = new FeaturePipeline();
    const seconds: NormalisedSecond[] = [];
    pipeline.onSecond((s) => seconds.push(s));
    const frames = renderSequence({ fps: 15, durationMs: 1500, face: scenario });
    for (const f of frames) pipeline.push(f.tMs, f.landmarks, DEFAULT_ASPECT);
    for (const f of renderSequence({ fps: 15, durationMs: 1500, startMs: 5000, face: scenario })) {
      pipeline.push(f.tMs, f.landmarks, DEFAULT_ASPECT);
    }
    expect(seconds.map((s) => [s.second, s.frames])).toEqual([
      [0, 15],
      [1, 7],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 15],
    ]);
  });

  it('recalibrates after an absence longer than 5 minutes', () => {
    const pipeline = new FeaturePipeline({ calibrationSeconds: 3 });
    const feed = (startMs: number, durationMs: number) => {
      for (const f of renderSequence({ fps: 15, durationMs, startMs, face: scenario })) {
        pipeline.push(f.tMs, f.landmarks, DEFAULT_ASPECT);
      }
    };
    feed(0, 5000);
    expect(pipeline.state.phase).toBe('ready');
    feed(6 * 60_000, 2500);
    expect(pipeline.state.phase).toBe('calibrating');
  });
});

describe('FeaturePipeline signals for presence and drowsiness', () => {
  it('detects looking away (head turned) as presence "away"', () => {
    const turned = (t: number): FaceParams => ({ yaw: t > 5000 ? 40 : 0 });
    const { pipeline } = run(15, 9500, turned);
    expect(pipeline.state.presence).toBe('away');
  });

  it('counts long eye closures and yawns in the per-second aux data', () => {
    const drowsy = (t: number): FaceParams => ({
      ear: blinkingEar(t, [{ at: 3000, durationMs: 1500 }]),
      mouthOpen: t >= 6000 && t < 8500 ? 0.7 : 0.05,
    });
    const { seconds } = run(15, 10_500, drowsy);
    expect(seconds.reduce((n, s) => n + s.aux.longClosures, 0)).toBe(1);
    expect(seconds.reduce((n, s) => n + s.aux.yawns, 0)).toBe(1);
    expect(seconds.reduce((n, s) => n + (s.raw[I.blink_count] ?? 0), 0)).toBe(0);
  });
});

describe('useExpressionFeatures ablation (FR3)', () => {
  it('zeroes the two expression features and leaves the rest unchanged', () => {
    const on = run(15, 5500, scenario).seconds;
    const off = run(15, 5500, scenario, { useExpressionFeatures: false }).seconds;
    for (const [a, b] of on.map((s, i) => [s, off[i]] as const)) {
      expect(b?.raw[I.mouth_open_mean]).toBe(0);
      expect(b?.raw[I.lip_thickness_mean]).toBe(0);
      expect(a.raw[I.mouth_open_mean]).toBeGreaterThan(0);
      for (const name of FEATURE_NAMES) {
        if (name === 'mouth_open_mean' || name === 'lip_thickness_mean') continue;
        expect(b?.raw[I[name]]).toBe(a.raw[I[name]]);
      }
    }
  });
});
