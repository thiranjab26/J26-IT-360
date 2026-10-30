import { interocularDistance } from './eye.js';
import { dot, midpoint, point, scale, sub, type FaceMesh, type Vec3 } from './geometry.js';
import { faceAxes } from './head-pose.js';
import {
  LEFT_EYE_INNER,
  LEFT_EYE_OUTER,
  RIGHT_EYE_INNER,
  RIGHT_EYE_OUTER,
} from './landmark-indices.js';

/** Points in the mesh (468 + 10 iris), as in FaceResult. */
const POINTS = 478;

/** Length of a mesh input vector: x, y, z for every point. */
export const MESH_INPUT_LENGTH = POINTS * 3;

/**
 * How a face mesh is turned into the input vector of a trained model
 * (TODO P2/P3/P4). One TypeScript function serves both the offline script that
 * builds the training data (scripts/landmarks-to-features.ts) and the browser
 * at inference time, so Python never re-implements it (CLAUDE.md "one source
 * of truth for features").
 *
 * - `camera`: centred on the midpoint between the eye centres and divided by
 *   the inter-ocular distance (IOD), axes unchanged. Removes where the face is
 *   and how large it is, keeps how it is turned: the input of the head-pose model.
 * - `face`: as `camera`, then rotated into the face's own frame (`faceAxes`,
 *   the same axes the geometric head pose uses). Removes head rotation too, so
 *   an expression model sees the same smile whether the head is turned or not.
 *
 * Coordinates use `point()`, so x and z are rescaled by the frame aspect and
 * all three axes share one unit before anything else happens.
 */
export type MeshFrame = 'camera' | 'face';

/**
 * Returns the `MESH_INPUT_LENGTH` vector `[x0, y0, z0, x1, …]` in IOD units,
 * or null for a degenerate mesh (zero IOD, wrong length or a non-finite value),
 * which callers treat as "no face".
 */
export function meshInput(mesh: FaceMesh, frame: MeshFrame): Float32Array | null {
  if (mesh.landmarks.length !== MESH_INPUT_LENGTH) return null;
  const iod = interocularDistance(mesh);
  if (!(iod > 0)) return null;
  const centre = midpoint(
    midpoint(point(mesh, RIGHT_EYE_OUTER), point(mesh, RIGHT_EYE_INNER)),
    midpoint(point(mesh, LEFT_EYE_INNER), point(mesh, LEFT_EYE_OUTER)),
  );
  const axes = frame === 'face' ? faceAxes(mesh) : null;
  const out = new Float32Array(MESH_INPUT_LENGTH);
  for (let i = 0; i < POINTS; i += 1) {
    const p: Vec3 = scale(sub(point(mesh, i), centre), 1 / iod);
    const x = axes ? dot(p, axes.x) : p.x;
    const y = axes ? dot(p, axes.y) : p.y;
    const z = axes ? dot(p, axes.z) : p.z;
    if (!Number.isFinite(x + y + z)) return null;
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}
