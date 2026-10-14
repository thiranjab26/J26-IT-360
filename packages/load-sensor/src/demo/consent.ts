import { STORAGE_PREFIX } from './settings.js';

/**
 * Consent for camera sensing (TODO A6, CLAUDE.md invariant 4).
 *
 * Sensing stays off until the learner has read a plain-language notice and
 * agreed to it. The page never turns the camera on by itself, not even with
 * consent on record: consent only means that a later click on "Turn sensing
 * on" goes straight to the camera instead of showing the notice again.
 *
 * What is kept: one small record `{ version, at }` in localStorage, on this
 * device only. Bump CONSENT_VERSION whenever the notice changes in meaning,
 * so everyone who agreed to the old wording is asked again. Withdrawing
 * deletes the record and turns sensing off.
 */

/** Version of the notice text below. */
export const CONSENT_VERSION = 1;
export const CONSENT_KEY = `${STORAGE_PREFIX}consent`;

export interface ConsentRecord {
  readonly version: number;
  /** ISO 8601 time the learner agreed. */
  readonly at: string;
}

/** The part of `Storage` the store uses, so tests can pass a fake. */
export type ConsentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Reads a stored record; anything else (missing, malformed, older version) is "no consent". */
export function parseConsent(json: string | null, version = CONSENT_VERSION): ConsentRecord | null {
  if (!json) return null;
  try {
    const v: unknown = JSON.parse(json);
    if (typeof v !== 'object' || v === null) return null;
    const r = v as Partial<ConsentRecord>;
    if (r.version !== version || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) {
      return null;
    }
    return { version: r.version, at: r.at };
  } catch {
    return null;
  }
}

/**
 * Consent on record for this device. Storage may be blocked (private window):
 * consent then lasts for this visit only, and the notice shows again next time.
 */
export class ConsentStore {
  readonly #storage: ConsentStorage | null;
  #record: ConsentRecord | null;

  constructor(storage: ConsentStorage | null = defaultStorage()) {
    this.#storage = storage;
    let json: string | null;
    try {
      json = storage?.getItem(CONSENT_KEY) ?? null;
    } catch {
      json = null;
    }
    this.#record = parseConsent(json);
  }

  get granted(): boolean {
    return this.#record !== null;
  }

  get record(): ConsentRecord | null {
    return this.#record;
  }

  grant(now: Date = new Date()): void {
    this.#record = { version: CONSENT_VERSION, at: now.toISOString() };
    try {
      this.#storage?.setItem(CONSENT_KEY, JSON.stringify(this.#record));
    } catch {
      // Blocked storage: keep consent for this visit only.
    }
  }

  withdraw(): void {
    this.#record = null;
    try {
      this.#storage?.removeItem(CONSENT_KEY);
    } catch {
      // Nothing stored to remove.
    }
  }
}

function defaultStorage(): ConsentStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// ── Dialog ─────────────────────────────────────────────────────────────

/** `ask`: before sensing starts. `review`: consent is on record; it can be withdrawn. */
export type ConsentMode = 'ask' | 'review';
export type ConsentChoice = 'accept' | 'decline' | 'withdraw';

const ICONS = {
  points:
    '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/><path d="M9 15.5c1.8 1.3 4.2 1.3 6 0"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2.5"/>',
  hand: '<path d="M12 3v8"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/>',
  target:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
} as const;

/**
 * The plain-language notice as a native modal `<dialog>`: the browser traps
 * focus, makes the page behind inert and closes it with Esc. Esc, the close
 * button and a click on the backdrop all count as "Not now", never as consent.
 */
export class ConsentDialog {
  readonly element: HTMLDialogElement;
  readonly #title: HTMLHeadingElement;
  readonly #lead: HTMLParagraphElement;
  readonly #accept: HTMLButtonElement;
  readonly #decline: HTMLButtonElement;
  readonly #withdraw: HTMLButtonElement;
  readonly #stamp: HTMLParagraphElement;
  #resolve: ((choice: ConsentChoice) => void) | null = null;

  constructor() {
    const d = document.createElement('dialog');
    d.className = 'consent';
    d.dataset.testid = 'consent-dialog';
    d.setAttribute('aria-labelledby', 'consent-title');
    d.setAttribute('aria-describedby', 'consent-lead');
    this.element = d;

    const sheet = el('div', 'consent-sheet');

    const head = el('header', 'consent-head');
    const badge = el('div', 'consent-badge');
    badge.append(svgIcon(ICONS.lock));
    const eyebrow = el('p', 'consent-eyebrow', 'Camera sensing · privacy notice');
    this.#title = el('h2', 'consent-title', '');
    this.#title.id = 'consent-title';
    // Focus lands on the title, not a button: reading comes before choosing,
    // and a stray Enter cannot give consent.
    this.#title.tabIndex = -1;
    const titles = el('div');
    titles.append(eyebrow, this.#title);
    const close = el('button', 'consent-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close without turning the camera on');
    close.dataset.testid = 'consent-close';
    close.append(svgIcon(ICONS.close));
    head.append(badge, titles, close);

    this.#lead = el('p', 'consent-lead', '');
    this.#lead.id = 'consent-lead';

    const points = el('ul', 'consent-points');
    points.append(
      point(
        ICONS.points,
        'What is measured',
        'The camera image is turned into points on your face, about 15 times a second. From them the sensor reads blinks, where you look, head movement, and brow and lip movement, and sums them up as a few numbers each second.',
      ),
      point(
        ICONS.lock,
        'What never happens',
        'Video is never recorded, saved or uploaded. The analysis runs in this browser on this device, and no image or face points leave it. Other parts of AdaptLearn only receive labels such as “Low”, “Medium” or “High”.',
      ),
      point(
        ICONS.hand,
        'You stay in control',
        'Pause or turn it off at any time with the Camera switch; the camera light goes out. AdaptLearn keeps working without it.',
      ),
      point(
        ICONS.target,
        'The first minute is calibration',
        'Look at the screen as you normally would. Your normal is the baseline: you are only ever compared with yourself, never with other people.',
      ),
    );

    this.#stamp = el('p', 'consent-stamp', '');
    this.#stamp.dataset.testid = 'consent-stamp';
    const fine = el(
      'p',
      'consent-fine',
      'Your browser will ask for camera permission next. Your choice is remembered on this device only; you can withdraw it under “Privacy & consent”.',
    );

    const actions = el('footer', 'consent-actions');
    this.#withdraw = button('Withdraw consent', 'btn btn-danger', 'consent-withdraw');
    const spacer = el('div', 'spacer');
    this.#decline = button('Not now', 'btn btn-ghost', 'consent-decline');
    this.#accept = button('Agree and turn camera on', 'btn btn-primary', 'consent-accept');
    actions.append(this.#withdraw, spacer, this.#decline, this.#accept);

    sheet.append(head, this.#lead, points, this.#stamp, fine, actions);
    d.append(sheet);

    close.addEventListener('click', () => {
      this.#finish('decline');
    });
    this.#decline.addEventListener('click', () => {
      this.#finish('decline');
    });
    this.#accept.addEventListener('click', () => {
      this.#finish('accept');
    });
    this.#withdraw.addEventListener('click', () => {
      this.#finish('withdraw');
    });
    // Esc: let the browser close it, and record that as "Not now".
    d.addEventListener('cancel', () => {
      this.#settle('decline');
    });
    // A click on the backdrop lands on the <dialog> itself (the sheet fills it).
    d.addEventListener('click', (e) => {
      if (e.target === d) this.#finish('decline');
    });
  }

  get open(): boolean {
    return this.element.open;
  }

  /** Shows the notice; resolves with the learner's choice when it closes. */
  show(mode: ConsentMode, record: ConsentRecord | null = null): Promise<ConsentChoice> {
    if (this.#resolve) this.#settle('decline');
    const review = mode === 'review';
    this.element.dataset.mode = mode;
    this.#title.textContent = review ? 'Privacy & consent' : 'Before you turn on the camera';
    this.#lead.textContent = review
      ? 'You agreed to camera sensing on this device. Here is what that covers. Withdrawing turns the camera off and asks you again next time.'
      : 'AdaptLearn can notice when a task is getting hard for you, so lessons can adapt. It does this from your webcam, and it is off until you agree.';
    this.#stamp.hidden = !review || !record;
    this.#stamp.textContent = record ? `Agreed on ${formatDate(record.at)}.` : '';
    this.#accept.hidden = review;
    this.#withdraw.hidden = !review;
    this.#decline.textContent = review ? 'Close' : 'Not now';

    return new Promise<ConsentChoice>((resolve) => {
      this.#resolve = resolve;
      this.element.showModal();
      this.#title.focus();
    });
  }

  #finish(choice: ConsentChoice): void {
    this.#settle(choice);
    if (this.element.open) this.element.close();
  }

  #settle(choice: ConsentChoice): void {
    const resolve = this.#resolve;
    this.#resolve = null;
    resolve?.(choice);
  }
}

function point(svg: string, title: string, body: string): HTMLLIElement {
  const li = el('li', 'consent-point');
  const ic = el('span', 'consent-point-icon');
  ic.append(svgIcon(svg));
  const text = el('div');
  text.append(el('strong', '', title), el('p', '', body));
  li.append(ic, text);
  return li;
}

function button(label: string, className: string, testId: string): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.dataset.testid = testId;
  b.textContent = label;
  return b;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgIcon(paths: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  // Paths are the static constants above, never user or network data.
  svg.innerHTML = paths;
  return svg;
}
