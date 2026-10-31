/**
 * Replays a study-session export (TODO B1) through the app's own
 * FeaturePipeline, so the per-second training features come from the
 * TypeScript feature code and never from Python (CLAUDE.md "one source of
 * truth"; ARCHITECTURE.md §6). Pure: no file system, unit-tested in
 * tests/unit/scripts/session-to-features-lib.test.ts.
 */
import type { FrameSignals } from '../src/core/features/index.js';
import { FEATURE_COUNT } from '../src/core/features/spec.js';
import {
  COLUMN,
  SIGNAL_COLUMNS,
  checkSessionExport,
  type BlockKind,
  type SessionExport,
} from '../src/core/recorder/index.js';
import { FeaturePipeline } from '../src/core/window/index.js';

export interface SecondRow {
  /** Seconds since the replay's first frame. */
  readonly second: number;
  readonly startMs: number;
  /** Block of the second's first frame; −1 between blocks. */
  readonly block: number;
  readonly kind: BlockKind | null;
  /** False when the second's frames span two blocks (or a block and a gap). */
  readonly pure: boolean;
  readonly valid: boolean;
  readonly validRatio: number;
  /** Raw features, FEATURES order. */
  readonly raw: Float32Array;
  /** Baseline z-scores; null while calibrating. */
  readonly z: Float32Array | null;
}

/** One stored frame row back to FrameSignals (null when no face). */
export function rowSignals(row: readonly number[]): FrameSignals | null {
  if (row[COLUMN.face] !== 1) return null;
  const entries = SIGNAL_COLUMNS.map((c) => [c, row[COLUMN[c]] ?? NaN] as const);
  return Object.fromEntries(entries) as unknown as FrameSignals;
}

/**
 * Per-second features of one session. The replay starts at the rest block's
 * first frame, as the study page resets the pipeline there: the baseline
 * (first FEATURE_CONFIG.baseline.seconds valid seconds) comes from the rest
 * block only, never from task data (ARCHITECTURE.md §12 Protocol).
 */
export function replaySession(session: SessionExport): SecondRow[] {
  const problems = checkSessionExport(session);
  if (problems.length > 0) throw new Error(`export failed the self-check: ${problems.join('; ')}`);
  const rest = session.blocks.find((b) => b.kind === 'rest');
  if (!rest) throw new Error('session has no rest block');
  const start = session.frames.findIndex((r) => r[COLUMN.block] === rest.index);
  if (start === -1) throw new Error('rest block has no frames');

  const kindOf = new Map(session.blocks.map((b) => [b.index, b.kind]));
  const pipeline = new FeaturePipeline();
  const rows: SecondRow[] = [];
  let blocks = new Set<number>();
  let first: number | null = null;
  let current = -1;
  pipeline.onSecond((s) => {
    const block = first ?? -1;
    rows.push({
      second: s.second,
      startMs: s.startMs,
      block,
      kind: kindOf.get(block) ?? null,
      pure: blocks.size === 1,
      valid: s.valid,
      validRatio: s.validRatio,
      raw: s.raw,
      z: s.z,
    });
    // The frame that closed this second opens the next one.
    first = current;
    blocks = new Set([current]);
  });
  for (const row of session.frames.slice(start)) {
    current = row[COLUMN.block] ?? -1;
    if (first === null) {
      first = current;
      blocks = new Set([current]);
    }
    pipeline.pushSignals(row[COLUMN.t] ?? 0, rowSignals(row));
    blocks.add(current);
  }
  return rows;
}

/** Row-major [S, F] float32 of raw or z features (NaN rows while calibrating). */
export function featureMatrix(rows: readonly SecondRow[], which: 'raw' | 'z'): Float32Array {
  const out = new Float32Array(rows.length * FEATURE_COUNT).fill(NaN);
  rows.forEach((r, i) => {
    const v = which === 'raw' ? r.raw : r.z;
    if (v) out.set(v, i * FEATURE_COUNT);
  });
  return out;
}
