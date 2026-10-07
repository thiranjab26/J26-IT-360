import {
  LEFT_EYE_EAR,
  LEFT_EYE_INNER,
  LEFT_EYE_OUTER,
  LEFT_IRIS_CENTER,
  RIGHT_EYE_EAR,
  RIGHT_EYE_INNER,
  RIGHT_EYE_OUTER,
  RIGHT_IRIS_CENTER,
} from './landmark-indices.js';
import {
  distance,
  dot,
  landmarkDistance,
  midpoint,
  normalize,
  point,
  scale,
  sub,
  type FaceMesh,
  type Vec3,
} from './geometry.js';

type EarIndices = readonly [number, number, number, number, number, number];

/**
 * Eye aspect ratio (Soukupová & Čech 2016): eyelid opening over eye width,
 * (|p2 − p6| + |p3 − p5|) / (2 |p1 − p4|). About 0.25–0.35 open, below ~0.15
 * closed; the exact values differ per person and with glasses, which is why
 * blink detection uses a threshold relative to each learner's own open-eye EAR.
 *
 * Distances are 3D, not the original 2D: a head tilted down foreshortens the
 * eyelid gap in the image and would look like a closing eye in 2D.
 * EAR is a ratio, so it is already scale-invariant.
 */
export function eyeAspectRatio(mesh: FaceMesh, idx: EarIndices): number {
  const [p1, p2, p3, p4, p5, p6] = idx;
  const vertical = landmarkDistance(mesh, p2, p6) + landmarkDistance(mesh, p3, p5);
  const horizontal = landmarkDistance(mesh, p1, p4);
  return horizontal > 0 ? vertical / (2 * horizontal) : Number.NaN;
}

export function earRight(mesh: FaceMesh): number {
  return eyeAspectRatio(mesh, RIGHT_EYE_EAR);
}

export function earLeft(mesh: FaceMesh): number {
  return eyeAspectRatio(mesh, LEFT_EYE_EAR);
}

/**
 * Inter-ocular distance: between the two eye centres, each the midpoint of its
 * corners. Every length-based feature is divided by this, so features do not
 * change when the learner moves closer to or further from the camera.
 * Corner midpoints are used rather than pupils because pupils move with gaze.
 */
export function interocularDistance(mesh: FaceMesh): number {
  return distance(rightEyeCentre(mesh), leftEyeCentre(mesh));
}

function rightEyeCentre(mesh: FaceMesh): Vec3 {
  return midpoint(point(mesh, RIGHT_EYE_OUTER), point(mesh, RIGHT_EYE_INNER));
}

function leftEyeCentre(mesh: FaceMesh): Vec3 {
  return midpoint(point(mesh, LEFT_EYE_INNER), point(mesh, LEFT_EYE_OUTER));
}

export interface IrisOffset {
  /** Horizontal iris offset in eye widths. Positive = towards the image's right. */
  readonly dx: number;
  /** Vertical iris offset in eye widths. Positive = down (along the face's y axis). */
  readonly dy: number;
}

/**
 * Gaze **proxy**: where the iris centre sits inside the eye, relative to the
 * midpoint of the two eye corners, in units of eye width, averaged over both
 * eyes. Measured along the face's own axes, so turning the head does not by
 * itself move the value much.
 *
 * This is not calibrated gaze tracking: it cannot tell which point on the
 * screen is being looked at. It is used only for how much the eyes move
 * (dispersion) and whether they stay near their usual centre.
 *
 * @param faceDown unit vector down the face (head-pose `y` axis)
 */
export function irisOffset(mesh: FaceMesh, faceDown: Vec3): IrisOffset {
  const right = eyeIrisOffset(mesh, RIGHT_EYE_OUTER, RIGHT_EYE_INNER, RIGHT_IRIS_CENTER, faceDown);
  const left = eyeIrisOffset(mesh, LEFT_EYE_INNER, LEFT_EYE_OUTER, LEFT_IRIS_CENTER, faceDown);
  return { dx: (right.dx + left.dx) / 2, dy: (right.dy + left.dy) / 2 };
}

/** `imageLeftCorner` → `imageRightCorner` defines the eye's horizontal axis. */
function eyeIrisOffset(
  mesh: FaceMesh,
  imageLeftCorner: number,
  imageRightCorner: number,
  iris: number,
  faceDown: Vec3,
): IrisOffset {
  const a = point(mesh, imageLeftCorner);
  const b = point(mesh, imageRightCorner);
  const width = distance(a, b);
  const across = normalize(sub(b, a));
  const down = normalize(sub(faceDown, scale(across, dot(faceDown, across))));
  const rel = sub(point(mesh, iris), midpoint(a, b));
  return { dx: dot(rel, across) / width, dy: dot(rel, down) / width };
}
