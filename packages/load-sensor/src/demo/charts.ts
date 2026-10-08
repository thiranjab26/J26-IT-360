/**
 * Live strip charts for the debug page: one series per chart (small
 * multiples), drawn on a canvas, sharing one hover crosshair.
 *
 * Design rules (dataviz method): one hue for every line because each chart has
 * a single series (identity comes from the title, not colour); 2 px lines;
 * recessive grid; gaps drawn as gaps, never bridged; text in text tokens;
 * values readable without hovering (the header shows the latest value) and on
 * hover (the header switches to the hovered value at the crosshair).
 */

export interface ChartPoint {
  /** Frame-clock time (ms). */
  readonly t: number;
  /** null = no data (face lost / invalid second): drawn as a gap. */
  readonly v: number | null;
}

export interface ChartBand {
  readonly start: number;
  readonly end: number;
  readonly kind: 'invalid' | 'calibration';
}

interface Theme {
  line: string;
  lineSoft: string;
  grid: string;
  text: string;
  threshold: string;
  marker: string;
  invalid: string;
  calibration: string;
  crosshair: string;
}

/** Reads chart colours from CSS custom properties, so light/dark follow the page theme. */
function readTheme(el: Element): Theme {
  const css = getComputedStyle(el);
  const v = (name: string): string => css.getPropertyValue(name).trim();
  return {
    line: v('--chart-line'),
    lineSoft: v('--chart-line-soft'),
    grid: v('--chart-grid'),
    text: v('--text-muted'),
    threshold: v('--chart-threshold'),
    marker: v('--chart-marker'),
    invalid: v('--chart-invalid'),
    calibration: v('--chart-calibration'),
    crosshair: v('--chart-crosshair'),
  };
}

/** Shared hover position (frame time) across all charts. */
export class HoverBus {
  #t: number | null = null;
  readonly #listeners = new Set<() => void>();

  get t(): number | null {
    return this.#t;
  }

  set(t: number | null): void {
    if (t === this.#t) return;
    this.#t = t;
    for (const l of this.#listeners) l();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export interface StripChartOptions {
  readonly title: string;
  readonly unit?: string;
  /** Longer text for screen readers and the title tooltip. */
  readonly description?: string;
  /** Visible time span (ms), right edge = now. */
  readonly spanMs: number;
  readonly height?: number;
  readonly format?: (v: number) => string;
  /** Always include these values in the y range (e.g. 0 for z-scores). */
  readonly include?: readonly number[];
  readonly hover?: HoverBus;
  readonly compact?: boolean;
  /**
   * Continuous scrolling: between data updates the time axis keeps moving with
   * the wall clock for up to this long (ms), so the chart glides instead of
   * jumping once per update. Set it to about one update interval. Display only:
   * points stay at their own frame times.
   */
  readonly liveLeadMs?: number;
}

export class StripChart {
  readonly element: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #value: HTMLElement;
  readonly #opts: StripChartOptions;
  readonly #format: (v: number) => string;
  /** Read lazily: computed styles are empty until the element is in the document. */
  #theme: Theme | null = null;
  #points: readonly ChartPoint[] = [];
  #bands: readonly ChartBand[] = [];
  #markers: readonly number[] = [];
  #threshold: number | null = null;
  #now = 0;
  /** Wall time (performance.now) of the last update, and the time the axis last showed. */
  #anchor = 0;
  #viewNow = 0;
  #width = 0;
  #height: number;
  #dirty = true;
  #frame = 0;

  constructor(options: StripChartOptions) {
    this.#opts = options;
    this.#format = options.format ?? ((v) => v.toFixed(2));
    this.#height = options.height ?? 64;

    this.element = document.createElement('figure');
    this.element.className = options.compact ? 'strip strip-compact' : 'strip';
    const head = document.createElement('figcaption');
    head.className = 'strip-head';
    const title = document.createElement('span');
    title.className = 'strip-title';
    title.textContent = options.title;
    if (options.description) title.title = options.description;
    const unit = document.createElement('span');
    unit.className = 'strip-unit';
    unit.textContent = options.unit ?? '';
    this.#value = document.createElement('span');
    this.#value.className = 'strip-value';
    this.#value.textContent = '–';
    head.append(title, unit, this.#value);

    this.#canvas = document.createElement('canvas');
    this.#canvas.className = 'strip-canvas';
    this.#canvas.style.height = `${String(this.#height)}px`;
    this.#canvas.setAttribute('role', 'img');
    this.#canvas.setAttribute('aria-label', options.description ?? options.title);
    const ctx = this.#canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.#ctx = ctx;
    this.element.append(head, this.#canvas);

    new ResizeObserver(() => {
      this.#resize();
    }).observe(this.#canvas);

    this.#canvas.addEventListener('pointermove', (e) => {
      const rect = this.#canvas.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      options.hover?.set(this.#viewNow - options.spanMs * (1 - frac));
    });
    this.#canvas.addEventListener('pointerleave', () => options.hover?.set(null));
    options.hover?.subscribe(() => {
      this.invalidate();
    });
  }

  /** Re-reads colours after a theme change. */
  refreshTheme(): void {
    this.#theme = null;
    this.invalidate();
  }

  update(data: {
    points: readonly ChartPoint[];
    now: number;
    bands?: readonly ChartBand[];
    markers?: readonly number[];
    threshold?: number | null;
  }): void {
    this.#points = data.points;
    this.#now = data.now;
    this.#anchor = performance.now();
    this.#bands = data.bands ?? [];
    this.#markers = data.markers ?? [];
    this.#threshold = data.threshold ?? null;
    this.invalidate();
  }

  invalidate(): void {
    this.#dirty = true;
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      if (this.#dirty) this.#draw();
      // Keep gliding while the lead window is open; idle charts stop redrawing.
      if (this.#gliding()) this.invalidate();
    });
  }

  #gliding(): boolean {
    const lead = this.#opts.liveLeadMs ?? 0;
    return (
      lead > 0 &&
      this.#width > 0 &&
      !document.hidden &&
      this.#points.length > 0 &&
      performance.now() - this.#anchor < lead
    );
  }

  /** Right-edge time: the newest data time plus wall time since it arrived, capped. */
  #axisNow(): number {
    const lead = this.#opts.liveLeadMs ?? 0;
    let now = this.#now + Math.min(Math.max(0, performance.now() - this.#anchor), lead);
    // Never step backwards by less than one lead (jitter in update timing);
    // a bigger step back is a reset and is followed.
    if (now < this.#viewNow && this.#viewNow - now <= lead) now = this.#viewNow;
    this.#viewNow = now;
    return now;
  }

  #resize(): void {
    const rect = this.#canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.#width = rect.width;
    this.#canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.#canvas.height = Math.max(1, Math.round(this.#height * dpr));
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.invalidate();
  }

  #draw(): void {
    this.#dirty = false;
    const ctx = this.#ctx;
    const w = this.#width;
    const h = this.#height;
    if (!this.#theme?.line) this.#theme = readTheme(this.element);
    const th = this.#theme;
    const span = this.#opts.spanMs;
    const now = this.#axisNow();
    const t0 = now - span;
    ctx.clearRect(0, 0, w, h);
    if (w <= 0) return;

    const x = (t: number): number => ((t - t0) / span) * w;
    const visible = this.#points.filter((p) => p.t >= t0 - 1000);
    const values = visible.flatMap((p) => (p.v === null ? [] : [p.v]));
    const [lo, hi] = yRange([
      ...values,
      ...(this.#opts.include ?? []),
      ...(this.#threshold === null ? [] : [this.#threshold]),
    ]);
    const padTop = 4;
    const padBottom = 4;
    const y = (v: number): number => padTop + (1 - (v - lo) / (hi - lo)) * (h - padTop - padBottom);

    // Bands: calibration period and invalid (no face) stretches.
    for (const b of this.#bands) {
      if (b.end < t0) continue;
      ctx.fillStyle = b.kind === 'invalid' ? th.invalid : th.calibration;
      ctx.fillRect(x(b.start), 0, Math.max(1, x(b.end) - x(b.start)), h);
    }

    // Recessive grid: mid line and zero line when in range.
    ctx.lineWidth = 1;
    ctx.strokeStyle = th.grid;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(h / 2) + 0.5);
    ctx.lineTo(w, Math.round(h / 2) + 0.5);
    if (lo < 0 && hi > 0) {
      ctx.moveTo(0, Math.round(y(0)) + 0.5);
      ctx.lineTo(w, Math.round(y(0)) + 0.5);
    }
    ctx.stroke();

    if (this.#threshold !== null) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = th.threshold;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y(this.#threshold)) + 0.5);
      ctx.lineTo(w, Math.round(y(this.#threshold)) + 0.5);
      ctx.stroke();
      ctx.restore();
    }

    // Event markers (e.g. blinks): short ticks from the top edge.
    ctx.strokeStyle = th.marker;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const t of this.#markers) {
      if (t < t0) continue;
      ctx.moveTo(x(t), 2);
      ctx.lineTo(x(t), 9);
    }
    ctx.stroke();

    // Area wash + 2 px line, broken at gaps. Monotone curve through every
    // point: smooth, but never overshoots, so a blink dip or a peak is drawn
    // exactly as deep as the data (a plain spline would exaggerate it).
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = th.line;
    ctx.fillStyle = th.lineSoft;
    let run: ChartPoint[] = [];
    const flush = (): void => {
      if (run.length === 0) return;
      const xs = run.map((p) => x(p.t));
      const ys = run.map((p) => y(p.v ?? 0));
      const firstX = xs[0] ?? 0;
      const lastX = xs[xs.length - 1] ?? 0;
      ctx.beginPath();
      if (run.length === 1) {
        ctx.arc(firstX, ys[0] ?? 0, 1.5, 0, Math.PI * 2);
      } else {
        traceMonotone(ctx, xs, ys);
      }
      ctx.stroke();
      ctx.lineTo(lastX, h);
      ctx.lineTo(firstX, h);
      ctx.closePath();
      ctx.fill();
      run = [];
    };
    for (const p of visible) {
      if (p.v === null) flush();
      else run.push(p);
    }
    flush();

    // Hover crosshair, and the header value follows it.
    const hoverT = this.#opts.hover?.t ?? null;
    let shown: ChartPoint | undefined;
    if (hoverT !== null && hoverT >= t0 && hoverT <= now) {
      ctx.strokeStyle = th.crosshair;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x(hoverT)) + 0.5, 0);
      ctx.lineTo(Math.round(x(hoverT)) + 0.5, h);
      ctx.stroke();
      shown = nearest(visible, hoverT);
      if (shown?.v != null) {
        ctx.fillStyle = th.line;
        ctx.beginPath();
        ctx.arc(x(shown.t), y(shown.v), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      shown = [...visible].reverse().find((p) => p.v !== null);
    }
    const text = shown?.v != null ? this.#format(shown.v) : '–';
    if (this.#value.textContent !== text) this.#value.textContent = text;
    this.#value.dataset.hover = String(hoverT !== null);
  }
}

/**
 * Monotone cubic through (xs, ys) (Fritsch & Carlson 1980): passes through
 * every point and adds no extrema between them. Assumes xs increasing.
 */
export function monotoneTangents(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = (xs[i + 1] ?? 0) - (xs[i] ?? 0);
    d.push(dx > 0 ? ((ys[i + 1] ?? 0) - (ys[i] ?? 0)) / dx : 0);
  }
  const m: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = d[i - 1];
    const b = d[i];
    if (a === undefined) m.push(b ?? 0);
    else if (b === undefined) m.push(a);
    else m.push(a * b <= 0 ? 0 : (a + b) / 2);
  }
  for (let i = 0; i < n - 1; i += 1) {
    const di = d[i] ?? 0;
    if (di === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = (m[i] ?? 0) / di;
    const b = (m[i + 1] ?? 0) / di;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * di;
      m[i + 1] = t * b * di;
    }
  }
  return m;
}

function traceMonotone(
  ctx: CanvasRenderingContext2D,
  xs: readonly number[],
  ys: readonly number[],
): void {
  const m = monotoneTangents(xs, ys);
  ctx.moveTo(xs[0] ?? 0, ys[0] ?? 0);
  for (let i = 0; i < xs.length - 1; i += 1) {
    const x0 = xs[i] ?? 0;
    const x1 = xs[i + 1] ?? 0;
    const y0 = ys[i] ?? 0;
    const y1 = ys[i + 1] ?? 0;
    const h = (x1 - x0) / 3;
    ctx.bezierCurveTo(x0 + h, y0 + h * (m[i] ?? 0), x1 - h, y1 - h * (m[i + 1] ?? 0), x1, y1);
  }
}

function nearest(points: readonly ChartPoint[], t: number): ChartPoint | undefined {
  let best: ChartPoint | undefined;
  let bestD = Infinity;
  for (const p of points) {
    const d = Math.abs(p.t - t);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Data range with 8 % headroom; a flat series gets a small symmetric range. */
function yRange(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  // A range below 0.1 % of the magnitude is float noise, not signal: draw it flat
  // instead of auto-scaling the noise up to full height.
  if (hi - lo < Math.max(1e-9, Math.max(Math.abs(hi), Math.abs(lo)) * 1e-3)) {
    const mid = (hi + lo) / 2;
    const pad = Math.abs(mid) * 0.1 || 1;
    return [mid - pad, mid + pad];
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  return [lo, hi];
}
