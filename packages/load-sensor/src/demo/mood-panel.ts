import type { Mood, MoodEvidence, MoodReading, MoodSegment } from './mood.js';
import { MOOD_CONFIG } from './mood.js';

/**
 * "Mood" card on the Signals tab: the apparent mood now (mood.ts), how long it
 * has lasted and how clear it is, the evidence behind it, a five-minute
 * timeline and the latest changes. Display only; nothing here is sent.
 */

interface MoodInfo {
  readonly label: string;
  /** What the face or eyes are doing, in plain words. */
  readonly what: string;
  /** Inline SVG body for a 24×24 face icon (static constants, never user data). */
  readonly face: string;
}

const HEAD = '<circle cx="12" cy="12" r="9"/>';
const EYES = '<path d="M9 9.5v.5M15 9.5v.5"/>';

const MOODS: Record<Mood, MoodInfo> = {
  happy: {
    label: 'Happy',
    what: 'Mouth corners lifted and the mouth wider than usual: a smile.',
    face: `${HEAD}${EYES}<path d="M8 13.5c1 1.8 2.4 2.7 4 2.7s3-.9 4-2.7"/>`,
  },
  sad: {
    label: 'Sad',
    what: 'Mouth corners pulled down compared with your neutral face.',
    face: `${HEAD}${EYES}<path d="M8.5 16.5c.9-1.3 2.1-2 3.5-2s2.6.7 3.5 2"/>`,
  },
  surprised: {
    label: 'Surprised',
    what: 'Brows raised high and the mouth open.',
    face: `${HEAD}<path d="M8 7.5l2-1M16 7.5l-2-1"/>${EYES}<circle cx="12" cy="15.5" r="1.8"/>`,
  },
  frustrated: {
    label: 'Frustrated',
    what: 'Brows drawn together and lips pressed.',
    face: `${HEAD}<path d="M7.5 8l3 1M16.5 8l-3 1"/><path d="M9 11v.5M15 11v.5"/><path d="M9 16h6"/>`,
  },
  confused: {
    label: 'Confused',
    what: 'Brows drawn together or raised, without a smile.',
    face: `${HEAD}<path d="M8 8l2.5-.5M14 7.5l2.5 1"/>${EYES}<path d="M9 15.5c1-.8 2-.8 3 0s2 .8 3 0"/>`,
  },
  drowsy: {
    label: 'Drowsy',
    what: 'Eyes closed for much of the last 30 s, or long closures and yawns.',
    face: `${HEAD}<path d="M8 10.5h2.5M13.5 10.5H16"/><path d="M10 15.5h4"/>`,
  },
  focused: {
    label: 'Focused',
    what: 'Looking at the screen with steady gaze and a calm face.',
    face: `${HEAD}${EYES}<path d="M9.5 15h5"/>`,
  },
  distracted: {
    label: 'Distracted',
    what: 'Mostly looking away from the screen.',
    face: `${HEAD}<path d="M10 9.5v.5M16 9.5v.5"/><path d="M10 15h4"/>`,
  },
  neutral: {
    label: 'Neutral',
    what: 'Nothing stands out from your usual face.',
    face: `${HEAD}${EYES}<path d="M9 15h6"/>`,
  },
  'no-face': {
    label: 'No face',
    what: 'No face in view, so no mood is read.',
    face: '<circle cx="12" cy="12" r="9" stroke-dasharray="2.5 2.5"/>',
  },
};

/** Timeline legend order. */
const LEGEND: readonly Mood[] = [
  'happy',
  'focused',
  'neutral',
  'surprised',
  'confused',
  'frustrated',
  'sad',
  'drowsy',
  'distracted',
  'no-face',
];

interface EvidenceRow {
  readonly key: Exclude<keyof MoodEvidence, 'model'>;
  readonly label: string;
  /** 'z' = centred bar over ±3 (baseline in the middle); 'share' = 0..100 %. */
  readonly kind: 'z' | 'share';
}

const EVIDENCE: readonly EvidenceRow[] = [
  { key: 'smile', label: 'Mouth corners up', kind: 'z' },
  { key: 'mouthWidth', label: 'Mouth width', kind: 'z' },
  { key: 'browRaise', label: 'Brows raised', kind: 'z' },
  { key: 'browFurrow', label: 'Brows together', kind: 'z' },
  { key: 'lipPress', label: 'Lips pressed', kind: 'z' },
  { key: 'mouthOpen', label: 'Mouth open', kind: 'z' },
  { key: 'eyesClosed', label: 'Eyes closed (30 s)', kind: 'share' },
  { key: 'onScreen', label: 'Looking at screen', kind: 'share' },
];

const Z_RANGE = 3;

export class MoodPanel {
  readonly element: HTMLElement;
  readonly #legendItems = new Map<Mood, HTMLElement>();
  readonly #icon: HTMLElement;
  readonly #label: HTMLElement;
  readonly #what: HTMLElement;
  readonly #since: HTMLElement;
  readonly #strengthBar: HTMLElement;
  readonly #strengthText: HTMLElement;
  readonly #status: HTMLElement;
  readonly #bars = new Map<
    keyof MoodEvidence,
    { fill: HTMLElement; value: HTMLElement; row: HTMLElement }
  >();
  readonly #timeline: HTMLElement;
  readonly #changes: HTMLElement;
  #shown: Mood | null = null;

  constructor() {
    this.element = el('section', 'card mood-card');
    this.element.dataset.testid = 'mood';

    const head = el('div', 'card-header');
    head.append(el('h2', 'card-title', 'Mood'));
    this.#status = el('span', 'mood-status', '');
    head.append(this.#status);

    // ── Now ──
    const now = el('div', 'mood-now');
    this.#icon = el('div', 'mood-icon');
    this.#icon.setAttribute('aria-hidden', 'true');
    const text = el('div', 'mood-text');
    this.#label = el('p', 'mood-label', '');
    this.#label.dataset.testid = 'mood-label';
    this.#label.setAttribute('role', 'status');
    this.#what = el('p', 'mood-what', '');
    const meta = el('div', 'mood-meta');
    this.#since = el('span', 'mood-since', '');
    const strength = el('div', 'mood-strength');
    const track = el('span', 'mood-strength-track');
    this.#strengthBar = el('span', 'mood-strength-bar');
    track.append(this.#strengthBar);
    this.#strengthText = el('span', 'mood-strength-text', '');
    strength.append(track, this.#strengthText);
    meta.append(this.#since, strength);
    text.append(this.#label, this.#what, meta);
    now.append(this.#icon, text);

    // ── Evidence ──
    const ev = el('div', 'mood-evidence');
    ev.append(el('p', 'mood-sub', 'Evidence · compared with your neutral face'));
    for (const r of EVIDENCE) {
      const row = el('div', 'mood-ev-row');
      row.dataset.kind = r.kind;
      const name = el('span', 'mood-ev-name', r.label);
      const bar = el('span', 'mood-ev-bar');
      const fill = el('span', 'mood-ev-fill');
      bar.append(fill);
      const value = el('span', 'mood-ev-value', '–');
      row.append(name, bar, value);
      ev.append(row);
      this.#bars.set(r.key, { fill, value, row });
    }

    // ── Timeline ──
    const tl = el('div', 'mood-history');
    const tlHead = el('div', 'mood-history-head');
    tlHead.append(
      el('p', 'mood-sub', `Last ${String(MOOD_CONFIG.historySeconds / 60)} min`),
      el('span', 'mood-sub mood-now-tag', 'now'),
    );
    this.#timeline = el('div', 'mood-timeline');
    this.#timeline.setAttribute('role', 'img');
    this.#timeline.setAttribute('aria-label', 'Mood over the last five minutes');
    const legend = el('div', 'mood-legend');
    for (const m of LEGEND) {
      const item = el('span', 'mood-legend-item');
      this.#legendItems.set(m, item);
      const sw = el('span', 'mood-swatch');
      sw.dataset.mood = m;
      item.append(sw, document.createTextNode(MOODS[m].label));
      legend.append(item);
    }
    this.#changes = el('ol', 'mood-changes');
    tl.append(tlHead, this.#timeline, legend, el('p', 'mood-sub', 'Latest changes'), this.#changes);

    const body = el('div', 'mood-body');
    body.append(now, ev);
    const note = el(
      'p',
      'mood-note',
      'Apparent mood from facial expression and eye behaviour, compared with your own baseline. It is not a measure of how you feel, is not sent to other components, and stays on this device.',
    );
    this.element.append(head, body, tl, note);
    this.reset();
  }

  update(r: MoodReading, history: readonly MoodSegment[]): void {
    const info = MOODS[r.mood];
    this.element.dataset.mood = r.mood;
    if (this.#shown !== r.mood) {
      this.#shown = r.mood;
      this.#label.textContent = info.label;
      this.#what.textContent = info.what;
      this.#icon.replaceChildren(icon(info.face));
      // Restart the swap animation.
      this.#icon.classList.remove('mood-swap');
      requestAnimationFrame(() => {
        this.#icon.classList.add('mood-swap');
      });
    }
    const end = history[history.length - 1]?.endMs ?? r.sinceMs;
    this.#since.textContent = `for ${clock(end - r.sinceMs)}`;
    const pct = Math.round(r.strength * 100);
    this.#strengthBar.style.width = `${String(pct)}%`;
    this.#strengthText.textContent =
      r.strength >= 0.75 ? 'strong' : r.strength >= 0.4 ? 'clear' : 'slight';
    this.#status.textContent = !r.expression
      ? 'Expression features off (FR3): eyes and gaze only'
      : r.source === 'model'
        ? 'Live · expressions from the trained model'
        : r.calibrating
          ? 'Learning your neutral face… expression moods start after the baseline'
          : 'Live · expressions from hand-picked rules';
    this.#status.dataset.tone = !r.expression || r.calibrating ? 'warn' : 'live';

    for (const row of EVIDENCE) {
      const b = this.#bars.get(row.key);
      if (!b) continue;
      const v = r.evidence[row.key];
      b.row.dataset.off = String(v === null);
      if (v === null) {
        b.fill.style.left = '50%';
        b.fill.style.width = '0';
        b.value.textContent = '–';
        continue;
      }
      if (row.kind === 'share') {
        b.fill.style.left = '0';
        b.fill.style.width = `${String(clamp(v, 0, 1) * 100)}%`;
        b.value.textContent = `${String(Math.round(v * 100))} %`;
      } else {
        const f = clamp(v / Z_RANGE, -1, 1) * 50;
        b.fill.style.left = `${String(f >= 0 ? 50 : 50 + f)}%`;
        b.fill.style.width = `${String(Math.abs(f))}%`;
        b.row.dataset.high = String(Math.abs(v) >= 1);
        b.value.textContent = `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
      }
    }

    this.#renderTimeline(history, end);
  }

  /** Moods switched off in the admin panel drop out of the legend. */
  setHidden(moods: Iterable<Mood>): void {
    const hidden = new Set(moods);
    for (const [m, item] of this.#legendItems) item.hidden = hidden.has(m);
  }

  reset(): void {
    this.#shown = null;
    this.element.dataset.mood = 'no-face';
    this.#label.textContent = 'Not sensing';
    this.#what.textContent = 'Turn sensing on. The mood reading starts with the camera.';
    this.#icon.replaceChildren(icon(MOODS['no-face'].face));
    this.#since.textContent = '';
    this.#strengthBar.style.width = '0';
    this.#strengthText.textContent = '';
    this.#status.textContent = '';
    for (const b of this.#bars.values()) {
      b.row.dataset.off = 'true';
      b.fill.style.width = '0';
      b.value.textContent = '–';
    }
    this.#timeline.replaceChildren(el('span', 'mood-timeline-empty', 'No mood yet'));
    this.#changes.replaceChildren(el('li', 'mood-change-empty', 'No changes yet'));
  }

  #renderTimeline(history: readonly MoodSegment[], end: number): void {
    const span = MOOD_CONFIG.historySeconds * 1000;
    const t0 = end - span;
    const parts = history
      .filter((s) => s.endMs > t0)
      .map((s) => {
        const seg = el('span', 'mood-seg');
        seg.dataset.mood = s.mood;
        const a = Math.max(s.startMs, t0);
        seg.style.left = `${String(((a - t0) / span) * 100)}%`;
        seg.style.width = `${String(((s.endMs - a) / span) * 100)}%`;
        seg.title = `${MOODS[s.mood].label} · ${clock(s.endMs - s.startMs)}`;
        return seg;
      });
    this.#timeline.replaceChildren(...parts);

    const changes = history.slice(-6).reverse();
    this.#changes.replaceChildren(
      ...changes.map((s, i) => {
        const li = el('li', 'mood-change');
        const sw = el('span', 'mood-swatch');
        sw.dataset.mood = s.mood;
        const ago = el(
          'span',
          'mood-change-ago',
          i === 0 ? 'now' : `${clock(end - s.startMs)} ago`,
        );
        li.append(
          sw,
          el('span', 'mood-change-label', MOODS[s.mood].label),
          el('span', 'mood-change-dur', clock(s.endMs - s.startMs)),
          ago,
        );
        return li;
      }),
    );
  }
}

/** m:ss from ms. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
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
