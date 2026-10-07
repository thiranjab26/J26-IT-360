import { LANDMARK_COUNT, LANDMARK_STRIDE } from './types.js';

/** A keypoint as returned by `@tensorflow-models/face-landmarks-detection` (pixel units). */
export interface PixelKeypoint {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

/**
 * Converts the library's pixel-unit keypoints into the provider contract:
 * a flat `Float32Array` of normalised `[x, y, z]` triples.
 *
 * The library scales x by width, y by height and z by width
 * (normalized_keypoints_to_keypoints.js), so dividing back by the same factors
 * recovers the model's normalised output exactly. A flat typed array is used
 * instead of 478 objects to avoid ~480 allocations per frame at 15 fps over a
 * 60-minute session (NFR6).
 *
 * Returns null for a malformed result (wrong point count, zero-size frame or a
 * non-finite value) so a bad frame is treated as "no face", never as data.
 */
export function keypointsToLandmarks(
  keypoints: readonly PixelKeypoint[],
  width: number,
  height: number,
): Float32Array | null {
  if (keypoints.length !== LANDMARK_COUNT || !(width > 0) || !(height > 0)) return null;
  const out = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
  for (let i = 0; i < LANDMARK_COUNT; i += 1) {
    const kp = keypoints[i];
    if (kp === undefined) return null;
    const x = kp.x / width;
    const y = kp.y / height;
    const z = (kp.z ?? 0) / width;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    const o = i * LANDMARK_STRIDE;
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
  }
  return out;
}
