import { MEDIAPIPE_FACE_MESH_KEYPOINTS_BY_CONTOUR as CONTOURS } from '@tensorflow-models/face-landmarks-detection/dist/constants.js';
import { describe, expect, it } from 'vitest';
import { FEATURE_LANDMARKS, LANDMARKS as L } from '../../../src/core/features/index.js';

// The library's own region sets are the independent reference: if an index
// constant is in the wrong region (e.g. left/right swapped), this fails.
const inRegion = (region: keyof typeof CONTOURS, index: number): boolean =>
  CONTOURS[region].includes(index);

describe('landmark index constants (FR1, verified against MediaPipe regions)', () => {
  it.each(L.RIGHT_EYE_EAR.map((i) => [i]))('right-eye EAR point %i is on the right eye', (i) => {
    expect(inRegion('rightEye', i)).toBe(true);
  });

  it.each(L.LEFT_EYE_EAR.map((i) => [i]))('left-eye EAR point %i is on the left eye', (i) => {
    expect(inRegion('leftEye', i)).toBe(true);
  });

  it('upper-lid and corner points belong to their own eye', () => {
    for (const i of [L.RIGHT_UPPER_LID, L.RIGHT_EYE_OUTER, L.RIGHT_EYE_INNER]) {
      expect(inRegion('rightEye', i)).toBe(true);
    }
    for (const i of [L.LEFT_UPPER_LID, L.LEFT_EYE_OUTER, L.LEFT_EYE_INNER]) {
      expect(inRegion('leftEye', i)).toBe(true);
    }
  });

  it('iris rims match the library and centres precede them', () => {
    expect([...L.RIGHT_IRIS_RIM].sort()).toEqual([...new Set(CONTOURS.rightIris)].sort());
    expect([...L.LEFT_IRIS_RIM].sort()).toEqual([...new Set(CONTOURS.leftIris)].sort());
    expect(L.RIGHT_IRIS_CENTER).toBe(Math.min(...L.RIGHT_IRIS_RIM) - 1);
    expect(L.LEFT_IRIS_CENTER).toBe(Math.min(...L.LEFT_IRIS_RIM) - 1);
  });

  it('brow points are on the matching brow', () => {
    expect(inRegion('rightEyebrow', L.RIGHT_BROW_MID)).toBe(true);
    expect(inRegion('rightEyebrow', L.RIGHT_BROW_INNER)).toBe(true);
    expect(inRegion('leftEyebrow', L.LEFT_BROW_MID)).toBe(true);
    expect(inRegion('leftEyebrow', L.LEFT_BROW_INNER)).toBe(true);
  });

  it('lip points are on the lips, forehead and chin on the face oval', () => {
    for (const i of [L.UPPER_LIP_OUTER, L.UPPER_LIP_INNER, L.LOWER_LIP_INNER, L.LOWER_LIP_OUTER]) {
      expect(inRegion('lips', i)).toBe(true);
    }
    expect(inRegion('faceOval', L.FOREHEAD)).toBe(true);
    expect(inRegion('faceOval', L.CHIN)).toBe(true);
  });

  it('the overlay list has every index once, within the 478-point mesh', () => {
    const indices = FEATURE_LANDMARKS.map((l) => l.index);
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices.every((i) => i >= 0 && i < 478)).toBe(true);
  });
});
