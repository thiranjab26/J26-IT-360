import { describe, expect, it } from 'vitest';
import {
  buildBenchReport,
  slope,
  type BenchInput,
  type MemorySample,
} from '../../../src/bench/report.js';
import type { LatencySummary } from '../../../src/core/util/latency-probe.js';

// TODO A7: the benchmark report only ever states what was measured. A budget
// that could not be measured is null, never "passed" (CLAUDE.md invariant 6),
// and anything that makes a run unrepresentative is spelled out in warnings.

const summary = (p95: number | null, n = p95 === null ? 0 : 100): LatencySummary => ({
  n,
  p50: p95 === null ? null : p95 / 2,
  p95,
  max: p95,
  mean: p95 === null ? null : p95 / 2,
});

function memory(tensors: readonly number[], heapMb: number | null = 50): MemorySample[] {
  return tensors.map((t, i) => ({ tS: i + 1, tensors: t, jsHeapMb: heapMb }));
}

function input(overrides: Partial<BenchInput> = {}): BenchInput {
  return {
    startedAt: '2026-10-16T10:00:00.000Z',
    startup: { enableS: 0.5, firstFrameS: 4.2 },
    warmupS: 30,
    measuredS: 60,
    targetFps: 15,
    environment: {
      userAgent: 'test',
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      gpu: 'ANGLE (Intel, Iris Xe)',
      backend: 'webgl',
      frameClock: 'video-frame-callback',
      camera: { width: 640, height: 480 },
    },
    latency: {
      frameLatency: summary(30),
      eventLatency: summary(120),
      inference: summary(25),
      classifier: summary(0.4),
      arrivalOrigins: { capture: 900 },
      frames: 900,
      framesWithFace: 900,
    },
    longTasks: { supported: true, count: 0, totalMs: 0, maxMs: 0 },
    eventLoopLagMs: Array<number>(1200).fill(2),
    memory: memory(Array<number>(60).fill(1157)),
    statusSeconds: { active: 60 },
    wasHidden: false,
    ...overrides,
  };
}

describe('buildBenchReport (ARCHITECTURE.md §11 budgets)', () => {
  it('a clean run within every budget has no warnings', () => {
    const r = buildBenchReport(input());
    expect(r.within_budget).toEqual({
      frame_latency_p95: true,
      event_latency_p95: true,
      classifier_p95: true,
      no_long_tasks: true,
      no_main_thread_stalls: true,
      tensors_flat: true,
    });
    expect(r.warnings).toEqual([]);
    expect(r.run.face_ratio).toBe(1);
    expect(r.run.landmark_fps).toBe(15);
    expect(r.startup_s).toEqual({ camera_and_model: 0.5, first_processed_frame: 4.2 });
  });

  it('flags budgets that are exceeded', () => {
    const r = buildBenchReport(
      input({
        latency: {
          ...input().latency,
          frameLatency: summary(80),
          eventLatency: summary(301),
          classifier: summary(25),
        },
        longTasks: { supported: true, count: 3, totalMs: 240, maxMs: 120 },
        eventLoopLagMs: [2, 2, 70, 2],
      }),
    );
    expect(r.within_budget).toMatchObject({
      frame_latency_p95: false,
      event_latency_p95: false,
      classifier_p95: false,
      no_long_tasks: false,
      no_main_thread_stalls: false,
    });
    expect(r.event_loop_lag_ms).toMatchObject({ max: 70, stalls: 1 });
  });

  it('never reports an unmeasured budget as passed', () => {
    const r = buildBenchReport(
      input({
        latency: { ...input().latency, classifier: summary(null) },
        longTasks: { supported: false, count: null, totalMs: null, maxMs: null },
        eventLoopLagMs: [],
        memory: memory([1157, 1157], null),
      }),
    );
    expect(r.within_budget.classifier_p95).toBeNull();
    expect(r.within_budget.no_long_tasks).toBeNull();
    expect(r.within_budget.no_main_thread_stalls).toBeNull();
    expect(r.within_budget.tensors_flat).toBeNull(); // too few readings
    expect(r.memory.js_heap_slope_mb_per_min).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/classifier never ran/i);
    expect(r.warnings.join(' ')).toMatch(/no Long Tasks API/);
    expect(r.warnings.join(' ')).toMatch(/Fewer than 20 memory readings/);
  });

  it('warns when the run does not represent real use', () => {
    const r = buildBenchReport(
      input({
        latency: { ...input().latency, frames: 900, framesWithFace: 0 },
        environment: { ...input().environment, gpu: 'ANGLE (Google, SwiftShader Device)' },
        wasHidden: true,
        eventLoopLagMs: [2, 7400, 2],
      }),
    );
    const text = r.warnings.join('\n');
    expect(r.run.face_ratio).toBe(0);
    expect(text).toMatch(/face was found in 0 % of frames/);
    expect(text).toMatch(/software renderer/);
    expect(text).toMatch(/page was hidden/);
    expect(text).toMatch(/frozen for about 7.4 s/);
  });

  it('tensor growth compares the medians of the first and last ten readings', () => {
    // In-flight inferences make single readings jitter; that is not a leak.
    const jitter = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 1166 : 1157));
    expect(buildBenchReport(input({ memory: memory(jitter) })).memory.tensor_growth).toBe(0);
    expect(buildBenchReport(input({ memory: memory(jitter) })).within_budget.tensors_flat).toBe(
      true,
    );

    // One tensor leaked per second: clearly growing.
    const leak = Array.from({ length: 60 }, (_, i) => 1157 + i);
    const r = buildBenchReport(input({ memory: memory(leak) }));
    expect(r.memory.tensor_growth).toBe(50);
    expect(r.within_budget.tensors_flat).toBe(false);
  });
});

describe('slope', () => {
  it('is the least-squares slope', () => {
    expect(
      slope([
        [0, 1],
        [1, 3],
        [2, 5],
      ]),
    ).toBeCloseTo(2, 10);
    expect(slope([[0, 1]])).toBeNull();
    expect(
      slope([
        [1, 1],
        [1, 2],
      ]),
    ).toBeNull();
  });
});
