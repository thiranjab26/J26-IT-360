import { describe, expect, it } from 'vitest';
import {
  COLUMN,
  FRAME_COLUMNS,
  LATIN_SQUARE,
  MemoryRecorderStore,
  SUS_ITEMS,
  SessionRecorder,
  TASK_CONDITIONS,
  blockOrder,
  checkSessionExport,
  exportFileName,
  exportSession,
  isParticipantCode,
  latinRow,
  rawTlx,
  sessionQuality,
  susScore,
  type SessionExport,
  type TlxAnswers,
} from '../../../src/core/recorder/index.js';
import { FeaturePipeline } from '../../../src/core/window/feature-pipeline.js';
import { blinkingEar, renderSequence } from '../../fixtures/synthetic-face.js';

const TLX: TlxAnswers = {
  mental: 70,
  physical: 10,
  temporal: 50,
  performance: 30,
  effort: 60,
  frustration: 40,
};
const EXTRA = { boredom: 20, tiredness: 35 };

describe('B1 Latin square', () => {
  it('puts every condition once in every row and every position', () => {
    for (const row of LATIN_SQUARE) expect([...row].sort()).toEqual([0, 1, 2, 3]);
    for (let col = 0; col < 4; col += 1) {
      expect(LATIN_SQUARE.map((r) => r[col]).sort()).toEqual([0, 1, 2, 3]);
    }
  });

  it('has every condition follow every other exactly once (Williams design)', () => {
    const pairs = LATIN_SQUARE.flatMap((r) =>
      r.slice(1).map((c, i) => `${String(r[i])}>${String(c)}`),
    );
    expect(new Set(pairs).size).toBe(12);
  });

  it('maps P01…P08 onto rows twice and refuses other codes', () => {
    expect(['P01', 'P02', 'P03', 'P04', 'P05', 'P08'].map(latinRow)).toEqual([0, 1, 2, 3, 0, 3]);
    expect(blockOrder('P01')).toEqual(['easy', 'medium', 'underload', 'hard']);
    expect(new Set(blockOrder('P03'))).toEqual(new Set(TASK_CONDITIONS));
    for (const bad of ['P09', 'P00', 'p01', 'P1', 'alice', ' P01']) {
      expect(isParticipantCode(bad)).toBe(false);
    }
    expect(() => latinRow('P10')).toThrow(RangeError);
  });
});

describe('B1 questionnaires', () => {
  it('raw TLX is the mean of the six subscales', () => {
    expect(rawTlx(TLX)).toBeCloseTo(260 / 6, 10);
  });

  it('scores SUS the standard way', () => {
    expect(susScore(Array<number>(10).fill(3))).toBe(50);
    expect(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
    expect(SUS_ITEMS).toHaveLength(10);
    expect(() => susScore([3, 3, 3])).toThrow(RangeError);
    expect(() => susScore(Array<number>(10).fill(6))).toThrow(RangeError);
  });
});

/** 20 s of synthetic face with 6 blinks, 5 s without a face, at 15 fps, through the real pipeline. */
async function recordSession(): Promise<{ store: MemoryRecorderStore; out: SessionExport }> {
  const store = new MemoryRecorderStore();
  let clock = Date.parse('2026-11-02T09:00:00Z');
  const recorder = new SessionRecorder({
    store,
    participant: 'P03',
    featureCodeHash: 'test-hash',
    chunkFrames: 50,
    now: () => new Date((clock += 1000)),
    newId: () => 'session-1',
  });
  const pipeline = new FeaturePipeline();
  pipeline.onFrame((f) => {
    recorder.pushFrame(f);
  });
  const blinks = [2000, 5000, 8000, 11000, 14000, 17000].map((at) => ({ at, durationMs: 150 }));
  const frames = renderSequence({
    fps: 15,
    durationMs: 25_000,
    face: (t) => (t < 20_000 ? { ear: blinkingEar(t, blinks) } : null),
  });

  recorder.beginBlock('rest', 20);
  for (const f of frames.filter((x) => x.tMs < 20_000)) pipeline.push(f.tMs, f.landmarks, 4 / 3);
  recorder.beginBlock('hard', 5);
  for (const f of frames.filter((x) => x.tMs >= 20_000)) pipeline.push(f.tMs, f.landmarks, 4 / 3);
  recorder.endBlock();
  recorder.setBlockAnswers(1, TLX, EXTRA);
  recorder.setSus([4, 2, 4, 2, 4, 2, 4, 2, 4, 2]);
  recorder.setNotes('dim room, glasses');
  await recorder.finish();
  return { store, out: await exportSession(store, 'session-1') };
}

describe('B1 session recorder', () => {
  it('stores derived numbers per frame, block markers and answers', async () => {
    const { out } = await recordSession();
    expect(out.participant).toBe('P03');
    expect(out.order).toEqual(blockOrder('P03'));
    expect(out.columns).toEqual(FRAME_COLUMNS);
    expect(out.frames).toHaveLength(375);
    expect(out.frames.every((r) => r.length === FRAME_COLUMNS.length)).toBe(true);
    expect(out.blocks.map((b) => b.kind)).toEqual(['rest', 'hard']);
    expect(out.blocks.every((b) => b.endedAt !== null)).toBe(true);
    expect(out.blocks[1]?.tlx).toEqual(TLX);
    expect(out.blocks[1]?.extra).toEqual(EXTRA);
    expect(out.sus?.score).toBe(75);
    expect(out.notes).toBe('dim room, glasses');
    expect(out.finishedAt).not.toBeNull();
    // Frames are in time order across chunks, and tagged with their block.
    const t = out.frames.map((r) => r[COLUMN.t] ?? NaN);
    expect(t.every((v, i) => i === 0 || v > (t[i - 1] ?? Infinity))).toBe(true);
    expect(out.frames.filter((r) => r[COLUMN.block] === 1).every((r) => r[COLUMN.face] === 0)).toBe(
      true,
    );
  });

  it('keeps a crashed session exportable up to the last chunk', async () => {
    const store = new MemoryRecorderStore();
    const recorder = new SessionRecorder({
      store,
      participant: 'P01',
      featureCodeHash: 'h',
      chunkFrames: 10,
      newId: () => 's',
    });
    const pipeline = new FeaturePipeline();
    pipeline.onFrame((f) => {
      recorder.pushFrame(f);
    });
    recorder.beginBlock('rest', 60);
    for (const f of renderSequence({ fps: 15, durationMs: 2000, face: () => ({}) })) {
      pipeline.push(f.tMs, f.landmarks, 4 / 3);
    }
    // No finish(): only wait for the writes already queued (the tab "crashes" here).
    await new Promise((r) => setTimeout(r, 0));
    const out = await exportSession(store, 's');
    expect(out.frames).toHaveLength(30);
    expect(out.finishedAt).toBeNull();
    expect(out.blocks[0]?.endedAt).toBeNull();
  });

  it('refuses a participant code that is not P01…P08', () => {
    expect(
      () =>
        new SessionRecorder({
          store: new MemoryRecorderStore(),
          participant: 'Kamal',
          featureCodeHash: 'h',
        }),
    ).toThrow(RangeError);
  });

  it('names the file by participant and date only', () => {
    expect(exportFileName({ participant: 'P02', startedAt: '2026-11-02T09:15:42.000Z' })).toBe(
      'c2-study-P02-2026-11-02-09-15.json',
    );
  });
});

describe('B1 recorder self-check: no image data, no landmark mesh', () => {
  it('passes a real export', async () => {
    const { out } = await recordSession();
    expect(checkSessionExport(JSON.parse(JSON.stringify(out)))).toEqual([]);
  });

  it('catches a landmark mesh, an image and a non-participant code', async () => {
    const { out } = await recordSession();
    const mesh = Array.from({ length: 478 * 3 }, (_, i) => i / 1434);
    expect(checkSessionExport({ ...out, mesh })).toEqual([
      expect.stringContaining('$.mesh is a numeric array of 1434'),
    ]);
    const frames = out.frames.map((r, i) => (i === 3 ? [...r, ...mesh] : r));
    expect(checkSessionExport({ ...out, frames })[0]).toContain('frame 3');
    expect(checkSessionExport({ ...out, notes: 'data:image/png;base64,iVBORw0KGgo=' })).toEqual([
      '$.notes is a data URL',
    ]);
    expect(checkSessionExport({ ...out, thumb: 'A'.repeat(4000) })[0]).toContain('base64');
    expect(checkSessionExport({ ...out, raw: new Float32Array(4) })[0]).toContain('binary');
    expect(checkSessionExport({ ...out, participant: 'kamal@example.com' })).toContain(
      'participant is not a P01…P08 code',
    );
    expect(checkSessionExport({ ...out, columns: [...FRAME_COLUMNS, 'x0'] })).toContain(
      'columns differ from FRAME_COLUMNS',
    );
  });
});

describe('B1 session quality summary', () => {
  it('reports fps, face ratio and blink rate per block, and flags a lost face', async () => {
    const { out } = await recordSession();
    const q = sessionQuality(out.blocks, out.frames);
    const [rest, hard] = q.blocks;
    expect(rest?.fps).toBeCloseTo(15, 0);
    expect(rest?.faceRatio).toBe(1);
    expect(rest?.blinks).toBe(6);
    expect(rest?.blinksPerMin).toBeCloseTo(18, 0);
    expect(rest?.warnings).toEqual([]);
    expect(hard?.faceRatio).toBe(0);
    expect(hard?.warnings.some((w) => w.includes('face found'))).toBe(true);
    expect(q.ok).toBe(false);
  });
});
