import type { LoadSensorStatus } from '../core/events/index.js';
import { HEURISTIC_CONFIG } from '../core/heuristics/config.js';
import type { OverloadReading, OverloadState } from '../core/heuristics/index.js';

/**
 * "Overload" card on the Signals tab, after Boredom: the display-only
 * overload heuristic (core/heuristics/overload.ts), the points behind it and
 * a five-minute timeline. Boredom and Overload are the two ends of the same
 * inverted U (ARCHITECTURE.md §8b, §8c). Shares the Mood/Boredom card layout.
 */

type View = OverloadState | 'none';

interface StateInfo {
  readonly label: string;
  readonly what: string;
  /** Inline SVG body for a 24×24 face icon (static constants, never user data). */
  readonly face: string;
}

const HEAD = '<circle cx="12" cy="12" r="9"/>';

const STATES: Record<View, StateInfo> = {
  overloaded: {
    label: 'Overloaded',
    what: 'Several signs of strain together: fewer blinks, a furrowed brow, pressed lips or a fixed stare. A hint or an easier step may help.',
    face: `${HEAD}<path d="M7.5 8.2l3 1.1M16.5 8.2l-3 1.1"/><path d="M9 11.3v.4M15 11.3v.4"/><path d="M8.5 16l1.2-1 1.2 1 1.1-1 1.2 1 1.2-1 1.1 1"/>`,
  },
  working_hard: {
    label: 'Working hard',
    what: 'Signs of effort, still manageable. This is the productive middle of the curve.',
    face: `${HEAD}<path d="M8 8.6l2.5.6M16 8.6l-2.5.6"/><path d="M9 11v.5M15 11v.5"/><path d="M9.5 15.5h5"/>`,
  },
  manageable: {
    label: 'Manageable',
    what: 'No sign of strain: the load looks comfortable.',
    face: `${HEAD}<path d="M9 9.5v.5M15 9.5v.5"/><path d="M9 14.5c.8.9 1.8 1.4 3 1.4s2.2-.5 3-1.4"/>`,
  },
  none: {
    label: 'Not sensing',
    what: 'Starts once sensing is on and your baseline is learned.',
    face: '<circle cx="12" cy="12" r="9" stroke-dasharray="2.5 2.5"/>',
  },
};

/** While sensing is on but there is no reading, say why. */
function waitingText(status: LoadSensorStatus): { label: string; what: string } {
  switch (status) {
    case 'calibrating':
      return {
        label: 'Learning your baseline',
        what: 'Sit naturally and look at the screen. The overload reading starts when calibration ends.',
      };
    case 'no_face':
    case 'active':
      return { label: 'No face in view', what: 'Come back in front of the camera to continue.' };
    case 'paused':
      return { label: 'Paused', what: 'Sensing is paused. Resume to continue the reading.' };
    default:
      return { label: STATES.none.label, what: STATES.none.what };
  }
}

const LEGEND: readonly View[] = ['overloaded', 'working_hard', 'manageable', 'none'];
const LEGEND_LABEL: Record<View, string> = {
  overloaded: 'Overloaded',
  working_hard: 'Working hard',
  manageable: 'Manageable',
  none: 'No reading',
};

/** Seconds of history on the timeline. */
const HISTORY_SECONDS = 300;

type ZKey = 'blinkSuppression' | 'browFurrow' | 'lipPress' | 'gazeFixation';
type RowKey = ZKey | 'highLoad' | 'offScreen';

interface Row {
  readonly fill: HTMLElement;
  readonly value: HTMLElement;
  readonly chip: HTMLElement;
  readonly row: HTMLElement;
}

const Z_RANGE = 3;

export class OverloadPanel {
  readonly element: HTMLElement;
  readonly #icon: HTMLElement;
  readonly #label: HTMLElement;
  readonly #what: HTMLElement;
  readonly #since: HTMLElement;
  readonly #pointsBar: HTMLElement;
  readonly #pointsText: HTMLElement;
  readonly #status: HTMLElement;
  readonly #rows = new Map<RowKey, Row>();
  readonly #timeline: HTMLElement;
  /** One view per second, oldest first. */
  #history: View[] = [];
  #shown: View | null = null;
  #sinceSeconds = 0;

  constructor() {
    this.element = el('section', 'card mood-card overload-card');
    this.element.dataset.testid = 'overload';
    this.element.setAttribute('aria-label', 'Cognitive overload');

    const head = el('div', 'card-header');
    head.append(el('h2', 'card-title', 'Overload'));
    this.#status = el('span', 'mood-status', '');
    head.append(this.#status);

    // ── Now ──
    const c = HEURISTIC_CONFIG.overload;
    const now = el('div', 'mood-now');
    this.#icon = el('div', 'mood-icon');
    this.#icon.setAttribute('aria-hidden', 'true');
    const text = el('div', 'mood-text');
    this.#label = el('p', 'mood-label', '');
    this.#label.dataset.testid = 'overload-state';
    this.#label.setAttribute('role', 'status');
    this.#what = el('p', 'mood-what', '');
    const meta = el('div', 'mood-meta');
    this.#since = el('span', 'mood-since', '');
    const points = el('div', 'mood-strength');
    points.title = `${String(c.workingHardPoints)} points: working hard · ${String(c.overloadedPoints)}: overloaded`;
    const track = el('span', 'mood-strength-track boredom-points-track');
    this.#pointsBar = el('span', 'mood-strength-bar');
    track.append(this.#pointsBar);
    this.#pointsText = el('span', 'mood-strength-text', '');
    points.append(track, this.#pointsText);
    meta.append(this.#since, points);
    text.append(this.#label, this.#what, meta);
    now.append(this.#icon, text);

    // ── Evidence ──
    const ev = el('div', 'mood-evidence');
    ev.append(el('p', 'mood-sub', 'Evidence · last 30 s, against your baseline'));
    this.#row(ev, 'blinkSuppression', 'Fewer blinks', 'z');
    this.#row(ev, 'browFurrow', 'Brows drawn together', 'z');
    this.#row(ev, 'lipPress', 'Lips pressed', 'z');
    this.#row(ev, 'gazeFixation', 'Gaze fixed', 'z');
    this.#row(ev, 'highLoad', 'Load High (model)', 'share');
    ev.append(el('p', 'mood-sub boredom-sub-gap', 'Overrides'));
    this.#row(ev, 'offScreen', 'Looking away', 'share');

    // ── Timeline ──
    const tl = el('div', 'mood-history');
    const tlHead = el('div', 'mood-history-head');
    tlHead.append(
      el('p', 'mood-sub', `Last ${String(HISTORY_SECONDS / 60)} min`),
      el('span', 'mood-sub mood-now-tag', 'now'),
    );
    this.#timeline = el('div', 'mood-timeline');
    this.#timeline.setAttribute('role', 'img');
    this.#timeline.setAttribute('aria-label', 'Overload over the last five minutes');
    const legend = el('div', 'mood-legend');
    for (const v of LEGEND) {
      const item = el('span', 'mood-legend-item');
      const sw = el('span', 'mood-swatch overload-swatch');
      sw.dataset.overload = v;
      item.append(sw, document.createTextNode(LEGEND_LABEL[v]));
      legend.append(item);
    }
    tl.append(tlHead, this.#timeline, legend);

    const body = el('div', 'mood-body');
    body.append(now, ev);
    const note = el(
      'p',
      'mood-note',
      'Apparent overload from blinking, brows, lips and gaze, compared with your own baseline. A hand-tuned rule, not yet validated against NASA-TLX; it is not sent to other components and stays on this device.',
    );
    this.element.append(head, body, tl, note);
    this.reset();
  }

  /** `status` is the sensor's current status, used to explain a missing reading. */
  update(r: OverloadReading, status: LoadSensorStatus): void {
    const view: View = r.state ?? 'none';
    this.#history.push(view);
    if (this.#history.length > HISTORY_SECONDS) this.#history.shift();
    this.#sinceSeconds = view === this.#shown ? this.#sinceSeconds + 1 : 1;
    this.#show(view);
    if (r.state === null) {
      const wait = waitingText(status);
      setText(this.#label, wait.label);
      setText(this.#what, wait.what);
    } else if (r.away) {
      setText(this.#what, 'Mostly looking away from the screen, so strain cannot be judged.');
    } else {
      setText(this.#what, STATES[view].what);
    }

    const c = HEURISTIC_CONFIG.overload;
    this.#since.textContent = r.state === null ? '' : `for ${clock(this.#sinceSeconds)}`;
    const share = Math.min(1, r.points / (c.overloadedPoints + 1));
    this.#pointsBar.style.width = `${String(Math.round(share * 100))}%`;
    this.#pointsText.textContent = `${String(r.points)} / ${String(c.overloadedPoints)} points`;
    this.#status.textContent =
      r.state === null
        ? 'Waiting'
        : r.evidence.seconds < c.minCueSeconds
          ? 'Live · warming up'
          : 'Live';
    this.#status.dataset.tone = r.state === null ? 'warn' : 'live';

    const e = r.evidence;
    this.#setZ('blinkSuppression', e.blinkSuppression, r.cues.blinkSuppression);
    this.#setZ('browFurrow', e.browFurrow, r.cues.browFurrow);
    this.#setZ('lipPress', e.lipPress, r.cues.lipPress);
    this.#setZ('gazeFixation', e.gazeFixation, r.cues.gazeFixation);
    this.#setRow(
      'highLoad',
      e.highLoad,
      pct(e.highLoad),
      r.cues.highLoad,
      r.loadPointActive ? '+1' : 'off',
    );
    const load = this.#rows.get('highLoad');
    if (load) {
      // Shown but not counted while load comes from heuristic-0, which is
      // itself built from blinks, brows and lips (counting it = counting twice).
      load.row.dataset.off = String(!r.loadPointActive);
      load.row.title = r.loadPointActive
        ? ''
        : 'Off: load comes from the heuristic-0 placeholder, built from the same blink, brow and lip cues. Counts once the trained model ships.';
    }
    this.#setRow('offScreen', e.offScreen, pct(e.offScreen), r.away, 'away');

    this.#renderTimeline();
  }

  reset(): void {
    this.#history = [];
    this.#shown = null;
    this.#sinceSeconds = 0;
    this.#show('none');
    this.#since.textContent = '';
    this.#pointsBar.style.width = '0';
    this.#pointsText.textContent = '';
    this.#status.textContent = '';
    for (const r of this.#rows.values()) {
      r.row.dataset.off = 'true';
      r.row.dataset.met = 'false';
      r.fill.style.width = '0';
      r.value.textContent = '–';
    }
    this.#timeline.replaceChildren(el('span', 'mood-timeline-empty', 'No reading yet'));
  }

  #show(view: View): void {
    if (this.#shown === view) return;
    this.#shown = view;
    const info = STATES[view];
    this.element.dataset.overload = view;
    this.#label.textContent = info.label;
    this.#what.textContent = info.what;
    this.#icon.replaceChildren(icon(info.face));
    this.#icon.classList.remove('mood-swap');
    requestAnimationFrame(() => {
      this.#icon.classList.add('mood-swap');
    });
  }

  #row(parent: HTMLElement, key: RowKey, label: string, kind: 'share' | 'z'): void {
    const row = el('div', 'mood-ev-row boredom-ev-row');
    row.dataset.kind = kind;
    const bar = el('span', 'mood-ev-bar');
    const fill = el('span', 'mood-ev-fill');
    bar.append(fill);
    const value = el('span', 'mood-ev-value', '–');
    const chip = el('span', 'boredom-chip', '');
    row.append(el('span', 'mood-ev-name', label), bar, value, chip);
    parent.append(row);
    this.#rows.set(key, { fill, value, chip, row });
  }

  #setRow(key: RowKey, share: number, value: string, met: boolean, chip: string): void {
    const r = this.#rows.get(key);
    if (!r) return;
    r.row.dataset.off = 'false';
    r.row.dataset.met = String(met);
    r.fill.style.left = '0';
    r.fill.style.width = `${String(clamp(share, 0, 1) * 100)}%`;
    setText(r.value, value);
    setText(r.chip, chip);
  }

  /** Centred bar: right of the tick = towards overload, in baseline spreads. */
  #setZ(key: ZKey, z: number, met: boolean): void {
    const r = this.#rows.get(key);
    if (!r) return;
    r.row.dataset.off = 'false';
    r.row.dataset.met = String(met);
    const f = clamp(z / Z_RANGE, -1, 1) * 50;
    r.fill.style.left = `${String(f >= 0 ? 50 : 50 + f)}%`;
    r.fill.style.width = `${String(Math.abs(f))}%`;
    setText(r.value, `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}`);
    setText(r.chip, '+1');
  }

  #renderTimeline(): void {
    const parts: HTMLElement[] = [];
    const offset = HISTORY_SECONDS - this.#history.length;
    let start = 0;
    for (let i = 1; i <= this.#history.length; i += 1) {
      const v = this.#history[start];
      if (v === undefined) break;
      if (i < this.#history.length && this.#history[i] === v) continue;
      const seg = el('span', 'mood-seg overload-seg');
      seg.dataset.overload = v;
      seg.style.left = `${String(((offset + start) / HISTORY_SECONDS) * 100)}%`;
      seg.style.width = `${String(((i - start) / HISTORY_SECONDS) * 100)}%`;
      seg.title = `${LEGEND_LABEL[v]} · ${clock(i - start)}`;
      parts.push(seg);
      start = i;
    }
    this.#timeline.replaceChildren(...parts);
  }
}

function pct(share: number): string {
  return `${String(Math.round(share * 100))} %`;
}

/** m:ss from seconds. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(paths: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Paths are the static constants above, never user or network data.
  svg.innerHTML = paths;
  return svg;
}
