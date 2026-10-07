import { CHIN, FOREHEAD, LEFT_EYE_OUTER, RIGHT_EYE_OUTER } from './landmark-indices.js';
import {
  cross,
  dot,
  normalize,
  point,
  RAD_TO_DEG,
  scale,
  sub,
  type FaceMesh,
  type Vec3,
} from './geometry.js';

/** Orthonormal axes of the face in camera space (x right, y down, z away from the camera). */
export interface FaceAxes {
  /** Across the face, from the subject's right eye to their left eye. */
  readonly x: Vec3;
  /** Down the face, forehead towards chin, made orthogonal to `x`. */
  readonly y: Vec3;
  /** `x × y`: points into the head, away from the camera for a frontal face. */
  readonly z: Vec3;
}

/** Head orientation in degrees. 0/0/0 = facing the camera upright. */
export interface HeadPoseDeg {
  /**
   * Rotation about the vertical axis. Positive when the nose moves towards the
   * image's left in the unmirrored frame, i.e. the subject turns to their own right.
   */
  readonly yaw: number;
  /** Rotation about the horizontal axis. Positive when the head tilts down (chin in, nodding). */
  readonly pitch: number;
  /** Rotation in the image plane. Positive when the head tilts towards the subject's left shoulder. */
  readonly roll: number;
}

/**
 * Face axes from four stable landmarks: both outer eye corners (horizontal)
 * and forehead → chin (vertical), Gram–Schmidt orthogonalised.
 *
 * Outer corners and forehead/chin barely move with expression, unlike the
 * mouth or brows, so the pose stays steady while the learner talks or frowns.
 */
export function faceAxes(mesh: FaceMesh): FaceAxes {
  const x = normalize(sub(point(mesh, LEFT_EYE_OUTER), point(mesh, RIGHT_EYE_OUTER)));
  const down = sub(point(mesh, CHIN), point(mesh, FOREHEAD));
  const y = normalize(sub(down, scale(x, dot(down, x))));
  return { x, y, z: cross(x, y) };
}

/**
 * Head pose from landmark geometry (no PnP solve, no camera intrinsics).
 *
 * The face axes form a rotation matrix R = [x y z] (columns). Decomposed in the
 * order R = Ry(yaw) · Rx(pitch) · Rz(roll):
 *   pitch = asin(−R₁₂), yaw = atan2(R₀₂, R₂₂), roll = atan2(R₁₀, R₁₁).
 *
 * Limits (state these when reporting): MediaPipe's z is a relative depth, so
 * this is a pose *estimate*. Its error grows at large angles, and the neutral
 * pitch differs per face shape, which is why features use pose relative to the
 * learner's own baseline and its variability, never the absolute angle.
 */
export function headPose(mesh: FaceMesh): HeadPoseDeg {
  return poseFromAxes(faceAxes(mesh));
}

export function poseFromAxes({ x, y, z }: FaceAxes): HeadPoseDeg {
  const r12 = Math.min(1, Math.max(-1, z.y));
  return {
    yaw: Math.atan2(z.x, z.z) * RAD_TO_DEG,
    pitch: Math.asin(-r12) * RAD_TO_DEG,
    roll: Math.atan2(x.y, y.y) * RAD_TO_DEG,
  };
}
