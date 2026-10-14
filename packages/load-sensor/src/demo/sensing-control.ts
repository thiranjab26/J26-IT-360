/**
 * The always-visible camera control in the sidebar (TODO A6): one on/off
 * switch and a "camera on" indicator that stay on screen on every tab, plus a
 * link to the privacy notice.
 *
 * The switch is a `<button role="switch">`: one control, one state, read out
 * by screen readers as "Camera, switch, on/off". Turning it on goes through
 * the consent gate in main.ts; turning it off stops every camera track.
 */

export type SensingIndicator = 'off' | 'starting' | 'on' | 'paused' | 'error';

const LABEL: Record<SensingIndicator, string> = {
  off: 'Off',
  starting: 'Starting…',
  on: 'On · live',
  paused: 'Paused',
  error: 'Needs attention',
};

export class SensingControl {
  readonly element: HTMLElement;
  readonly #switch: HTMLButtonElement;
  readonly #state: HTMLSpanElement;
  readonly #review: HTMLButtonElement;
  #onToggle: ((on: boolean) => void) | null = null;
  #onReview: (() => void) | null = null;

  constructor() {
    const root = document.createElement('div');
    root.className = 'sensing-control';
    root.dataset.state = 'off';
    this.element = root;

    const row = document.createElement('div');
    row.className = 'sensing-row';

    // The indicator: a dot that turns red and pulses while the camera is on.
    const lamp = document.createElement('span');
    lamp.className = 'sensing-lamp';
    lamp.setAttribute('aria-hidden', 'true');

    const text = document.createElement('div');
    text.className = 'sensing-text';
    const name = document.createElement('span');
    name.className = 'sensing-name';
    name.id = 'sensing-name';
    name.textContent = 'Camera';
    this.#state = document.createElement('span');
    this.#state.className = 'sensing-state';
    this.#state.dataset.testid = 'camera-indicator';
    this.#state.setAttribute('aria-live', 'polite');
    this.#state.textContent = LABEL.off;
    text.append(name, this.#state);

    this.#switch = document.createElement('button');
    this.#switch.type = 'button';
    this.#switch.className = 'sensing-switch';
    this.#switch.setAttribute('role', 'switch');
    this.#switch.setAttribute('aria-checked', 'false');
    this.#switch.setAttribute('aria-labelledby', 'sensing-name');
    this.#switch.dataset.testid = 'sensing-switch';
    const thumb = document.createElement('span');
    thumb.className = 'sensing-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    this.#switch.append(thumb);

    row.append(lamp, text, this.#switch);

    this.#review = document.createElement('button');
    this.#review.type = 'button';
    this.#review.className = 'sensing-review';
    this.#review.dataset.testid = 'review-consent';
    this.#review.textContent = 'Privacy & consent';

    root.append(row, this.#review);

    this.#switch.addEventListener('click', () => {
      this.#onToggle?.(this.#switch.getAttribute('aria-checked') !== 'true');
    });
    this.#review.addEventListener('click', () => {
      this.#onReview?.();
    });
  }

  /** Called with the state the learner asked for. */
  onToggle(cb: (on: boolean) => void): void {
    this.#onToggle = cb;
  }

  onReview(cb: () => void): void {
    this.#onReview = cb;
  }

  set(state: SensingIndicator): void {
    if (this.element.dataset.state === state) return;
    this.element.dataset.state = state;
    // On while starting too: the switch shows the learner's intent, so a second
    // click while the permission prompt is up turns it off again.
    const on = state === 'on' || state === 'paused' || state === 'starting';
    this.#switch.setAttribute('aria-checked', String(on));
    this.#state.textContent = LABEL[state];
  }
}
