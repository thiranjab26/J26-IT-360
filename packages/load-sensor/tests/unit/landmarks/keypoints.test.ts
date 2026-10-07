import { describe, expect, it } from 'vitest';
import {
  keypointsToLandmarks,
  LANDMARK_COUNT,
  type PixelKeypoint,
} from '../../../src/core/landmarks/index.js';

/** Synthetic keypoints on a grid; no face image involved. */
function grid(width: number, height: number): PixelKeypoint[] {
  return Array.from({ length: LANDMARK_COUNT }, (_, i) => ({
    x: ((i % 25) / 25) * width,
    y: (Math.floor(i / 25) / 20) * height,
    z: (i / LANDMARK_COUNT - 0.5) * width * 0.1,
  }));
}

describe('keypointsToLandmarks (FR1)', () => {
  it('normalises x by width, y by height and z by width, as a flat 478×3 array', () => {
    const lm = keypointsToLandmarks(grid(640, 480), 640, 480);
    expect(lm).toBeInstanceOf(Float32Array);
    expect(lm).toHaveLength(LANDMARK_COUNT * 3);
    // Point 26: column 1, row 1.
    expect(lm?.[26 * 3]).toBeCloseTo(1 / 25, 6);
    expect(lm?.[26 * 3 + 1]).toBeCloseTo(1 / 20, 6);
    expect(lm?.[26 * 3 + 2]).toBeCloseTo((26 / LANDMARK_COUNT - 0.5) * 0.1, 6);
  });

  it('gives the same normalised landmarks at any resolution', () => {
    const small = keypointsToLandmarks(grid(320, 240), 320, 240);
    const large = keypointsToLandmarks(grid(1280, 720), 1280, 720);
    expect(small).not.toBeNull();
    for (let i = 0; i < (small?.length ?? 0); i += 1) {
      expect(small?.[i]).toBeCloseTo(large?.[i] ?? Number.NaN, 5);
    }
  });

  it('treats a missing z as 0', () => {
    const kps = grid(640, 480).map(({ x, y }) => ({ x, y }));
    expect(keypointsToLandmarks(kps, 640, 480)?.[2]).toBe(0);
  });

  it.each([
    ['too few points (no iris refinement)', grid(640, 480).slice(0, 468), 640, 480],
    ['zero-size frame', grid(640, 480), 0, 480],
    [
      'non-finite value',
      grid(640, 480).map((k, i) => (i === 5 ? { ...k, x: Number.NaN } : k)),
      640,
      480,
    ],
  ])('returns null for %s', (_label, kps, w, h) => {
    expect(keypointsToLandmarks(kps, w, h)).toBeNull();
  });
});
