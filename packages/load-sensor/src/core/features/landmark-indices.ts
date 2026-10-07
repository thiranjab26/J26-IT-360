/**
 * Every MediaPipe FaceMesh landmark index the features use, in one place.
 *
 * Sides are the **subject's own** left and right (anatomical), as in
 * MediaPipe's own naming. In the unmirrored camera frame the subject's right
 * eye appears on the image's left.
 *
 * Each index was checked against the region sets that
 * @tensorflow-models/face-landmarks-detection itself publishes
 * (`MEDIAPIPE_FACE_MESH_KEYPOINTS_BY_CONTOUR`, asserted in
 * tests/unit/features/landmark-indices.test.ts) and is drawn and labelled by the
 * debug overlay ("Feature points") for checking on a real face.
 */

/**
 * Six eyelid points per eye for the eye aspect ratio (Soukupová & Čech 2016),
 * in the order p1…p6: corner, upper, upper, corner, lower, lower, so that
 * EAR = (|p2 − p6| + |p3 − p5|) / (2 |p1 − p4|).
 */
export const RIGHT_EYE_EAR = [33, 160, 158, 133, 153, 144] as const;
export const LEFT_EYE_EAR = [362, 385, 387, 263, 373, 380] as const;

/** Eye corners. Outer = towards the ear, inner = towards the nose. */
export const RIGHT_EYE_OUTER = 33;
export const RIGHT_EYE_INNER = 133;
export const LEFT_EYE_INNER = 362;
export const LEFT_EYE_OUTER = 263;

/** Mid upper eyelid, the reference point for brow height. */
export const RIGHT_UPPER_LID = 159;
export const LEFT_UPPER_LID = 386;

/**
 * Iris centres and rims, present only with `refineLandmarks: true`
 * (468–477). 468 sits in the right eye (corners 33/133), 473 in the left.
 */
export const RIGHT_IRIS_CENTER = 468;
export const RIGHT_IRIS_RIM = [469, 470, 471, 472] as const;
export const LEFT_IRIS_CENTER = 473;
export const LEFT_IRIS_RIM = [474, 475, 476, 477] as const;

/** Brow: middle of the upper brow edge (raise) and inner end (furrow). */
export const RIGHT_BROW_MID = 105;
export const LEFT_BROW_MID = 334;
export const RIGHT_BROW_INNER = 107;
export const LEFT_BROW_INNER = 336;

/**
 * Lips. 13/14 are the inner-lip midpoints (mouth opening); 0/17 the outer-lip
 * midpoints, so 0–13 and 14–17 are the visible thickness of each lip, which
 * shrinks when the lips are pressed together.
 */
export const UPPER_LIP_OUTER = 0;
export const UPPER_LIP_INNER = 13;
export const LOWER_LIP_INNER = 14;
export const LOWER_LIP_OUTER = 17;

/** Face-oval top (forehead) and bottom (chin): the vertical axis for head pose. */
export const FOREHEAD = 10;
export const CHIN = 152;

/** All indices above, with a short label, for the overlay and the tests. */
export const FEATURE_LANDMARKS: readonly { readonly index: number; readonly label: string }[] = [
  ...RIGHT_EYE_EAR.map((index, i) => ({ index, label: `R eye p${String(i + 1)}` })),
  ...LEFT_EYE_EAR.map((index, i) => ({ index, label: `L eye p${String(i + 1)}` })),
  { index: RIGHT_UPPER_LID, label: 'R upper lid' },
  { index: LEFT_UPPER_LID, label: 'L upper lid' },
  { index: RIGHT_IRIS_CENTER, label: 'R iris' },
  { index: LEFT_IRIS_CENTER, label: 'L iris' },
  { index: RIGHT_BROW_MID, label: 'R brow' },
  { index: LEFT_BROW_MID, label: 'L brow' },
  { index: RIGHT_BROW_INNER, label: 'R brow inner' },
  { index: LEFT_BROW_INNER, label: 'L brow inner' },
  { index: UPPER_LIP_OUTER, label: 'upper lip out' },
  { index: UPPER_LIP_INNER, label: 'upper lip in' },
  { index: LOWER_LIP_INNER, label: 'lower lip in' },
  { index: LOWER_LIP_OUTER, label: 'lower lip out' },
  { index: FOREHEAD, label: 'forehead' },
  { index: CHIN, label: 'chin' },
];
