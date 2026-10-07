/**
 * Small 3D vector helpers over the landmark array. Pure, allocation-light.
 *
 * Landmarks arrive normalised per axis (x by frame width, y by height, z by
 * width; see FaceResult). Distances are only meaningful in a space where all
 * three axes share one unit, so `point()` rescales x and z by the frame aspect
 * ratio (width / height): every coordinate is then in frame heights.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A face mesh with the frame aspect ratio needed to make it isotropic. */
export interface FaceMesh {
  readonly landmarks: Float32Array;
  /** Frame width / height, e.g. 4/3 for 640×480. */
  readonly aspect: number;
}

export function point(mesh: FaceMesh, index: number): Vec3 {
  const o = index * 3;
  const lm = mesh.landmarks;
  return {
    x: (lm[o] ?? Number.NaN) * mesh.aspect,
    y: lm[o + 1] ?? Number.NaN,
    z: (lm[o + 2] ?? Number.NaN) * mesh.aspect,
  };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function norm(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return n > 0 ? scale(a, 1 / n) : { x: Number.NaN, y: Number.NaN, z: Number.NaN };
}

export function distance(a: Vec3, b: Vec3): number {
  return norm(sub(a, b));
}

export function midpoint(a: Vec3, b: Vec3): Vec3 {
  return scale(add(a, b), 0.5);
}

/** Distance between two landmarks of the mesh. */
export function landmarkDistance(mesh: FaceMesh, i: number, j: number): number {
  return distance(point(mesh, i), point(mesh, j));
}

export const RAD_TO_DEG = 180 / Math.PI;
