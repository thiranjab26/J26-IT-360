import type { LoadSensorStatus } from '../core/events/index.js';
import { HEURISTIC_CONFIG } from '../core/heuristics/config.js';
import {
  BoredomEstimator,
  type BoredomReading,
  type BoredomState,
} from '../core/heuristics/index.js';

/**
 * "Boredom" card on the Signals tab, next to Mood: the display-only boredom
 * heuristic (core/heuristics/boredom.ts), the points behind it and a
 * five-minute timeline. The Camera tab stays free of it so the learner's
 * study view is calm.
 */

type View = BoredomState | 'none';

interface StateInfo {
  readonly label: string;
  readonly what: string;
  /** Inline SVG body for a 24×24 face icon (static constants, never user data). */
  readonly face: string;
}

const HEAD = '<circle cx="12" cy="12" r="9"/>';

const STATES: Record<View, StateInfo> = {
  bored: {
    label: 'Bored',
    what: 'Little demand and attention drifting: yawning, looking around or restless.',
    face: `${HEAD}<path d="M8 10.2c.8.5 1.7.5 2.5 0M13.5 10.2c.8.5 1.7.5 2.5 0"/><ellipse cx="12" cy="15.6" rx="1.9" ry="2.2"/>`,
  },
  possibly_bored: {
    label: 'Possibly bored',
    what: 'Some signs of drifting attention. One more sign reads as bored.',
    face: `${HEAD}<path d="M10.5 9.5v.5M16 9.5v.5"/><path d="M9.5 15.5h5"/>`,
  },
  not_bored: {
    label: 'Not bored',
    what: 'Attention looks steady, or the task is keeping you busy.',
    face: `${HEAD}<path d="M9 9.5v.5M15 9.5v.5"/><path d="M9 14.5c.8.9 1.8 1.4 3 1.4s2.2-.5 3-1.4"/>`,
  },
  tired: {
    label: 'Tired, not bored',
    what: 'Your eyes look drowsy, so yawning reads as tiredness. A break helps more than a harder task.',
    face: `${HEAD}<path d="M8 10.5h2.5M13.5 10.5H16"/><path d="M10 15.5h4"/>`,
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
        what: 'Sit naturally and look at the screen. The boredom reading starts when calibration ends.',
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

const LEGEND: readonly View[] = ['bored', 'possibly_bored', 'not_bored', 'tired', 'none'];
const LEGEND_LABEL: Record<View, string> = {
  bored: 'Bored',
  possibly_bored: 'Possibly',
  not_bored: 'Not bored',
  tired: 'Tired',
  none: 'No reading',
};

/** Seconds of history on the timeline. */
const HISTORY_SECONDS = 300;

type RowKey =
  'yawn' | 'underload' | 'lowEngagement' | 'gazeWander' | 'fidget' | 'perclos' | 'highLoad';

interface Row {
  readonly fill: HTMLElement;
  readonly value: HTMLElement;
  readonly chip: HTMLElement;
  readonly row: HTMLElement;
}

const Z_RANGE = 3;

export class BoredomPanel {
  readonly element: HTMLElement;
  readonly #icon: HTMLElement;
  readonly #label: HTMLElement;
  readonly #what: HTMLElement;
  readonly #since: HTMLElement;
  readonly #pointsBar: HTMLElement;
  readonly #pointsText: HTMLElement;
  readonly #status: HTMLElement;
  readonly #rows = new Map<RowKey, Row>();
  #busyRow: Row | null = null;
  readonly #timeline: HTMLElement;
  /** One view per second, oldest first. */
  #history: View[] = [];
  #shown: View | null = null;
  #sinceSeconds = 0;

  constructor() {
    this.element = el('section', 'card mood-card boredom-card');
    this.element.dataset.testid = 'boredom';
    this.element.setAttribute('aria-label', 'Boredom');

    const head = el('div', 'card-header');
    head.append(el('h2', 'card-title', 'Boredom'));
    this.#status = el('span', 'mood-status', '');
    head.append(this.#status);

    // ── Now ──
    const now = el('div', 'mood-now');
    this.#icon = el('div', 'mood-icon');
    this.#icon.setAttribute('aria-hidden', 'true');
    const text = el('div', 'mood-text');
    this.#label = el('p', 'mood-label', '');
    this.#label.dataset.testid = 'boredom-state';
    this.#label.setAttribute('role', 'status');
    this.#what = el('p', 'mood-what', '');
    const meta = el('div', 'mood-meta');
    this.#since = el('span', 'mood-since', '');
    const points = el('div', 'mood-strength');
    points.title = `${String(HEURISTIC_CONFIG.boredom.possiblyBoredPoints)} points: possibly bored · ${String(HEURISTIC_CONFIG.boredom.boredPoints)}: bored`;
    const track = el('span', 'mood-strength-track boredom-points-track');
    this.#pointsBar = el('span', 'mood-strength-bar');
    track.append(this.#pointsBar);
    this.#pointsText = el('span', 'mood-strength-text', '');
    points.append(track, this.#pointsText);
    meta.append(this.#since, points);
    text.append(this.#label, this.#what, meta);
    now.append(this.#icon, text);

    // ── Evidence ──
    const c = HEURISTIC_CONFIG.boredom;
    const ev = el('div', 'mood-evidence');
    ev.append(el('p', 'mood-sub', 'Evidence · points towards boredom'));
    this.#row(ev, 'yawn', `Yawns (${String(c.eventWindowSeconds / 60)} min)`, 'count');
    this.#row(ev, 'underload', 'Load Low', 'share');
    this.#row(ev, 'lowEngagement', 'Engagement Low', 'share');
    this.#row(ev, 'gazeWander', 'Gaze wandering', 'z');
    this.#row(ev, 'fidget', 'Head restless', 'z');
    ev.append(el('p', 'mood-sub boredom-sub-gap', 'Overrides'));
    this.#row(ev, 'perclos', 'Eyes closed (drowsy)', 'share');
    this.#row(ev, 'highLoad', 'Load High (busy)', 'share');
    this.#busyRow = this.#rows.get('highLoad') ?? null;

    // ── Timeline ──
    const tl = el('div', 'mood-history');
    const tlHead = el('div', 'mood-history-head');
    tlHead.append(
      el('p', 'mood-sub', `Last ${String(HISTORY_SECONDS / 60)} min`),
      el('span', 'mood-sub mood-now-tag', 'now'),
    );
    this.#timeline = el('div', 'mood-timeline');
    this.#timeline.setAttribute('role', 'img');
    this.#timeline.setAttribute('aria-label', 'Boredom over the last five minutes');
    const legend = el('div', 'mood-legend');
    for (const v of LEGEND) {
      const item = el('span', 'mood-legend-item');
      const sw = el('span', 'mood-swatch boredom-swatch');
      sw.dataset.bored = v;
      item.append(sw, document.createTextNode(LEGEND_LABEL[v]));
      legend.append(item);
    }
    tl.append(tlHead, this.#timeline, legend);

    const body = el('div', 'mood-body');
    body.append(now, ev);
    const note = el(
      'p',
      'mood-note',
      'Apparent boredom from yawning, gaze, head movement and the load estimate, compared with your own baseline. A hand-tuned rule, not yet validated; it is not sent to other components and stays on this device.',
    );
    this.element.append(head, body, tl, note);
    this.reset();
  }

  /** `status` is the sensor's current status, used to explain a missing reading. */
  update(r: BoredomReading, status: LoadSensorStatus): void {
    const view: View = r.state ?? 'none';
    this.#history.push(view);
    if (this.#history.length > HISTORY_SECONDS) this.#history.shift();
    this.#sinceSeconds = view === this.#shown ? this.#sinceSeconds + 1 : 1;
    this.#show(view);
    if (r.state === null) {
      const wait = waitingText(status);
      if (this.#label.textContent !== wait.label) this.#label.textContent = wait.label;
      if (this.#what.textContent !== wait.what) this.#what.textContent = wait.what;
    }

    const c = HEURISTIC_CONFIG.boredom;
    this.#since.textContent = r.state === null ? '' : `for ${clock(this.#sinceSeconds)}`;
    const share = Math.min(1, r.points / (c.boredPoints + 1));
    this.#pointsBar.style.width = `${String(Math.round(share * 100))}%`;
    this.#pointsText.textContent = `${String(r.points)} / ${String(c.boredPoints)} points`;

    this.#status.textContent =
      r.state === null ? 'Waiting' : r.veto === 'working_hard' ? 'Live · load mostly High' : 'Live';
    this.#status.dataset.tone = r.state === null ? 'warn' : 'live';

    const e = r.evidence;
    // Full bar at the count that reaches `bored` alone (3+).
    this.#setRow(
      'yawn',
      e.yawns / c.yawnPoints.length,
      String(e.yawns),
      r.cues.yawn,
      `+${String(BoredomEstimator.yawnPoints(Math.max(1, e.yawns)))}`,
    );
    this.#setRow('underload', e.underload, pct(e.underload), r.cues.underload, '+1');
    this.#setRow(
      'lowEngagement',
      e.lowEngagement,
      pct(e.lowEngagement),
      r.cues.lowEngagement,
      '+1',
    );
    this.#setZ('gazeWander', e.gazeWander, r.cues.gazeWander);
    this.#setZ('fidget', e.fidget, r.cues.fidget);
    // Overrides: bar scaled so the cut-off sits at 2/3 of the track.
    this.#setRow(
      'perclos',
      e.perclos / (c.drowsyPerclos * 1.5),
      pct(e.perclos),
      r.veto === 'drowsy',
      'tired',
    );
    this.#setRow(
      'highLoad',
      e.highLoad,
      pct(e.highLoad),
      r.veto === 'working_hard',
      r.busyVetoActive ? 'busy' : 'off',
    );
    if (this.#busyRow) {
      // Shown but switched off while load comes from the heuristic-0 placeholder.
      this.#busyRow.row.dataset.off = String(!r.busyVetoActive);
      this.#busyRow.row.title = r.busyVetoActive
        ? ''
        : 'Off: load comes from the heuristic-0 placeholder, which is not trusted to overrule yawning and gaze. Turns on with the trained model.';
    }

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
    this.element.dataset.bored = view;
    this.#label.textContent = info.label;
    this.#what.textContent = info.what;
    this.#icon.replaceChildren(icon(info.face));
    this.#icon.classList.remove('mood-swap');
    requestAnimationFrame(() => {
      this.#icon.classList.add('mood-swap');
    });
  }

  #row(parent: HTMLElement, key: RowKey, label: string, kind: 'share' | 'z' | 'count'): void {
    const row = el('div', 'mood-ev-row boredom-ev-row');
    row.dataset.kind = kind === 'z' ? 'z' : 'share';
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
    r.value.textContent = value;
    r.chip.textContent = chip;
  }

  #setZ(key: 'gazeWander' | 'fidget', z: number, met: boolean): void {
    const r = this.#rows.get(key);
    if (!r) return;
    r.row.dataset.off = 'false';
    r.row.dataset.met = String(met);
    const f = clamp(z / Z_RANGE, -1, 1) * 50;
    r.fill.style.left = `${String(f >= 0 ? 50 : 50 + f)}%`;
    r.fill.style.width = `${String(Math.abs(f))}%`;
    r.value.textContent = `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}`;
    r.chip.textContent = '+1';
  }

  #renderTimeline(): void {
    const parts: HTMLElement[] = [];
    const offset = HISTORY_SECONDS - this.#history.length;
    let start = 0;
    for (let i = 1; i <= this.#history.length; i += 1) {
      const v = this.#history[start];
      if (v === undefined) break;
      if (i < this.#history.length && this.#history[i] === v) continue;
      const seg = el('span', 'mood-seg boredom-seg');
      seg.dataset.bored = v;
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
