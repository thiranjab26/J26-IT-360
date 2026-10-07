import {
  FEATURE_CONFIG,
  FEATURE_INDEX,
  FEATURES,
  type FeatureGroup,
} from '../core/features/index.js';
import type {
  FrameFeatures,
  NormalisedSecond,
  PipelineState,
  Presence,
} from '../core/window/index.js';
import { HoverBus, StripChart, type ChartBand, type ChartPoint } from './charts.js';

/** How much history the charts show. */
const EAR_SPAN_MS = 20_000;
const FEATURE_SPAN_MS = 90_000;
/** KPI windows. */
const RATE_WINDOW_S = 60;
const DROWSY_WINDOW_S = 300;

const GROUP_TITLES: Record<FeatureGroup, { title: string; note: string }> = {
  blink: { title: 'Eyes & blinks', note: 'EAR state machine, frame-timed' },
  gaze: { title: 'Gaze proxy', note: 'Iris offset in the face frame' },
  head: { title: 'Head movement', note: 'Pose from landmark geometry' },
  brow: { title: 'Brows', note: 'Normalised by inter-ocular distance' },
  expression: { title: 'Mouth (FR3)', note: 'Ablatable expression proxies' },
};

const PRESENCE_TEXT: Record<Presence, { label: string; hint: string; tone: string }> = {
  present: { label: 'Present', hint: 'Face visible, facing the screen', tone: 'good' },
  away: { label: 'Looking away', hint: 'Off-screen for more than 3 s', tone: 'warn' },
  absent: { label: 'Absent', hint: 'No face for more than 2 s', tone: 'bad' },
  unknown: { label: 'Waiting', hint: 'No frames yet', tone: 'idle' },
};

export type ValueMode = 'raw' | 'z';

/**
 * The "Signals" section: calibration, live KPI tiles, the per-frame EAR trace
 * and the 14 per-second features as small multiples.
 *
 * Only derived numbers reach this panel; it never sees a frame (§9).
 */
export class SignalsPanel {
  readonly element: HTMLElement;
  /** Slot for page-level controls (switches), placed in the section header. */
  readonly toolbar: HTMLElement;

  readonly #hover = new HoverBus();
  readonly #earChart: StripChart;
  readonly #featureCharts = new Map<number, StripChart>();
  readonly #calib: { root: HTMLElement; bar: HTMLElement; text: HTMLElement; meta: HTMLElement };
  readonly #kpi: Record<string, { value: HTMLElement; caption: HTMLElement; root: HTMLElement }> =
    {};
  readonly #gazeDot: SVGCircleElement;
  readonly #modeButtons: Record<ValueMode, HTMLButtonElement>;

  #mode: ValueMode = 'raw';
  #earPoints: ChartPoint[] = [];
  #blinkMarks: number[] = [];
  #seconds: NormalisedSecond[] = [];
  #now = 0;
  #threshold: number | null = null;
  #lastPose = { yaw: Number.NaN, pitch: Number.NaN, roll: Number.NaN };

  constructor() {
    this.element = el('section', 'signals');
    this.element.setAttribute('aria-labelledby', 'signals-title');

    // ── Header ──
    const head = el('header', 'section-head');
    const titles = el('div');
    const h2 = el('h2', 'section-title', 'Signals');
    h2.id = 'signals-title';
    const sub = el(
      'p',
      'section-sub',
      'Derived on this device from landmark geometry. Only these numbers leave the camera code — never images or the face mesh.',
    );
    titles.append(h2, sub);
    this.toolbar = el('div', 'toolbar');
    const seg = el('div', 'segmented');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Feature values');
    const raw = segButton('Raw', 'mode-raw');
    const z = segButton('z-score', 'mode-z');
    seg.append(raw, z);
    this.#modeButtons = { raw, z };
    raw.addEventListener('click', () => {
      this.setMode('raw');
    });
    z.addEventListener('click', () => {
      this.setMode('z');
    });
    this.toolbar.append(seg);
    head.append(titles, this.toolbar);

    // ── Calibration ──
    const calib = el('div', 'calibration card');
    calib.dataset.testid = 'calibration';
    const calibTop = el('div', 'calibration-top');
    const calibText = el('p', 'calibration-text', 'Waiting for the camera');
    const calibMeta = el('span', 'calibration-meta', '');
    calibTop.append(calibText, calibMeta);
    const track = el('div', 'progress');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const bar = el('div', 'progress-bar');
    track.append(bar);
    calib.append(calibTop, track);
    this.#calib = { root: calib, bar, text: calibText, meta: calibMeta };

    // ── KPI tiles ──
    const kpis = el('div', 'kpis');
    for (const [key, label] of [
      ['presence', 'Presence'],
      ['blinkRate', 'Blink rate'],
      ['closed', 'Eyes closed'],
      ['pose', 'Head pose'],
      ['drowsy', 'Drowsiness events'],
    ] as const) {
      const tile = el('div', 'kpi');
      tile.dataset.kpi = key;
      const l = el('p', 'kpi-label', label);
      const value = el('p', 'kpi-value', '–');
      value.dataset.testid = `kpi-${key}`;
      const caption = el('p', 'kpi-caption', '');
      tile.append(l, value, caption);
      kpis.append(tile);
      this.#kpi[key] = { value, caption, root: tile };
    }
    // Gaze pad: iris offset from neutral, with the "centred" tolerance ring.
    const gazeTile = el('div', 'kpi kpi-gaze');
    const gazeText = el('div');
    gazeText.append(
      el('p', 'kpi-label', 'Gaze'),
      el('p', 'kpi-caption', 'Iris vs your neutral · ring = centred'),
    );
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-1 -1 2 2');
    svg.setAttribute('class', 'gaze-pad');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Gaze proxy position');
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('r', String(FEATURE_CONFIG.gaze.centredTolerance / GAZE_RANGE));
    ring.setAttribute('class', 'gaze-ring');
    const cross = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    cross.setAttribute('d', 'M-1 0H1M0 -1V1');
    cross.setAttribute('class', 'gaze-cross');
    this.#gazeDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.#gazeDot.setAttribute('r', '0.11');
    this.#gazeDot.setAttribute('class', 'gaze-dot');
    svg.append(cross, ring, this.#gazeDot);
    gazeTile.append(gazeText, svg);
    kpis.append(gazeTile);

    // ── EAR trace ──
    const earCard = el('div', 'card chart-card');
    const earHead = el('div', 'chart-card-head');
    earHead.append(
      el('h3', 'chart-card-title', 'Eye aspect ratio · per frame'),
      legendItem('threshold', 'Blink threshold (75 % of your open EAR)'),
      legendItem('marker', 'Blink'),
    );
    this.#earChart = new StripChart({
      title: 'EAR',
      unit: 'ratio',
      description: 'Eye aspect ratio per frame over the last 20 seconds, with the blink threshold.',
      spanMs: EAR_SPAN_MS,
      height: 120,
      format: (v) => v.toFixed(3),
      hover: new HoverBus(),
    });
    earCard.append(earHead, this.#earChart.element, timeAxis(EAR_SPAN_MS));

    // ── Feature small multiples ──
    const grid = el('div', 'feature-grid');
    const groups = new Map<FeatureGroup, HTMLElement>();
    for (const f of FEATURES) {
      let body = groups.get(f.group);
      if (!body) {
        const card = el('div', 'card group-card');
        const gh = el('div', 'chart-card-head');
        gh.append(
          el('h3', 'chart-card-title', GROUP_TITLES[f.group].title),
          el('span', 'chart-card-note', GROUP_TITLES[f.group].note),
        );
        body = el('div', 'group-body');
        card.append(gh, body);
        grid.append(card);
        groups.set(f.group, body);
      }
      const index = FEATURE_INDEX[f.name];
      const chart = new StripChart({
        title: humanise(f.name),
        unit: f.unit,
        description: f.description,
        spanMs: FEATURE_SPAN_MS,
        height: 46,
        compact: true,
        hover: this.#hover,
        format: formatter(f.unit),
      });
      chart.element.dataset.testid = `feature-${f.name}`;
      this.#featureCharts.set(index, chart);
      body.append(chart.element);
    }
    const legend = el('div', 'grid-legend');
    legend.append(
      legendItem('calibration', 'Baseline (calibration)'),
      legendItem('invalid', 'No face (< 50 % of frames)'),
      el('span', 'grid-legend-axis', 'Last 90 s · hover to compare all features at one moment'),
    );

    this.element.append(head, calib, kpis, earCard, legend, grid);
    this.setMode('raw');
    this.setState(null);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this.#earChart.refreshTheme();
      for (const c of this.#featureCharts.values()) c.refreshTheme();
    });
  }

  setMode(mode: ValueMode): void {
    this.#mode = mode;
    for (const [m, b] of Object.entries(this.#modeButtons)) {
      b.setAttribute('aria-pressed', String(m === mode));
    }
    this.#renderFeatures();
  }

  pushFrame(f: FrameFeatures): void {
    this.#now = f.tMs;
    this.#earPoints.push({ t: f.tMs, v: f.signals?.ear ?? null });
    if (f.closure?.kind === 'blink') this.#blinkMarks.push(f.closure.endMs);
    const cutoff = f.tMs - EAR_SPAN_MS - 1000;
    while ((this.#earPoints[0]?.t ?? Infinity) < cutoff) this.#earPoints.shift();
    while ((this.#blinkMarks[0] ?? Infinity) < cutoff) this.#blinkMarks.shift();
    if (f.reference) this.#threshold = f.reference.ear * FEATURE_CONFIG.blink.closeRatio;

    this.#earChart.update({
      points: this.#earPoints,
      now: f.tMs,
      markers: this.#blinkMarks,
      threshold: this.#threshold,
    });

    if (f.signals) {
      this.#lastPose = { yaw: f.signals.yaw, pitch: f.signals.pitch, roll: f.signals.roll };
      const ref = f.reference;
      const dx = ref ? f.signals.irisDx - ref.irisDx : 0;
      const dy = ref ? f.signals.irisDy - ref.irisDy : 0;
      // Image x is mirrored in the preview, so mirror the pad too: it moves like the user's eyes.
      this.#gazeDot.setAttribute('cx', String(clamp(-dx / GAZE_RANGE, -0.9, 0.9)));
      this.#gazeDot.setAttribute('cy', String(clamp(dy / GAZE_RANGE, -0.9, 0.9)));
      this.#gazeDot.dataset.centred = String(f.gazeCentred);
      const pose = ref
        ? `${deg(f.signals.yaw - ref.yaw)} · ${deg(f.signals.pitch - ref.pitch)} · ${deg(f.signals.roll)}`
        : `${deg(f.signals.yaw)} · ${deg(f.signals.pitch)} · ${deg(f.signals.roll)}`;
      this.#setKpi(
        'pose',
        pose,
        ref ? 'yaw · pitch · roll, from your neutral' : 'yaw · pitch · roll',
      );
    } else {
      this.#gazeDot.dataset.centred = 'none';
    }
    this.#setPresence(f.presence);
  }

  pushSecond(s: NormalisedSecond): void {
    this.#seconds.push(s);
    while (this.#seconds.length > DROWSY_WINDOW_S + 10) this.#seconds.shift();
    this.#renderKpis();
    this.#renderFeatures();
  }

  setState(state: PipelineState | null): void {
    const c = this.#calib;
    if (!state) {
      c.root.dataset.phase = 'idle';
      c.text.textContent = 'Turn sensing on to start your baseline';
      c.meta.textContent = `${String(FEATURE_CONFIG.baseline.seconds)} s`;
      c.bar.style.width = '0%';
      return;
    }
    const pct = Math.round(state.calibrationProgress * 100);
    c.bar.style.width = `${String(pct)}%`;
    c.bar.parentElement?.setAttribute('aria-valuenow', String(pct));
    c.root.dataset.phase = state.phase;
    if (state.phase === 'calibrating') {
      c.text.textContent = 'Calibrating — look at the screen as you normally would';
      c.meta.textContent = `${String(state.calibrationSeconds)} / ${String(state.calibrationTarget)} s`;
    } else {
      c.text.textContent = state.classifiable
        ? 'Baseline ready · window full, signals are normalised to you'
        : `Baseline ready · filling the ${String(FEATURE_CONFIG.window.seconds)} s window`;
      c.meta.textContent = `window ${String(state.windowSeconds)}/${String(FEATURE_CONFIG.window.seconds)} s · ${String(Math.round(state.windowInvalidFraction * 100))} % no face`;
    }
  }

  reset(): void {
    this.#earPoints = [];
    this.#blinkMarks = [];
    this.#seconds = [];
    this.#threshold = null;
    this.#earChart.update({ points: [], now: this.#now });
    this.#renderFeatures();
    this.#renderKpis();
    this.#setPresence('unknown');
    this.#setKpi('pose', '–', 'yaw · pitch · roll');
    this.setState(null);
  }

  #setPresence(p: Presence): void {
    const info = PRESENCE_TEXT[p];
    this.#setKpi('presence', info.label, info.hint);
    const tile = this.#kpi.presence?.root;
    if (tile) tile.dataset.tone = info.tone;
  }

  #renderKpis(): void {
    const recent = this.#seconds.slice(-RATE_WINDOW_S).filter((s) => s.valid);
    if (recent.length === 0) {
      this.#setKpi('blinkRate', '–', `per minute, last ${String(RATE_WINDOW_S)} s`);
      this.#setKpi('closed', '–', 'PERCLOS proxy, last 60 s');
      this.#setKpi('drowsy', '–', 'last 5 min');
      return;
    }
    const sum = (rows: NormalisedSecond[], f: number): number =>
      rows.reduce((a, s) => a + (s.raw[f] ?? 0), 0);
    const perMin = (sum(recent, FEATURE_INDEX.blink_count) * 60) / recent.length;
    const closed = sum(recent, FEATURE_INDEX.eyes_closed_fraction) / recent.length;
    this.#setKpi(
      'blinkRate',
      `${perMin.toFixed(0)} /min`,
      `over ${String(recent.length)} s with a face`,
    );
    this.#setKpi('closed', `${(closed * 100).toFixed(1)} %`, 'PERCLOS proxy, last 60 s');

    const drowsy = this.#seconds.slice(-DROWSY_WINDOW_S);
    const long = drowsy.reduce((a, s) => a + s.aux.longClosures, 0);
    const yawns = drowsy.reduce((a, s) => a + s.aux.yawns, 0);
    const nods = drowsy.reduce((a, s) => a + s.aux.nods, 0);
    this.#setKpi(
      'drowsy',
      String(long + yawns + nods),
      `${plural(long, 'long closure')} · ${plural(yawns, 'yawn')} · ${plural(nods, 'nod')} · 5 min`,
    );
    const tile = this.#kpi.drowsy?.root;
    if (tile) tile.dataset.tone = long + yawns + nods > 0 ? 'warn' : 'idle';
  }

  #renderFeatures(): void {
    const bands: ChartBand[] = [];
    for (const s of this.#seconds) {
      if (!s.valid) bands.push({ start: s.startMs, end: s.startMs + 1000, kind: 'invalid' });
      else if (s.phase === 'calibrating')
        bands.push({ start: s.startMs, end: s.startMs + 1000, kind: 'calibration' });
    }
    const now = this.#seconds.length
      ? (this.#seconds[this.#seconds.length - 1]?.startMs ?? 0) + 1000
      : this.#now;
    for (const [index, chart] of this.#featureCharts) {
      const points = this.#seconds.map((s) => {
        const value = this.#mode === 'z' ? s.z?.[index] : s.raw[index];
        return { t: s.startMs + 500, v: s.valid && value !== undefined ? value : null };
      });
      chart.update({ points, now, bands });
    }
  }

  #setKpi(key: string, value: string, caption: string): void {
    const k = this.#kpi[key];
    if (!k) return;
    if (k.value.textContent !== value) k.value.textContent = value;
    if (k.caption.textContent !== caption) k.caption.textContent = caption;
  }

  /** Last head pose, for the overlay label. */
  get pose(): { yaw: number; pitch: number; roll: number } {
    return this.#lastPose;
  }

  get mode(): ValueMode {
    return this.#mode;
  }
}

/** Gaze pad full-scale: ±0.25 eye widths (about the iris's full travel). */
const GAZE_RANGE = 0.25;

function formatter(unit: string): (v: number) => string {
  return (v) => {
    switch (unit) {
      case 'count':
        return v.toFixed(0);
      case 'ms':
        return `${v.toFixed(0)} ms`;
      case 'fraction':
        return `${(v * 100).toFixed(0)} %`;
      case 'deg':
        return `${v.toFixed(1)}°`;
      case 'deg/s':
        return `${v.toFixed(1)}°/s`;
      default:
        return v.toFixed(3);
    }
  };
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

function humanise(name: string): string {
  const text = name.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function deg(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}°`;
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

function segButton(label: string, testId: string): HTMLButtonElement {
  const b = el('button', 'seg', label);
  b.type = 'button';
  b.dataset.testid = testId;
  return b;
}

function legendItem(kind: string, label: string): HTMLElement {
  const item = el('span', 'legend-item');
  const swatch = el('span', `legend-swatch legend-${kind}`);
  swatch.setAttribute('aria-hidden', 'true');
  item.append(swatch, document.createTextNode(label));
  return item;
}

function timeAxis(spanMs: number): HTMLElement {
  const axis = el('div', 'time-axis');
  const s = spanMs / 1000;
  for (const t of [s, (s * 3) / 4, s / 2, s / 4]) axis.append(el('span', '', `−${String(t)} s`));
  axis.append(el('span', '', 'now'));
  return axis;
}
