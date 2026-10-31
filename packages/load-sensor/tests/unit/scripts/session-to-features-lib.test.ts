import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT } from '../../../src/core/features/spec.js';
import {
  MemoryRecorderStore,
  SessionRecorder,
  exportSession,
  type SessionExport,
} from '../../../src/core/recorder/index.js';
import { FeaturePipeline, type NormalisedSecond } from '../../../src/core/window/index.js';
import { featureMatrix, replaySession } from '../../../scripts/session-to-features-lib.js';
import { blinkingEar, renderSequence } from '../../fixtures/synthetic-face.js';

const BLINKS = Array.from({ length: 60 }, (_, k) => ({ at: 500 + k * 3100, durationMs: 180 }));

/**
 * Records a session the way the study page does (pipeline reset at the rest
 * block, frames to the recorder) and keeps the live per-second output to
 * compare the replay against.
 */
async function recordWithLive(): Promise<{ session: SessionExport; live: NormalisedSecond[] }> {
  const store = new MemoryRecorderStore();
  const recorder = new SessionRecorder({
    store,
    participant: 'P04',
    featureCodeHash: 'h',
    newId: () => 's',
  });
  const pipeline = new FeaturePipeline();
  const live: NormalisedSecond[] = [];
  pipeline.onFrame((f) => {
    recorder.pushFrame(f);
  });
  pipeline.onSecond((s) => live.push(s));
  const frames = renderSequence({
    fps: 15,
    durationMs: 130_000,
    face: (t) =>
      t > 100_000 && t < 104_000
        ? null
        : {
            ear: blinkingEar(t, BLINKS),
            yaw: 4 * Math.sin(t / 3000),
            irisDx: 0.02 * Math.sin(t / 900),
          },
  });
  // 5 s camera check before the rest block (block −1), as on the study page.
  const push = (from: number, to: number) => {
    for (const f of frames.filter((x) => x.tMs >= from && x.tMs < to)) {
      pipeline.push(f.tMs, f.landmarks, 4 / 3);
    }
  };
  push(0, 5000);
  pipeline.reset();
  live.length = 0;
  recorder.beginBlock('rest', 60);
  push(5000, 65_000);
  recorder.endBlock();
  push(65_000, 70_000); // questionnaire gap
  recorder.beginBlock('hard', 60);
  push(70_000, 130_000);
  await recorder.finish();
  return { session: await exportSession(store, 's'), live };
}

describe('session-to-features replay (TODO C1, one source of truth)', () => {
  it('reproduces the live per-second features from the stored per-frame signals', async () => {
    const { session, live } = await recordWithLive();
    const rows = replaySession(session);
    expect(rows.length).toBe(live.length);
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const l = live[i];
      expect(r?.valid).toBe(l?.valid);
      // Signals are stored to 4 decimals, so features agree closely, not bit for bit.
      for (let k = 0; k < FEATURE_COUNT; k += 1) {
        expect(r?.raw[k]).toBeCloseTo(l?.raw[k] ?? NaN, 2);
      }
      expect(r?.z === null).toBe(l?.z === null);
    }
  });

  it('tags each second with its block, and marks seconds that span two blocks', async () => {
    const { session } = await recordWithLive();
    const rows = replaySession(session);
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds).toEqual(new Set(['rest', 'hard', null]));
    // Rest starts at the replay's first frame; calibration happens there.
    expect(rows[0]?.kind).toBe('rest');
    const firstZ = rows.findIndex((r) => r.z !== null);
    expect(rows[firstZ - 1]?.kind).toBe('rest');
    expect(rows.filter((r) => !r.pure).length).toBeLessThanOrEqual(3);
    // The 4 s without a face inside the hard block are invalid seconds.
    expect(rows.filter((r) => r.kind === 'hard' && !r.valid).length).toBeGreaterThanOrEqual(3);
    const z = featureMatrix(rows, 'z');
    expect(z.length).toBe(rows.length * FEATURE_COUNT);
    expect(Number.isNaN(z[0])).toBe(true);
    expect(Number.isFinite(z[(rows.length - 1) * FEATURE_COUNT])).toBe(true);
  });

  it('refuses an export that fails the privacy self-check', async () => {
    const { session } = await recordWithLive();
    expect(() => replaySession({ ...session, participant: 'Kamal' })).toThrow(/self-check/);
  });
});
