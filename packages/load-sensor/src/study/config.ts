import type { BlockKind } from '../core/recorder/index.js';

/**
 * Pilot-study settings (TODO B1). Decided by the owner on 31 Oct 2026:
 * 5-minute blocks, a balanced Latin square over the four task conditions, and
 * a placeholder shell: the page shows the block's instructions and a timer,
 * and the experimenter runs the actual programming task. Task wording is a
 * research-method choice, so it lives here for the owner and supervisor to
 * fill in, not in the page code.
 */

/**
 * Every block, rest included, is 5 minutes: ARCHITECTURE.md §12 asks for
 * at least 5 min so each block yields enough 30 s windows. The rest block also
 * serves as the calibration baseline (its first FEATURE_CONFIG.baseline
 * seconds). **(tune)** after the dry runs (B2).
 */
export const BLOCK_SECONDS = 300;

export interface BlockText {
  readonly title: string;
  readonly instructions: string;
}

/**
 * Placeholder text: replace with the real task briefs before B2. Titles are
 * neutral letters, not "Easy" / "Hard", so the label does not steer the
 * participant's NASA-TLX answers.
 */
export const BLOCK_TEXT: Readonly<Record<BlockKind, BlockText>> = {
  rest: {
    title: 'Rest',
    instructions:
      'Sit comfortably and look at the screen. You do not need to do anything. This gives the sensor your resting baseline.',
  },
  easy: {
    title: 'Task A',
    instructions: 'Placeholder: the experimenter gives you the easy programming task.',
  },
  medium: {
    title: 'Task B',
    instructions: 'Placeholder: the experimenter gives you the medium programming task.',
  },
  hard: {
    title: 'Task C',
    instructions: 'Placeholder: the experimenter gives you the hard programming task.',
  },
  underload: {
    title: 'Task D',
    instructions: 'Placeholder: the experimenter gives you the repetitive, very easy task.',
  },
};

/**
 * Block length for this page load. `?seconds=20` shortens every block so the
 * flow can be clicked through (tests/e2e-study, practice runs); real sessions
 * open the page without it. Only study builds contain this page at all.
 */
export function blockSeconds(search: string): number {
  const n = Number(new URLSearchParams(search).get('seconds'));
  return Number.isInteger(n) && n >= 5 && n <= BLOCK_SECONDS ? n : BLOCK_SECONDS;
}
