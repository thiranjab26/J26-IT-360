import type { PipelineState } from '../core/window/index.js';

/**
 * Calibration prompt over the camera view (TODO A6): tells the learner what to
 * do during the baseline (ARCHITECTURE.md §5.4), how far along it is,
 * and when it is done.
 *
 * `calibrationView` is pure (state in, words out) so it is unit-tested;
 * `CalibrationPrompt` only draws it. The "done" message stays up for
 * DONE_MS of wall-clock time: it is a UI courtesy, not a feature timing.
 */

export const DONE_MS = 3500;

export type CalibrationKind = 'hidden' | 'find-face' | 'calibrating' | 'done';

export interface CalibrationInput {
  /** Camera on and frames flowing (not paused, model ready). */
  readonly sensing: boolean;
  readonly faceFound: boolean;
  /** Null while sensing is off. */
  readonly state: PipelineState | null;
  /** True during the short "done" moment after calibration finished. */
  readonly justFinished: boolean;
}

export interface CalibrationView {
  readonly kind: CalibrationKind;
  readonly title: string;
  readonly detail: string;
  /** 0..1 */
  readonly progress: number;
}

const HIDDEN: CalibrationView = { kind: 'hidden', title: '', detail: '', progress: 0 };

export function calibrationView(i: CalibrationInput): CalibrationView {
  if (!i.sensing || !i.state) return HIDDEN;
  const s = i.state;
  if (s.phase === 'ready') {
    return i.justFinished
      ? {
          kind: 'done',
          title: 'Calibration done',
          detail: 'From now on you are compared only with your own normal.',
          progress: 1,
        }
      : HIDDEN;
  }
  // Seconds count only while a face is seen (valid seconds), so this is "about".
  const left = Math.max(0, s.calibrationTarget - s.calibrationSeconds);
  if (!i.faceFound) {
    return {
      kind: 'find-face',
      title: 'Move into view',
      detail:
        s.calibrationSeconds > 0
          ? `Calibration is waiting for your face · about ${String(left)} s left`
          : 'Sit facing the screen with your whole face in the frame.',
      progress: s.calibrationProgress,
    };
  }
  return {
    kind: 'calibrating',
    title: 'Look at the screen as you normally would',
    detail: `Learning your normal · about ${String(left)} s left`,
    progress: s.calibrationProgress,
  };
}

export class CalibrationPrompt {
  readonly element: HTMLElement;
  readonly #title: HTMLElement;
  readonly #detail: HTMLElement;
  readonly #bar: HTMLElement;
  readonly #meter: HTMLElement;
  #phase: PipelineState['phase'] | null = null;
  #doneUntil = 0;

  constructor() {
    const root = document.createElement('div');
    root.className = 'calib-prompt';
    root.dataset.kind = 'hidden';
    root.dataset.testid = 'calib-prompt';
    this.element = root;

    const ring = document.createElement('span');
    ring.className = 'calib-icon';
    ring.setAttribute('aria-hidden', 'true');

    const text = document.createElement('div');
    text.className = 'calib-text';
    this.#title = document.createElement('strong');
    this.#title.dataset.testid = 'calib-title';
    // Only the title is live: the seconds left change every second and would
    // make a screen reader talk non-stop.
    this.#title.setAttribute('aria-live', 'polite');
    this.#detail = document.createElement('span');
    this.#meter = document.createElement('div');
    this.#meter.className = 'calib-meter';
    this.#meter.setAttribute('role', 'progressbar');
    this.#meter.setAttribute('aria-label', 'Calibration progress');
    this.#meter.setAttribute('aria-valuemin', '0');
    this.#meter.setAttribute('aria-valuemax', '100');
    this.#bar = document.createElement('span');
    this.#meter.append(this.#bar);
    text.append(this.#title, this.#detail, this.#meter);

    root.append(ring, text);
  }

  update(sensing: boolean, faceFound: boolean, state: PipelineState | null): void {
    const now = performance.now();
    const phase = sensing && state ? state.phase : null;
    // A calibrating → ready step starts the short "done" moment.
    if (this.#phase === 'calibrating' && phase === 'ready') this.#doneUntil = now + DONE_MS;
    if (phase !== 'ready') this.#doneUntil = 0;
    this.#phase = phase;

    const v = calibrationView({ sensing, faceFound, state, justFinished: now < this.#doneUntil });
    this.element.dataset.kind = v.kind;
    if (v.kind === 'hidden') return;
    if (this.#title.textContent !== v.title) this.#title.textContent = v.title;
    if (this.#detail.textContent !== v.detail) this.#detail.textContent = v.detail;
    const pct = Math.round(v.progress * 100);
    this.#bar.style.width = `${String(pct)}%`;
    this.#meter.setAttribute('aria-valuenow', String(pct));
  }
}
