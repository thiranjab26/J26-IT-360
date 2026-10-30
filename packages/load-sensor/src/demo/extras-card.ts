import { EXTRAS_CHANNEL, type ExtraSignalsEvent } from '../core/events/index.js';

/**
 * "Extra signals" card on the Performance tab: the latest optional extras
 * event exactly as it is posted on `adaptlearn.c02.extras`, so the owner and
 * teammates can see what the second stream carries.
 */
export class ExtrasCard {
  readonly element: HTMLElement;
  readonly #json: HTMLElement;

  constructor() {
    this.element = document.createElement('section');
    this.element.className = 'card load-card';
    this.element.setAttribute('aria-label', 'Extra signals stream');

    const header = document.createElement('div');
    header.className = 'card-header';
    const title = document.createElement('h2');
    title.className = 'card-title';
    title.textContent = 'Extra signals (optional stream)';
    const badge = document.createElement('span');
    badge.className = 'load-badge';
    badge.textContent = EXTRAS_CHANNEL;
    badge.title =
      'Separate from the load-state event. Mood may come from the trained model; boredom and overload are hand-picked rules.';
    header.append(title, badge);

    const details = document.createElement('details');
    details.className = 'load-json';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Raw JSON (what crosses to other components, once per second)';
    this.#json = document.createElement('pre');
    this.#json.dataset.testid = 'extras-json';
    this.#json.textContent = 'No extras yet: they start once sensing delivers its first second.';
    details.append(summary, this.#json);

    this.element.append(header, details);
  }

  update(event: ExtraSignalsEvent): void {
    this.#json.textContent = JSON.stringify(event, null, 2);
  }
}
