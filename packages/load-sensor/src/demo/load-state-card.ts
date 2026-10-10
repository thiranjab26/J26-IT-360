import type { LoadStateEvent } from '../core/events/index.js';

/** The primitive fields shown; `meta` and `timestamp` are in the badge and the JSON. */
type Field = Exclude<keyof LoadStateEvent, 'meta' | 'timestamp' | 'schema_version'>;

/**
 * "Event stream" card on the Camera tab (TODO A5): the latest LoadStateEvent
 * exactly as C01/C03/C04 receive it, and a link to the mock consumer page.
 * The badge names the classifier so the placeholder is never mistaken for the
 * trained model.
 */
export class LoadStateCard {
  readonly element: HTMLElement;
  readonly #fields = new Map<Field, HTMLElement>();
  readonly #badge: HTMLElement;
  readonly #json: HTMLElement;

  constructor(consumerUrl: string) {
    this.element = document.createElement('section');
    this.element.className = 'card load-card';
    this.element.setAttribute('aria-label', 'Load-state event stream');

    const header = document.createElement('div');
    header.className = 'card-header';
    const title = document.createElement('h2');
    title.className = 'card-title';
    title.textContent = 'Event stream';
    this.#badge = document.createElement('span');
    this.#badge.className = 'load-badge';
    this.#badge.dataset.testid = 'load-model';
    this.#badge.title = 'heuristic-0 is a transparent placeholder rule, not the trained model.';
    const link = document.createElement('a');
    link.className = 'btn btn-small btn-ghost';
    link.href = consumerUrl;
    link.target = 'adaptlearn-c2-consumer';
    link.dataset.testid = 'open-consumer';
    link.textContent = 'Open mock consumer';
    const right = document.createElement('div');
    right.className = 'load-head-right';
    right.append(this.#badge, link);
    header.append(title, right);

    const grid = document.createElement('dl');
    grid.className = 'load-grid';
    for (const [key, label] of [
      ['status', 'Status'],
      ['load_state', 'Load'],
      ['confidence', 'Confidence'],
      ['engagement', 'Engagement'],
      ['frustration', 'Frustration'],
      ['presence', 'Presence'],
      ['fatigue', 'Fatigue'],
      ['affect', 'Affect'],
      ['strain', 'Strain'],
      ['suggest_break', 'Suggest break'],
    ] as const) {
      const item = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.dataset.testid = `event-${key}`;
      item.append(dt, dd);
      grid.append(item);
      this.#fields.set(key, dd);
    }

    const details = document.createElement('details');
    details.className = 'load-json';
    const summary = document.createElement('summary');
    summary.textContent = 'Raw JSON (what crosses to other components)';
    this.#json = document.createElement('pre');
    details.append(summary, this.#json);

    this.element.append(header, grid, details);
  }

  update(event: LoadStateEvent): void {
    for (const [key, node] of this.#fields) {
      const value = event[key];
      const text =
        value === null ? 'null' : typeof value === 'number' ? value.toFixed(2) : String(value);
      if (node.textContent !== text) node.textContent = text;
      node.dataset.null = String(value === null);
    }
    const model = event.meta?.model_version ?? 'no model loaded';
    if (this.#badge.textContent !== model) this.#badge.textContent = model;
    this.#json.textContent = JSON.stringify(event, null, 2);
  }
}
