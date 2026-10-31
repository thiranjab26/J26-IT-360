/**
 * Self-report forms for the pilot study (TODO B1).
 *
 * - NASA-TLX after every block: the six subscales, 0–100. Raw TLX (unweighted)
 *   is used: the pairwise weighting step adds 15 comparisons per block and the
 *   raw and weighted scores correlate highly, so it is commonly dropped. The
 *   raw subscale answers are stored, so a weighted score can still be computed
 *   if a weighting step is added later.
 * - Boredom (ARCHITECTURE.md §8b) and tiredness (§8a) after every block, one
 *   item each, 0–100 on the same scale, so the boredom and fatigue heuristics
 *   have something to be checked against.
 * - SUS once at the end (NFR3), standard 10 items, scored 0–100.
 *
 * Pure data and scoring; the form UI lives in src/study.
 */

export interface ScaleItem {
  readonly id: string;
  readonly label: string;
  readonly question: string;
  readonly low: string;
  readonly high: string;
}

/** NASA-TLX subscales, wording from the NASA Task Load Index (Hart & Staveland, 1988). */
export const TLX_ITEMS = [
  {
    id: 'mental',
    label: 'Mental demand',
    question: 'How mentally demanding was the task?',
    low: 'Very low',
    high: 'Very high',
  },
  {
    id: 'physical',
    label: 'Physical demand',
    question: 'How physically demanding was the task?',
    low: 'Very low',
    high: 'Very high',
  },
  {
    id: 'temporal',
    label: 'Temporal demand',
    question: 'How hurried or rushed was the pace of the task?',
    low: 'Very low',
    high: 'Very high',
  },
  {
    id: 'performance',
    label: 'Performance',
    question: 'How successful were you in accomplishing what you were asked to do?',
    low: 'Perfect',
    high: 'Failure',
  },
  {
    id: 'effort',
    label: 'Effort',
    question: 'How hard did you have to work to accomplish your level of performance?',
    low: 'Very low',
    high: 'Very high',
  },
  {
    id: 'frustration',
    label: 'Frustration',
    question: 'How insecure, discouraged, irritated, stressed and annoyed were you?',
    low: 'Very low',
    high: 'Very high',
  },
] as const satisfies readonly ScaleItem[];

/** Extra single items after each block (not part of NASA-TLX). */
export const BLOCK_EXTRA_ITEMS = [
  {
    id: 'boredom',
    label: 'Boredom',
    question: 'How bored were you during the task?',
    low: 'Not at all',
    high: 'Extremely',
  },
  {
    id: 'tiredness',
    label: 'Tiredness',
    question: 'How tired are you right now?',
    low: 'Not at all',
    high: 'Extremely',
  },
] as const satisfies readonly ScaleItem[];

export type TlxId = (typeof TLX_ITEMS)[number]['id'];
export type BlockExtraId = (typeof BLOCK_EXTRA_ITEMS)[number]['id'];
export type TlxAnswers = Readonly<Record<TlxId, number>>;
export type BlockExtraAnswers = Readonly<Record<BlockExtraId, number>>;

/** NASA-TLX scales have 21 tick marks: 0, 5, …, 100. */
export const TLX_STEP = 5;

function onScale(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100 && v % TLX_STEP === 0;
}

/** Every item answered with a value on the 0–100 scale in steps of 5. */
export function isScaleAnswers(
  items: readonly ScaleItem[],
  answers: Readonly<Record<string, unknown>>,
): boolean {
  return items.every((item) => onScale(answers[item.id]));
}

/** Raw TLX: the unweighted mean of the six subscales, 0–100. */
export function rawTlx(answers: TlxAnswers): number {
  const values = TLX_ITEMS.map((item) => answers[item.id]);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** System Usability Scale (Brooke, 1996), answered 1 (strongly disagree) to 5 (strongly agree). */
export const SUS_ITEMS = [
  'I think that I would like to use this system frequently.',
  'I found the system unnecessarily complex.',
  'I thought the system was easy to use.',
  'I think that I would need the support of a technical person to be able to use this system.',
  'I found the various functions in this system were well integrated.',
  'I thought there was too much inconsistency in this system.',
  'I would imagine that most people would learn to use this system very quickly.',
  'I found the system very cumbersome to use.',
  'I felt very confident using the system.',
  'I needed to learn a lot of things before I could get going with this system.',
] as const;

/** Ten answers, each an integer 1–5. */
export function isSusAnswers(answers: readonly unknown[]): answers is readonly number[] {
  return (
    answers.length === SUS_ITEMS.length &&
    answers.every((a) => typeof a === 'number' && Number.isInteger(a) && a >= 1 && a <= 5)
  );
}

/**
 * Standard SUS score, 0–100: odd items contribute (answer − 1), even items
 * (5 − answer), and the sum is multiplied by 2.5. NFR3 target is ≥ 70.
 */
export function susScore(answers: readonly number[]): number {
  if (!isSusAnswers(answers)) throw new RangeError('SUS needs ten answers, each 1–5.');
  const sum = answers.reduce((acc, a, i) => acc + (i % 2 === 0 ? a - 1 : 5 - a), 0);
  return sum * 2.5;
}
