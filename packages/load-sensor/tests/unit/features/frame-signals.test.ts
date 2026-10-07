import { describe, expect, it } from 'vitest';
import {
  computeFrameSignals,
  earLeft,
  earRight,
  headPose,
  interocularDistance,
  type FaceMesh,
} from '../../../src/core/features/index.js';
import { DEFAULT_ASPECT, syntheticFace, type FaceParams } from '../../fixtures/synthetic-face.js';

const mesh = (p: FaceParams = {}, aspect = DEFAULT_ASPECT): FaceMesh => ({
  landmarks: syntheticFace(p, aspect),
  aspect,
});

const signals = (p: FaceParams = {}) => {
  const s = computeFrameSignals(mesh(p));
  if (!s) throw new Error('expected signals');
  return s;
};

describe('eye aspect ratio (FR2)', () => {
  it('recovers the EAR of each eye', () => {
    const m = mesh({ earRight: 0.31, earLeft: 0.12 });
    expect(earRight(m)).toBeCloseTo(0.31, 5);
    expect(earLeft(m)).toBeCloseTo(0.12, 5);
  });

  it('is independent of face size, position and frame aspect ratio', () => {
    const base = earRight(mesh({ ear: 0.27 }));
    expect(earRight(mesh({ ear: 0.27, size: 0.08, cx: 0.2, cy: 0.7 }))).toBeCloseTo(base, 5);
    expect(earRight(mesh({ ear: 0.27 }, 16 / 9))).toBeCloseTo(base, 5);
  });

  it('is unchanged by head rotation (3D distances, ARCHITECTURE.md §5.1)', () => {
    expect(earRight(mesh({ ear: 0.3, yaw: 30, pitch: 20, roll: 10 }))).toBeCloseTo(0.3, 4);
  });
});

describe('inter-ocular normalisation', () => {
  it('IOD scales with the face and normalised lengths do not', () => {
    const near = signals({ size: 0.3, mouthOpen: 0.2 });
    const far = signals({ size: 0.1, mouthOpen: 0.2 });
    expect(near.iod / far.iod).toBeCloseTo(3, 4);
    expect(near.mouthOpen).toBeCloseTo(0.2, 4);
    expect(far.mouthOpen).toBeCloseTo(0.2, 4);
  });

  it('IOD is in frame heights', () => {
    expect(interocularDistance(mesh({ size: 0.18 }))).toBeCloseTo(0.18, 5);
  });
});

describe('head pose (FR2)', () => {
  const angles = [-35, -20, -5, 0, 10, 25, 40];

  it.each(angles)('recovers yaw %i°', (yaw) => {
    expect(headPose(mesh({ yaw })).yaw).toBeCloseTo(yaw, 3);
  });

  it.each(angles)('recovers pitch %i°', (pitch) => {
    expect(headPose(mesh({ pitch })).pitch).toBeCloseTo(pitch, 3);
  });

  it.each(angles)('recovers roll %i°', (roll) => {
    expect(headPose(mesh({ roll })).roll).toBeCloseTo(roll, 3);
  });

  it('recovers a combined pose', () => {
    const pose = headPose(mesh({ yaw: 22, pitch: -14, roll: 9 }));
    expect(pose.yaw).toBeCloseTo(22, 3);
    expect(pose.pitch).toBeCloseTo(-14, 3);
    expect(pose.roll).toBeCloseTo(9, 3);
  });

  it('sign: positive yaw moves the nose-side of the face towards the image left', () => {
    // A point in front of the face (towards the camera, −z) moves to −x.
    const m = mesh({ yaw: 20 });
    const frontal = mesh();
    const chinX = (f: FaceMesh): number => (f.landmarks[152 * 3] ?? 0) * f.aspect;
    // Chin lies on the rotation axis, so it barely moves; the eyes' depth changes.
    expect(Math.abs(chinX(m) - chinX(frontal))).toBeLessThan(1e-6);
    const leftZ = m.landmarks[263 * 3 + 2] ?? 0;
    const rightZ = m.landmarks[33 * 3 + 2] ?? 0;
    // Turning to the subject's right brings their left eye (263) closer to the camera.
    expect(leftZ).toBeLessThan(rightZ);
  });

  it('sign: positive pitch = head tilted down (chin further from the camera than the forehead)', () => {
    const m = mesh({ pitch: 20 });
    expect(m.landmarks[152 * 3 + 2] ?? 0).toBeGreaterThan(m.landmarks[10 * 3 + 2] ?? 0);
  });
});

describe('gaze proxy (iris offset)', () => {
  it('recovers the iris offset in eye widths', () => {
    const s = signals({ irisDx: 0.12, irisDy: -0.05 });
    expect(s.irisDx).toBeCloseTo(0.12, 4);
    expect(s.irisDy).toBeCloseTo(-0.05, 4);
  });

  it('is measured in the face frame, so turning the head does not fake an eye movement', () => {
    const s = signals({ irisDx: 0.1, yaw: 25, roll: 15 });
    expect(s.irisDx).toBeCloseTo(0.1, 3);
    expect(s.irisDy).toBeCloseTo(0, 3);
  });
});

describe('brow and lip proxies (FR3)', () => {
  it('brow raise grows with brow lift', () => {
    expect(signals({ browLift: 0.1 }).browRaise - signals().browRaise).toBeCloseTo(0.1, 4);
  });

  it('inner brow gap falls when brows are furrowed', () => {
    expect(signals({ browInnerGap: 0.22 }).browInnerGap).toBeCloseTo(0.22, 4);
    expect(signals({ browInnerGap: 0.22 }).browInnerGap).toBeLessThan(signals().browInnerGap);
  });

  it('mouth open and lip thickness', () => {
    const s = signals({ mouthOpen: 0.3, lipThickness: 0.12 });
    expect(s.mouthOpen).toBeCloseTo(0.3, 4);
    expect(s.lipThickness).toBeCloseTo(0.12, 4);
  });
});

describe('computeFrameSignals robustness (FR8)', () => {
  it('returns null for a degenerate mesh instead of NaN features', () => {
    expect(computeFrameSignals({ landmarks: new Float32Array(478 * 3), aspect: 4 / 3 })).toBeNull();
  });

  it('returns all-finite signals for a normal face', () => {
    expect(Object.values(signals({ yaw: 10, ear: 0.25 })).every(Number.isFinite)).toBe(true);
  });
});
