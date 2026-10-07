import {
  LEFT_BROW_INNER,
  LEFT_BROW_MID,
  LEFT_UPPER_LID,
  LOWER_LIP_INNER,
  LOWER_LIP_OUTER,
  RIGHT_BROW_INNER,
  RIGHT_BROW_MID,
  RIGHT_UPPER_LID,
  UPPER_LIP_INNER,
  UPPER_LIP_OUTER,
} from './landmark-indices.js';
import { landmarkDistance, type FaceMesh } from './geometry.js';

/*
 * Expression proxies (FR3). Each is a distance between two landmarks divided by
 * the inter-ocular distance, so it does not depend on how far the learner sits
 * from the camera. Raw values differ a lot between faces; they become
 * comparable only after z-scoring against the learner's own baseline (§5.4).
 *
 * Each signal is named for what it measures. Two of them move *down* for the
 * expression they stand for:
 *  - furrowing the brows pulls the inner brows together → `browInnerGap` falls;
 *  - pressing the lips together hides lip tissue → `lipThickness` falls.
 */

/** Mean height of the brows above the upper eyelids. Rises with surprise / effortful attention. */
export function browRaise(mesh: FaceMesh, iod: number): number {
  const right = landmarkDistance(mesh, RIGHT_BROW_MID, RIGHT_UPPER_LID);
  const left = landmarkDistance(mesh, LEFT_BROW_MID, LEFT_UPPER_LID);
  return (right + left) / 2 / iod;
}

/** Distance between the inner brow ends. Falls when the brows are furrowed. */
export function browInnerGap(mesh: FaceMesh, iod: number): number {
  return landmarkDistance(mesh, RIGHT_BROW_INNER, LEFT_BROW_INNER) / iod;
}

/** Gap between the inner lips. ~0 closed, larger when talking, largest when yawning. */
export function mouthOpen(mesh: FaceMesh, iod: number): number {
  return landmarkDistance(mesh, UPPER_LIP_INNER, LOWER_LIP_INNER) / iod;
}

/** Visible thickness of both lips together. Falls when the lips are pressed. */
export function lipThickness(mesh: FaceMesh, iod: number): number {
  const upper = landmarkDistance(mesh, UPPER_LIP_OUTER, UPPER_LIP_INNER);
  const lower = landmarkDistance(mesh, LOWER_LIP_INNER, LOWER_LIP_OUTER);
  return (upper + lower) / iod;
}
