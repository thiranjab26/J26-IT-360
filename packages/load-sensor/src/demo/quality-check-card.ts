import { DEFAULT_VIDEO_CONSTRAINTS } from '../core/camera/constraints.js';
import {
  QUALITY_RESOLUTIONS,
  QualityMeter,
  type QualityFrame,
  type QualitySummary,
} from './quality-check.js';

/**
 * "Camera quality check" card on the Performance tab.
 *
 * Steps the live camera through QUALITY_RESOLUTIONS while the learner holds
 * still, measures each (quality-check.ts) and shows a table. "Download JSON"
 * saves the numbers locally, for docs/bench/; nothing is sent anywhere and no
 * frame or landmark is kept (invariants 1, 2). Afterwards the camera goes back
 * to the shipped default and the baseline is recalibrated, since a resolution
 * change can shift the per-learner normalisation.
 */

/** Settle time after a resolution change: the camera and the model's tracking need a moment. */
const SETTLE_MS = 2500;
/** Measured span per resolution; ≥ the tracker's ~8.5 s inference-time window. */
const MEASURE_MS = 10_000;

export interface QualityCheckDeps {
  /** The live video track, or null when sensing is off. */
  readonly track: () => MediaStreamTrack | null;
  readonly trackerStats: () => { fps: number; inferenceP50: number; inferenceP95: number };
  readonly backend: () => string | null;
  /** Called when the check ends (done, cancelled or failed): recalibrate the baseline. */
  readonly onFinished: () => void;
}

export interface QualityRow extends QualitySummary {
  readonly requested: { readonly width: number; readonly height: number };
  readonly delivered: {
    readonly width: number;
    readonly height: number;
    readonly frameRate: number;
  };
  readonly landmarkFps: number;
  readonly inferenceP50Ms: number;
  readonly inferenceP95Ms: number;
}

export class QualityCheckCard {
  readonly element: HTMLElement;
  readonly #deps: QualityCheckDeps;
  readonly #run: HTMLButtonElement;
  readonly #download: HTMLButtonElement;
  readonly #status: HTMLElement;
  readonly #body: HTMLTableSectionElement;
  #meter: QualityMeter | null = null;
  #running = false;
  #cancelled = false;
  #rows: QualityRow[] = [];

  constructor(deps: QualityCheckDeps) {
    this.#deps = deps;
    this.element = el('section', 'card quality-card');
    this.element.dataset.testid = 'quality-check';
    const head = el('div', 'card-header');
    head.append(el('h2', 'card-title', 'Camera quality check'));
    const actions = el('div', 'quality-actions');
    this.#download = el('button', 'btn btn-small btn-ghost', 'Download JSON');
    this.#download.type = 'button';
    this.#download.disabled = true;
    this.#run = el('button', 'btn btn-small btn-primary', 'Run check');
    this.#run.type = 'button';
    this.#run.dataset.testid = 'quality-run';
    actions.append(this.#download, this.#run);
    head.append(actions);

    const intro = el(
      'p',
      'quality-intro',
      `Compares capture resolutions on this laptop. Sit as you normally would, look at the screen and keep still for about ${String(Math.round((QUALITY_RESOLUTIONS.length * (SETTLE_MS + MEASURE_MS)) / 1000))} s. Lower jitter and noise = steadier signals; inference p95 must stay within the 300 ms budget (NFR1).`,
    );
    this.#status = el('p', 'quality-status', 'Turn sensing on, then run the check.');
    this.#status.setAttribute('role', 'status');

    const table = el('table', 'quality-table');
    const thead = el('thead');
    const hr = el('tr');
    for (const [label, title] of [
      ['Resolution', 'Requested → delivered by the camera'],
      ['fps', 'Landmark rate during the measurement'],
      ['Infer p50 / p95', 'Time inside the face model, ms'],
      ['Face', 'Share of frames with a face'],
      ['Jitter', 'Landmark jitter per frame, thousandths of the inter-ocular distance'],
      ['EAR σ', 'Per-frame noise of the eye aspect ratio, thousandths'],
      ['Iris σ x / y', 'Per-frame iris-offset noise, thousandths of an eye width'],
      ['Yaw / pitch σ', 'Per-frame head-pose noise, degrees'],
      ['Face size', 'Inter-ocular distance as a share of the frame height'],
    ] as const) {
      const th = el('th', '', label);
      th.title = title;
      th.scope = 'col';
      hr.append(th);
    }
    thead.append(hr);
    this.#body = el('tbody');
    table.append(thead, this.#body);
    const wrap = el('div', 'quality-table-wrap');
    wrap.append(table);

    this.element.append(head, intro, this.#status, wrap);
    this.#renderRows();

    this.#run.addEventListener('click', () => {
      if (this.#running) this.#cancelled = true;
      else void this.#start();
    });
    this.#download.addEventListener('click', () => {
      this.#save();
    });
  }

  /** Feed every landmark frame; ignored unless a measurement is running. */
  push(frame: QualityFrame): void {
    this.#meter?.push(frame);
  }

  /** Sensing on/off: the check needs the live camera. */
  setAvailable(available: boolean): void {
    if (this.#running) return;
    this.#run.disabled = !available;
    if (!available) this.#status.textContent = 'Turn sensing on, then run the check.';
    else if (this.#rows.length === 0)
      this.#status.textContent = 'Ready. Press Run check and keep still.';
  }

  async #start(): Promise<void> {
    const track = this.#deps.track();
    if (!track) return;
    this.#running = true;
    this.#cancelled = false;
    this.#rows = [];
    this.#renderRows();
    this.#run.textContent = 'Cancel';
    this.#download.disabled = true;
    try {
      for (const res of QUALITY_RESOLUTIONS) {
        const label = `${String(res.width)}×${String(res.height)}`;
        this.#status.textContent = `${label}: switching… keep still and look at the screen.`;
        await track.applyConstraints({
          ...DEFAULT_VIDEO_CONSTRAINTS,
          width: { ideal: res.width },
          height: { ideal: res.height },
        });
        if (!(await this.#wait(SETTLE_MS))) break;
        this.#status.textContent = `${label}: measuring for ${String(MEASURE_MS / 1000)} s…`;
        this.#meter = new QualityMeter();
        const ok = await this.#wait(MEASURE_MS);
        const summary = this.#meter.summary();
        this.#meter = null;
        if (!ok) break;
        const settings = track.getSettings();
        const stats = this.#deps.trackerStats();
        this.#rows.push({
          ...summary,
          requested: res,
          delivered: {
            width: settings.width ?? Number.NaN,
            height: settings.height ?? Number.NaN,
            frameRate: settings.frameRate ?? Number.NaN,
          },
          landmarkFps: stats.fps,
          inferenceP50Ms: stats.inferenceP50,
          inferenceP95Ms: stats.inferenceP95,
        });
        this.#renderRows();
      }
      // Read through a method: the flag changes during the awaits above.
      this.#status.textContent = this.#wasCancelled()
        ? 'Cancelled. The camera is back on the default resolution.'
        : track.readyState === 'ended'
          ? 'The camera stopped, so the check ended early.'
          : 'Done. The camera is back on the default resolution and the baseline is recalibrating. Download the JSON into docs/bench/.';
    } catch (error) {
      this.#status.textContent = `The camera refused a resolution change (${error instanceof Error ? error.name : 'error'}).`;
    } finally {
      this.#meter = null;
      if (track.readyState === 'live') {
        await track.applyConstraints({ ...DEFAULT_VIDEO_CONSTRAINTS }).catch(() => undefined);
      }
      this.#running = false;
      this.#run.textContent = 'Run check';
      this.#run.disabled = track.readyState !== 'live';
      this.#download.disabled = this.#rows.length === 0;
      this.#deps.onFinished();
    }
  }

  #wasCancelled(): boolean {
    return this.#cancelled;
  }

  /** Waits, unless cancelled or the camera ends; false if it should stop. */
  async #wait(ms: number): Promise<boolean> {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (this.#cancelled || this.#deps.track()?.readyState !== 'live') return false;
      await new Promise((r) => setTimeout(r, 200));
    }
    return true;
  }

  #renderRows(): void {
    if (this.#rows.length === 0) {
      const tr = el('tr');
      const td = el('td', 'quality-empty', 'No results yet.');
      td.colSpan = 9;
      tr.append(td);
      this.#body.replaceChildren(tr);
      return;
    }
    const milli = (v: number): string => (Number.isFinite(v) ? (v * 1000).toFixed(2) : '–');
    const num = (v: number, d: number): string => (Number.isFinite(v) ? v.toFixed(d) : '–');
    // Lowest jitter is highlighted so the steadiest resolution stands out.
    const best = Math.min(...this.#rows.map((r) => r.landmarkJitterIod).filter(Number.isFinite));
    this.#body.replaceChildren(
      ...this.#rows.map((r) => {
        const tr = el('tr');
        tr.dataset.best = String(r.landmarkJitterIod === best);
        for (const text of [
          `${String(r.requested.width)}×${String(r.requested.height)} → ${num(r.delivered.width, 0)}×${num(r.delivered.height, 0)}`,
          num(r.landmarkFps, 1),
          `${num(r.inferenceP50Ms, 0)} / ${num(r.inferenceP95Ms, 0)}`,
          `${num(r.faceRatio * 100, 0)} %`,
          milli(r.landmarkJitterIod),
          milli(r.earNoise),
          `${milli(r.irisNoiseX)} / ${milli(r.irisNoiseY)}`,
          `${num(r.yawNoiseDeg, 2)} / ${num(r.pitchNoiseDeg, 2)}`,
          `${num(r.faceSizeIod * 100, 1)} %`,
        ]) {
          tr.append(el('td', '', text));
        }
        return tr;
      }),
    );
  }

  /** Local download of the summary numbers; nothing leaves the device. */
  #save(): void {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const report = {
      kind: 'c2-camera-quality-check',
      version: 1,
      createdAt: new Date().toISOString(),
      settleMs: SETTLE_MS,
      measureMs: MEASURE_MS,
      device: {
        userAgent: nav.userAgent,
        hardwareConcurrency: nav.hardwareConcurrency,
        deviceMemoryGb: nav.deviceMemory ?? null,
      },
      backend: this.#deps.backend(),
      results: this.#rows,
    };
    const stamp = report.createdAt.slice(0, 16).replace(/[-:T]/g, '');
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `camera-quality-${stamp}.json`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }
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
