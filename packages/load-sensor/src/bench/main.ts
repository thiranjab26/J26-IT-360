// Latency and memory benchmark page (TODO A7; NFR1, NFR6; ARCHITECTURE.md §11).
//
// Runs the shipped library exactly as a host app would (createLoadSensor()),
// with no demo UI on the page, so the numbers describe the sensor itself and
// every long task on this page is the sensor's. `pnpm bench` drives this page
// in Chrome, Edge or Firefox; it can also be opened by hand (bench.html) on
// the laptop being measured, with a real face in view.
//
// URL parameters: ?seconds=120 (measured period, 10–3600) &warmup=30 (0–300).
// Nothing leaves the device: the report is shown here and saved only when the
// user presses "Download JSON" (or read from the page by `pnpm bench`).

import './bench.css';
import { memory } from '@tensorflow/tfjs-core';
import { FrameGate } from '../core/camera/frame-gate.js';
import { SENSING_STATUSES } from '../core/events/types.js';
import { createLoadSensor, type LoadSensor } from '../core/index.js';
import { LatencyProbe } from '../core/util/latency-probe.js';
import {
  BUDGETS,
  buildBenchReport,
  type BenchEnvironment,
  type BenchReport,
  type LongTaskStats,
  type MemorySample,
} from './report.js';

const params = new URLSearchParams(location.search);
const MEASURE_S = intParam('seconds', 120, 10, 3600);
// 30 s by default: Firefox showed a one-off main-thread freeze of about 7 s
// some 25 s after sensing started (2026-10-16, synthetic pattern); with 5–10 s
// of warm-up it landed in the measured period, with 40 s it did not. Steady
// state is what §11 budgets; startup is reported separately (startup_s).
const WARMUP_S = intParam('warmup', 30, 0, 300);

function intParam(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(params.get(name));
  if (!params.has(name) || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

const root = document.querySelector<HTMLElement>('#bench');
if (root) mount(root);

function mount(main: HTMLElement): void {
  const title = el('h1', 'Latency benchmark');
  const intro = el(
    'p',
    `Runs the load sensor for ${String(WARMUP_S)} s of warm-up, then measures for ${String(MEASURE_S)} s: frame and event latency, face mesh and classifier time, long tasks and memory (ARCHITECTURE.md §11). Keep your face in view and this tab in front. The camera is processed on this device only; nothing is uploaded or recorded.`,
  );

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('aria-label', 'Camera preview');
  const start = el('button', 'Start benchmark');
  start.dataset.testid = 'bench-start';
  const status = el('p', 'Not started.');
  status.className = 'bench-status';
  status.dataset.testid = 'bench-status';
  status.setAttribute('role', 'status');
  const controls = el('div');
  controls.append(start, status);
  const row = el('div');
  row.className = 'bench-row';
  row.append(video, controls);
  const runCard = el('section');
  runCard.className = 'bench-card';
  runCard.append(row);

  const resultCard = el('section');
  resultCard.className = 'bench-card';
  resultCard.hidden = true;
  const report = el('pre');
  report.dataset.testid = 'bench-report';

  main.append(title, intro, runCard, resultCard);

  start.addEventListener('click', () => {
    start.disabled = true;
    void run(video, (text) => {
      status.textContent = text;
    }).then(
      (result) => {
        status.textContent = 'Done.';
        status.dataset.state = 'done';
        report.textContent = JSON.stringify(result, null, 2);
        renderResult(resultCard, result, report);
      },
      (error: unknown) => {
        status.textContent = `Benchmark failed: ${error instanceof Error ? error.message : String(error)}`;
        status.dataset.state = 'failed';
        start.disabled = false;
      },
    );
  });
}

async function run(
  video: HTMLVideoElement,
  progress: (text: string) => void,
): Promise<BenchReport> {
  const probe = new LatencyProbe();
  const sensor = createLoadSensor({
    video,
    // A measuring run: no events to other tabs, no change to today's strain totals.
    broadcast: false,
    strainStorage: null,
    environment: { latencyProbe: probe },
  });
  try {
    progress('Starting camera and loading the model…');
    const tEnable = performance.now();
    const status = await sensor.enable();
    if (!SENSING_STATUSES.has(status)) {
      throw new Error(`the sensor did not start (status: ${status})`);
    }
    const enableS = (performance.now() - tEnable) / 1000;

    // The first inference compiles the WebGL shaders, which can take many
    // seconds (Firefox especially, ARCHITECTURE.md §13). Warm-up starts only
    // after it, so a slow first frame never lands in the measured period; the
    // startup cost is reported on its own.
    progress('Waiting for the first processed frame (compiling shaders)…');
    await waitFor(() => probe.frameCount > 0, FIRST_FRAME_TIMEOUT_MS);
    const firstFrameS = (performance.now() - tEnable) / 1000;

    await countdown(WARMUP_S, (left) => {
      progress(`Warming up… ${String(left)} s`);
    });

    // ── Measured period ──
    probe.reset();
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const longTasks = observeLongTasks(t0);
    const lag = monitorEventLoop();
    const memorySamples: MemorySample[] = [];
    // Tensor count between inferences (see LatencyProbe.onFrame), so a reading
    // never includes an inference's temporary tensors.
    let quietTensors = memory().numTensors;
    const stopTensorReads = probe.onFrame(() => {
      quietTensors = memory().numTensors;
    });
    const statusSeconds: Record<string, number> = {};
    let wasHidden = document.visibilityState === 'hidden';
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') wasHidden = true;
    };
    document.addEventListener('visibilitychange', onVisibility);

    await countdown(MEASURE_S, (left) => {
      const s = sensor.status;
      statusSeconds[s] = (statusSeconds[s] ?? 0) + 1;
      memorySamples.push(readMemory((performance.now() - t0) / 1000, quietTensors));
      progress(`Measuring… ${String(left)} s left (status: ${s})`);
    });

    const measuredS = (performance.now() - t0) / 1000;
    stopTensorReads();
    document.removeEventListener('visibilitychange', onVisibility);
    const environment = describeEnvironment(sensor, video);
    return buildBenchReport({
      startedAt,
      startup: { enableS, firstFrameS },
      warmupS: WARMUP_S,
      measuredS,
      targetFps: FrameGate.DEFAULT_TARGET_FPS,
      environment,
      latency: probe.report(),
      longTasks: longTasks.stop(),
      eventLoopLagMs: lag.stop(),
      memory: memorySamples,
      statusSeconds,
      wasHidden,
    });
  } finally {
    sensor.destroy();
  }
}

/** Generous: a first WebGL inference on a slow laptop in Firefox took 13.5 s here. */
const FIRST_FRAME_TIMEOUT_MS = 180_000;

/** Resolves once `ready()` is true (checked every 200 ms); rejects after `timeoutMs`. */
function waitFor(ready: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      if (ready()) {
        clearInterval(timer);
        resolve();
      } else if (performance.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`no frame was processed within ${String(timeoutMs / 1000)} s`));
      }
    }, 200);
  });
}

/** Calls `tick(secondsLeft)` once per second, `seconds` times, then resolves. */
function countdown(seconds: number, tick: (left: number) => void): Promise<void> {
  if (seconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    let left = seconds;
    const timer = setInterval(() => {
      left -= 1;
      tick(left);
      if (left <= 0) {
        clearInterval(timer);
        resolve();
      }
    }, 1000);
  });
}

function observeLongTasks(since: number): { stop(): LongTaskStats } {
  const supported =
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('longtask');
  if (!supported) {
    return { stop: () => ({ supported: false, count: null, totalMs: null, maxMs: null }) };
  }
  let count = 0;
  let total = 0;
  let max = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.startTime < since) continue;
      count += 1;
      total += entry.duration;
      max = Math.max(max, entry.duration);
    }
  });
  observer.observe({ type: 'longtask', buffered: false });
  return {
    stop() {
      for (const entry of observer.takeRecords()) {
        if (entry.startTime < since) continue;
        count += 1;
        total += entry.duration;
        max = Math.max(max, entry.duration);
      }
      observer.disconnect();
      return { supported: true, count, totalMs: total, maxMs: count ? max : 0 };
    },
  };
}

/** Beat interval of the event-loop monitor. */
const LAG_BEAT_MS = 50;

/** Records how late each 50 ms timer beat fires (see BenchInput.eventLoopLagMs). */
function monitorEventLoop(): { stop(): number[] } {
  const lags: number[] = [];
  let expected = performance.now() + LAG_BEAT_MS;
  const timer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - expected));
    expected = now + LAG_BEAT_MS;
  }, LAG_BEAT_MS);
  return {
    stop() {
      clearInterval(timer);
      return lags;
    },
  };
}

function readMemory(tS: number, tensors: number): MemorySample {
  // Chromium only; not part of the standard Performance interface.
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return {
    tS: Math.round(tS * 10) / 10,
    tensors,
    jsHeapMb: heap ? Math.round((heap.usedJSHeapSize / 1024 / 1024) * 100) / 100 : null,
  };
}

function describeEnvironment(sensor: LoadSensor, video: HTMLVideoElement): BenchEnvironment {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    gpu: gpuName(),
    backend: sensor.getState().meta?.backend ?? null,
    frameClock:
      'requestVideoFrameCallback' in HTMLVideoElement.prototype
        ? 'video-frame-callback'
        : 'animation-frame',
    camera: video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : null,
  };
}

/** The GPU's name where the browser reveals it (laptop spec for the report). */
function gpuName(): string | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

function renderResult(card: HTMLElement, r: BenchReport, report: HTMLElement): void {
  const table = el('table');
  const head = el('tr');
  for (const h of ['Metric', 'n', 'p50 (ms)', 'p95 (ms)', 'max (ms)', 'Budget']) {
    head.append(el('th', h));
  }
  table.append(head);
  const rows: [
    string,
    BenchReport['metrics_ms'][keyof BenchReport['metrics_ms']],
    string,
    boolean | null,
  ][] = [
    [
      'Frame latency',
      r.metrics_ms.frame_latency,
      `p95 ≤ ${String(BUDGETS.frameLatencyP95Ms)}`,
      r.within_budget.frame_latency_p95,
    ],
    [
      'Event latency (NFR1)',
      r.metrics_ms.event_latency,
      `p95 ≤ ${String(BUDGETS.eventLatencyP95Ms)}`,
      r.within_budget.event_latency_p95,
    ],
    ['Face mesh inference', r.metrics_ms.face_mesh_inference, '–', null],
    [
      'Classifier',
      r.metrics_ms.classifier,
      `p95 ≤ ${String(BUDGETS.classifierP95Ms)}`,
      r.within_budget.classifier_p95,
    ],
  ];
  for (const [name, m, budget, ok] of rows) {
    const tr = el('tr');
    const verdict = el(
      'td',
      ok === null ? `${budget} (not measured)` : `${budget} ${ok ? '✓' : '✗'}`,
    );
    if (ok !== null) verdict.className = ok ? 'ok' : 'bad';
    tr.append(
      el('td', name),
      el('td', String(m.n)),
      el('td', fmt(m.p50)),
      el('td', fmt(m.p95)),
      el('td', fmt(m.max)),
      verdict,
    );
    table.append(tr);
  }

  const lt = r.long_tasks;
  const facts = el(
    'p',
    `Backend ${r.environment.backend ?? '–'} · ${String(r.run.landmark_fps)} landmark fps · face in ${r.run.face_ratio === null ? '–' : `${String(Math.round(r.run.face_ratio * 100))} %`} of frames · long tasks ${lt.supported ? String(lt.count) : 'not measurable here'} · tensors ${String(r.memory.tensors_start ?? '–')} → ${String(r.memory.tensors_end ?? '–')}`,
  );

  const warnings = el('ul');
  warnings.className = 'warnings';
  for (const w of r.warnings) warnings.append(el('li', w));

  const download = el('button', 'Download JSON');
  download.className = 'secondary';
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `bench-${r.started_at.slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  card.replaceChildren(
    el('h2', 'Result'),
    facts,
    table,
    ...(r.warnings.length ? [warnings] : []),
    download,
    report,
  );
  card.hidden = false;
}

function fmt(x: number | null): string {
  return x === null ? '–' : x.toFixed(1);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
