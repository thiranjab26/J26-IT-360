import { describe, expect, it } from 'vitest';
import {
  BlinkDetector,
  FEATURE_CONFIG,
  LookDownTracker,
} from '../../../src/core/features/index.js';
import { FeaturePipeline, type FrameFeatures } from '../../../src/core/window/index.js';
import { DEFAULT_ASPECT, syntheticFace, type FaceParams } from '../../fixtures/synthetic-face.js';

const FPS = 15;
const STEP = 1000 / FPS;
const OPEN = 0.3;

describe('LookDownTracker (keyboard glances)', () => {
  it('turns on at once with the head pitched down, off again after the hold time', () => {
    const t = new LookDownTracker();
    expect(t.update(0, 20, 0, 0.7)).toBe(true);
    expect(t.update(100, 0, 0, 1)).toBe(true);
    expect(t.update(100 + FEATURE_CONFIG.lookDown.holdMs, 0, 0, 1)).toBe(false);
  });

  it('an iris-only look down needs the hold time', () => {
    const t = new LookDownTracker();
    expect(t.update(0, 0, 0.1, 0.65)).toBe(false);
    expect(t.update(FEATURE_CONFIG.lookDown.holdMs, 0, 0.1, 0.65)).toBe(true);
  });

  it('a blink cannot switch it on (iris not trusted with the lid shut, and too short)', () => {
    const t = new LookDownTracker();
    // Closing lid: the iris landmarks drift down on the frames around the blink.
    t.update(0, 0, 0.1, 0.6);
    t.update(STEP, 0, 0.15, 0.2);
    t.update(2 * STEP, 0, 0.15, 0.1);
    expect(t.update(3 * STEP, 0, 0, 1)).toBe(false);
  });
});

describe('BlinkDetector while looking down', () => {
  it('open eyes looking at the keys are not "closed"; a real closure still is', () => {
    const det = new BlinkDetector();
    // Lid follows the gaze: EAR at 60 % of open, under the normal 75 % threshold.
    expect(det.update(0, OPEN * 0.6, OPEN, false).eyesClosed).toBe(true);
    const down = new BlinkDetector();
    expect(down.update(0, OPEN * 0.6, OPEN, true).eyesClosed).toBe(false);
    expect(down.update(STEP, 0.05, OPEN, true).eyesClosed).toBe(true);
  });
});

/** Runs the pipeline over `ms` of frames from `face(t)` and returns every frame result. */
function run(p: FeaturePipeline, fromMs: number, ms: number, face: (t: number) => FaceParams) {
  const out: FrameFeatures[] = [];
  for (let t = fromMs; t < fromMs + ms; t += STEP) {
    out.push(p.push(t, syntheticFace(face(t)), DEFAULT_ASPECT));
  }
  return out;
}

describe('FeaturePipeline: typing (looking down at the keyboard)', () => {
  // Head 20° down with the lids lowered to 60 % of the open EAR.
  const typing: FaceParams = { pitch: 20, ear: OPEN * 0.6, irisDy: 0.1 };

  it('reads as looking down: eyes not closed, not off-screen, no long closures or nods', () => {
    const p = new FeaturePipeline({ calibrationSeconds: 5 });
    run(p, 0, 6000, () => ({ ear: OPEN }));
    // Typing with glances back to the screen every few seconds.
    const frames = run(p, 6000, 20_000, (t) => (t % 4000 < 3000 ? typing : { ear: OPEN }));
    const atKeys = frames.filter((f) => f.lookingDown);
    expect(atKeys.length).toBeGreaterThan(frames.length / 2);
    expect(atKeys.every((f) => !f.eyesClosed && !f.offScreen)).toBe(true);
    expect(frames.some((f) => f.closure?.kind === 'long')).toBe(false);
    expect(frames.some((f) => f.nod)).toBe(false);
    expect(frames[frames.length - 1]?.presence).toBe('present');
  });

  it('eyes really shut while looking down still count as closed', () => {
    const p = new FeaturePipeline({ calibrationSeconds: 5 });
    run(p, 0, 6000, () => ({ ear: OPEN }));
    run(p, 6000, 2000, () => typing);
    const shut = run(p, 8000, 2000, () => ({ ...typing, ear: 0.05 }));
    expect(shut.slice(3).every((f) => f.eyesClosed)).toBe(true);
  });

  it('turning the head away is still off-screen', () => {
    const p = new FeaturePipeline({ calibrationSeconds: 5 });
    run(p, 0, 6000, () => ({ ear: OPEN }));
    const away = run(p, 6000, 2000, () => ({ ear: OPEN, yaw: 40 }));
    expect(away.slice(5).every((f) => f.offScreen)).toBe(true);
  });
});
