import { describe, expect, it } from 'vitest';
import { MESH_INPUT_LENGTH, meshInput } from '../../../src/core/features/mesh-input.js';
import {
  CHIN,
  FOREHEAD,
  LEFT_EYE_INNER,
  LEFT_EYE_OUTER,
  RIGHT_EYE_INNER,
  RIGHT_EYE_OUTER,
} from '../../../src/core/features/landmark-indices.js';

type P = [number, number, number];

/**
 * A full 478-point face in its own frame, in IOD units, eyes centred on the
 * origin: the six points faceAxes()/IOD use sit exactly where a frontal face
 * has them, every other point is a fixed pseudo-random spot on the face.
 * No image of anyone involved.
 */
function canonicalFace(): P[] {
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const pts: P[] = Array.from({ length: 478 }, () => [rand() * 1.6, rand() * 2, rand() * 0.6]);
  pts[RIGHT_EYE_OUTER] = [-0.75, 0, 0];
  pts[RIGHT_EYE_INNER] = [-0.25, 0, 0];
  pts[LEFT_EYE_INNER] = [0.25, 0, 0];
  pts[LEFT_EYE_OUTER] = [0.75, 0, 0];
  pts[FOREHEAD] = [0, -0.9, -0.1];
  pts[CHIN] = [0, 1.4, -0.1];
  return pts;
}

/** R = Ry(yaw) · Rx(pitch) · Rz(roll), degrees. */
function rotate([x, y, z]: P, yaw: number, pitch: number, roll: number): P {
  const [a, b, c] = [yaw, pitch, roll].map((d) => (d * Math.PI) / 180) as P;
  // Rz(roll)
  let p: P = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c), z];
  // Rx(pitch)
  p = [p[0], p[1] * Math.cos(b) - p[2] * Math.sin(b), p[1] * Math.sin(b) + p[2] * Math.cos(b)];
  // Ry(yaw)
  return [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
}

/** Places the face in a frame (size in frame heights) and normalises like the provider. */
function toLandmarks(pts: readonly P[], size: number, cx: number, cy: number, aspect: number) {
  const lm = new Float32Array(MESH_INPUT_LENGTH);
  pts.forEach(([x, y, z], i) => {
    lm[i * 3] = (cx * aspect + x * size) / aspect;
    lm[i * 3 + 1] = cy + y * size;
    lm[i * 3 + 2] = (z * size) / aspect;
  });
  return { landmarks: lm, aspect };
}

function maxDiff(a: Float32Array, b: readonly P[]): number {
  return Math.max(...b.flatMap((p, i) => p.map((v, k) => Math.abs((a[i * 3 + k] ?? NaN) - v))));
}

describe('meshInput (TODO P2: model input from landmarks)', () => {
  const face = canonicalFace();

  it('camera frame removes position and size but keeps rotation', () => {
    const turned = face.map((p) => rotate(p, 25, -10, 5));
    const a = meshInput(toLandmarks(turned, 0.1, 0.4, 0.5, 4 / 3), 'camera');
    const b = meshInput(toLandmarks(turned, 0.25, 0.6, 0.45, 1), 'camera');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (!a || !b) return;
    // Rotation preserves distances, so the eye centre stays at the origin and IOD at 1.
    expect(maxDiff(a, turned)).toBeLessThan(1e-4);
    expect(maxDiff(b, turned)).toBeLessThan(1e-4);
  });

  it('face frame also removes head rotation', () => {
    for (const [yaw, pitch, roll] of [
      [0, 0, 0],
      [30, 0, 0],
      [-20, 15, -10],
      [10, -25, 20],
    ] as const) {
      const turned = face.map((p) => rotate(p, yaw, pitch, roll));
      const v = meshInput(toLandmarks(turned, 0.15, 0.5, 0.5, 4 / 3), 'face');
      expect(v).not.toBeNull();
      if (v) expect(maxDiff(v, face)).toBeLessThan(1e-4);
    }
  });

  it('returns null for a degenerate mesh instead of numbers', () => {
    expect(
      meshInput({ landmarks: new Float32Array(MESH_INPUT_LENGTH), aspect: 1 }, 'camera'),
    ).toBeNull();
    expect(meshInput({ landmarks: new Float32Array(30), aspect: 1 }, 'face')).toBeNull();
    const bad = toLandmarks(face, 0.2, 0.5, 0.5, 1);
    bad.landmarks[100] = NaN;
    expect(meshInput(bad, 'face')).toBeNull();
  });
});
