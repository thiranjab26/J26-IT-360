/**
 * Task-block order for the pilot study (TODO B1, ARCHITECTURE.md §12).
 *
 * If everyone did Easy → Medium → Hard, the model could learn time-in-session
 * or fatigue instead of load. A balanced Latin square (Williams design) fixes
 * that for four conditions: across the four rows, every condition appears once
 * in every position, and every condition follows every other exactly once, so
 * first-order carry-over is balanced too. With 8 participants each row is used
 * twice (P01 and P05 get row 0, and so on).
 *
 * The rest/baseline block is not part of the square: it always comes first,
 * because it is the calibration the features are normalised against.
 */

export const TASK_CONDITIONS = ['easy', 'medium', 'hard', 'underload'] as const;
export type TaskCondition = (typeof TASK_CONDITIONS)[number];

/**
 * Williams square for n = 4, as indices into TASK_CONDITIONS. Built by the
 * standard construction (first row 0, 1, n−1, 2, n−2, …; each next row adds 1
 * mod n), written out so the table in the report and the code are the same.
 */
export const LATIN_SQUARE: readonly (readonly number[])[] = [
  [0, 1, 3, 2],
  [1, 2, 0, 3],
  [2, 3, 1, 0],
  [3, 0, 2, 1],
];

/** Participant codes are P01…P08 only (CLAUDE.md invariant 7). */
export const PARTICIPANT_CODE = /^P0[1-8]$/;

export function isParticipantCode(code: string): boolean {
  return PARTICIPANT_CODE.test(code);
}

/** Row of the square for a participant: P01 → 0, P04 → 3, P05 → 0. */
export function latinRow(participant: string): number {
  if (!isParticipantCode(participant)) {
    throw new RangeError(`Participant code must be P01…P08, got "${participant}".`);
  }
  return (Number(participant.slice(1)) - 1) % LATIN_SQUARE.length;
}

/** Task-block order for a participant. */
export function blockOrder(participant: string): readonly TaskCondition[] {
  const row = LATIN_SQUARE[latinRow(participant)] ?? [];
  return row.map((i) => TASK_CONDITIONS[i] ?? 'easy');
}
