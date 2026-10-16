import type { LatencyReport, LatencySummary } from '../core/util/latency-probe.js';
import { percentile } from '../core/util/rolling-stats.js';

/**
 * The latency and memory benchmark report (TODO A7; NFR1, NFR6), built from
 * measurements only. Budgets are those of ARCHITECTURE.md §11; a budget that
 * could not be measured in this run is `null`, never assumed to pass
 * (CLAUDE.md invariant 6).
 */

export const BENCH_REPORT_SCHEMA = 1;

/** ARCHITECTURE.md §11. */
export const BUDGETS = {
  frameLatencyP95Ms: 66,
  eventLatencyP95Ms: 300,
  classifierP95Ms: 20,
  /** Long tasks (> 50 ms) in steady state. */
  longTasks: 0,
  /** A timer firing this much later than scheduled means the page was blocked for a long task. */
  eventLoopLagMs: 50,
} as const;

/** Below this share of frames with a face, latency does not represent real use. */
export const MIN_FACE_RATIO = 0.8;

export interface LongTaskStats {
  /** False where the browser has no Long Tasks API (Firefox, Safari). */
  readonly supported: boolean;
  readonly count: number | null;
  readonly totalMs: number | null;
  readonly maxMs: number | null;
}

/** One reading per second during the measured period. */
export interface MemorySample {
  readonly tS: number;
  /** Live TF.js tensors, read between two inferences (no temporaries). */
  readonly tensors: number;
  /** MB; null where the browser does not expose heap size (non-Chromium). */
  readonly jsHeapMb: number | null;
}

export interface BenchEnvironment {
  readonly userAgent: string;
  readonly hardwareConcurrency: number | null;
  /** GB, coarse (Chromium only). */
  readonly deviceMemoryGb: number | null;
  /** Unmasked WebGL renderer where the browser reveals it. */
  readonly gpu: string | null;
  readonly backend: string | null;
  readonly frameClock: 'video-frame-callback' | 'animation-frame';
  readonly camera: { readonly width: number; readonly height: number } | null;
}

export interface BenchInput {
  readonly startedAt: string;
  /** Seconds from enable() to sensing (camera + model), and to the first processed frame. */
  readonly startup: { readonly enableS: number; readonly firstFrameS: number };
  readonly warmupS: number;
  readonly measuredS: number;
  readonly targetFps: number;
  readonly environment: BenchEnvironment;
  readonly latency: LatencyReport;
  readonly longTasks: LongTaskStats;
  /**
   * Lateness of a 50 ms heartbeat timer, one value per beat (ms). Works in
   * every browser, unlike the Long Tasks API: a beat that fires 300 ms late
   * means the page could not respond for about 300 ms.
   */
  readonly eventLoopLagMs: readonly number[];
  readonly memory: readonly MemorySample[];
  /** Seconds the sensor spent in each status during the measured period. */
  readonly statusSeconds: Readonly<Record<string, number>>;
  /** The page was hidden at some point (timers and frames throttled). */
  readonly wasHidden: boolean;
}

interface Rounded {
  readonly n: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
  readonly mean: number | null;
}

export interface BenchReport {
  readonly schema: typeof BENCH_REPORT_SCHEMA;
  readonly tool: 'adaptlearn-c2-bench';
  readonly definitions: string;
  readonly started_at: string;
  /** Not part of the steady-state numbers; the first frame includes shader compilation. */
  readonly startup_s: {
    readonly camera_and_model: number | null;
    readonly first_processed_frame: number | null;
  };
  readonly config: {
    readonly warmup_s: number;
    readonly measured_s: number;
    readonly target_fps: number;
  };
  readonly environment: BenchEnvironment;
  readonly run: {
    readonly frames_processed: number;
    readonly landmark_fps: number;
    readonly face_ratio: number | null;
    readonly frame_arrival_origins: LatencyReport['arrivalOrigins'];
    readonly status_seconds: Readonly<Record<string, number>>;
  };
  readonly metrics_ms: {
    readonly frame_latency: Rounded;
    readonly event_latency: Rounded;
    readonly face_mesh_inference: Rounded;
    readonly classifier: Rounded;
  };
  readonly long_tasks: LongTaskStats;
  readonly event_loop_lag_ms: {
    readonly n: number;
    readonly p95: number | null;
    readonly max: number | null;
    /** Beats more than BUDGETS.eventLoopLagMs late: times the page froze noticeably. */
    readonly stalls: number;
  };
  readonly memory: {
    readonly tensors_start: number | null;
    readonly tensors_end: number | null;
    readonly tensors_max: number | null;
    /** Median of the last 10 readings minus median of the first 10; > 0 suggests a leak. */
    readonly tensor_growth: number | null;
    readonly js_heap_start_mb: number | null;
    readonly js_heap_end_mb: number | null;
    /** Least-squares slope over the run; GC makes single readings noisy. */
    readonly js_heap_slope_mb_per_min: number | null;
    readonly samples: readonly MemorySample[];
  };
  /** true / false against ARCHITECTURE.md §11; null = not measured in this run. */
  readonly within_budget: {
    readonly frame_latency_p95: boolean | null;
    readonly event_latency_p95: boolean | null;
    readonly classifier_p95: boolean | null;
    readonly no_long_tasks: boolean | null;
    readonly no_main_thread_stalls: boolean | null;
    readonly tensors_flat: boolean | null;
  };
  /** Reasons a number in this file may not represent real use. */
  readonly warnings: readonly string[];
}

const DEFINITIONS =
  'ARCHITECTURE.md §11. frame_latency: frame arrival (rVFC captureTime, else presentationTime, else rAF time; see run.frame_arrival_origins) to per-frame signals computed. event_latency: arrival of the newest frame of a finished second to the hub having classified it and emitted any event (includes up to one frame interval of waiting for the second to close). face_mesh_inference: one landmark estimate. classifier: one classify() call. Percentiles: linear interpolation (NumPy default). Warm-up starts after the first processed frame; startup_s is reported separately.';

function round(x: number | null, digits = 2): number | null {
  if (x === null || !Number.isFinite(x)) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function rounded(s: LatencySummary): Rounded {
  return { n: s.n, p50: round(s.p50), p95: round(s.p95), max: round(s.max), mean: round(s.mean) };
}

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Least-squares slope of y over x; null with fewer than 2 distinct x. */
export function slope(points: readonly (readonly [number, number])[]): number | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den > 0 ? num / den : null;
}

function within(value: number | null, budget: number): boolean | null {
  return value === null ? null : value <= budget;
}

export function buildBenchReport(input: BenchInput): BenchReport {
  const { latency, memory, longTasks } = input;
  const faceRatio = latency.frames > 0 ? latency.framesWithFace / latency.frames : null;

  const tensors = memory.map((m) => m.tensors);
  const edge = Math.min(10, Math.floor(tensors.length / 2));
  const first = median(tensors.slice(0, edge));
  const last = median(tensors.slice(tensors.length - edge));
  const tensorGrowth = edge > 0 && first !== null && last !== null ? last - first : null;
  const heap = memory.filter((m): m is MemorySample & { jsHeapMb: number } => m.jsHeapMb !== null);
  const heapSlopePerS = slope(heap.map((m) => [m.tS, m.jsHeapMb] as const));

  const warnings: string[] = [];
  if (faceRatio === null || faceRatio < MIN_FACE_RATIO) {
    warnings.push(
      `A face was found in ${faceRatio === null ? 'no' : `${String(Math.round(faceRatio * 100))} % of`} frames (needs ≥ ${String(MIN_FACE_RATIO * 100)} %). Without a face the landmark model does not run, so these latencies understate real use. Use a real camera with a face in view, or a face clip.`,
    );
  }
  if (latency.classifier.n === 0) {
    warnings.push(
      'The classifier never ran: it needs a finished baseline and a full 30 s window with a face. Classifier time was not measured; run longer with a face in view.',
    );
  }
  if (!longTasks.supported) {
    warnings.push('This browser has no Long Tasks API, so long tasks were not measured.');
  }
  if (input.wasHidden) {
    warnings.push(
      'The page was hidden during the run; the browser throttles hidden pages, so the numbers are not valid.',
    );
  }
  if (
    input.environment.gpu !== null &&
    /swiftshader|llvmpipe|software/i.test(input.environment.gpu)
  ) {
    warnings.push(
      `WebGL ran on a software renderer (${input.environment.gpu}), e.g. headless Chromium: GPU timings do not represent a real laptop. Run headed.`,
    );
  }
  if (tensors.length < 20) {
    warnings.push('Fewer than 20 memory readings: run at least 20 s for the tensor trend.');
  }

  const lag = [...input.eventLoopLagMs].sort((a, b) => a - b);
  const stalls = lag.filter((x) => x > BUDGETS.eventLoopLagMs).length;
  const lagMax = lag.at(-1) ?? null;
  if (lagMax !== null && lagMax > 1000) {
    warnings.push(
      `The page was frozen for about ${String(Math.round(lagMax / 100) / 10)} s at least once during the measured period (event_loop_lag_ms.max).`,
    );
  }

  const frameP95 = round(latency.frameLatency.p95);
  const eventP95 = round(latency.eventLatency.p95);
  const classifierP95 = round(latency.classifier.p95);

  return {
    schema: BENCH_REPORT_SCHEMA,
    tool: 'adaptlearn-c2-bench',
    definitions: DEFINITIONS,
    started_at: input.startedAt,
    startup_s: {
      camera_and_model: round(input.startup.enableS),
      first_processed_frame: round(input.startup.firstFrameS),
    },
    config: {
      warmup_s: input.warmupS,
      measured_s: round(input.measuredS, 1) ?? 0,
      target_fps: input.targetFps,
    },
    environment: input.environment,
    run: {
      frames_processed: latency.frames,
      landmark_fps: round(input.measuredS > 0 ? latency.frames / input.measuredS : 0, 1) ?? 0,
      face_ratio: round(faceRatio, 3),
      frame_arrival_origins: latency.arrivalOrigins,
      status_seconds: input.statusSeconds,
    },
    metrics_ms: {
      frame_latency: rounded(latency.frameLatency),
      event_latency: rounded(latency.eventLatency),
      face_mesh_inference: rounded(latency.inference),
      classifier: rounded(latency.classifier),
    },
    long_tasks: {
      supported: longTasks.supported,
      count: longTasks.count,
      totalMs: round(longTasks.totalMs),
      maxMs: round(longTasks.maxMs),
    },
    event_loop_lag_ms: {
      n: lag.length,
      p95: round(lag.length ? percentile(lag, 95) : null),
      max: round(lagMax),
      stalls,
    },
    memory: {
      tensors_start: tensors[0] ?? null,
      tensors_end: tensors.at(-1) ?? null,
      tensors_max: tensors.length ? Math.max(...tensors) : null,
      tensor_growth: tensorGrowth,
      js_heap_start_mb: round(heap[0]?.jsHeapMb ?? null),
      js_heap_end_mb: round(heap.at(-1)?.jsHeapMb ?? null),
      js_heap_slope_mb_per_min: round(heapSlopePerS === null ? null : heapSlopePerS * 60, 3),
      samples: memory,
    },
    within_budget: {
      frame_latency_p95: within(frameP95, BUDGETS.frameLatencyP95Ms),
      event_latency_p95: within(eventP95, BUDGETS.eventLatencyP95Ms),
      classifier_p95: within(classifierP95, BUDGETS.classifierP95Ms),
      no_long_tasks: longTasks.supported ? longTasks.count === BUDGETS.longTasks : null,
      no_main_thread_stalls: lag.length ? stalls === 0 : null,
      tensors_flat: tensorGrowth === null || tensors.length < 20 ? null : tensorGrowth <= 0,
    },
    warnings,
  };
}
