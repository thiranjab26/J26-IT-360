import type { FrameFeatures } from '../window/feature-pipeline.js';
import { blockOrder, isParticipantCode, latinRow, type TaskCondition } from './latin-square.js';
import {
  BLOCK_EXTRA_ITEMS,
  TLX_ITEMS,
  isScaleAnswers,
  isSusAnswers,
  rawTlx,
  susScore,
  type BlockExtraAnswers,
  type TlxAnswers,
} from './questionnaires.js';

/**
 * Study-mode session recording (TODO B1, ARCHITECTURE.md §9 "Study mode storage").
 *
 * What is kept, per processed frame: the frame time, the active block, whether
 * a face was found, the 13 per-frame signals (§5.1) and the per-frame flags the
 * pipeline derives from them. Per session: participant code, block order and
 * timing, NASA-TLX and the extra items per block, SUS, experimenter notes.
 *
 * What is never kept: images, and not the 478-point landmark mesh. This module
 * only receives `FrameFeatures` (derived numbers); ESLint stops it importing
 * camera/ or landmarks/ (eslint/privacy.js), and `checkSessionExport` refuses
 * an export that holds anything shaped like a mesh or an image.
 *
 * Per-frame signals rather than only per-second vectors, so features can be
 * recomputed if a definition changes: with 8 participants there is no second
 * chance to collect.
 */

export const SESSION_SCHEMA = 1;
export const SESSION_KIND = 'c2-study-session';

export type BlockKind = 'rest' | TaskCondition;

/** Signal columns, in FrameSignals order. */
export const SIGNAL_COLUMNS = [
  'earLeft',
  'earRight',
  'ear',
  'irisDx',
  'irisDy',
  'yaw',
  'pitch',
  'roll',
  'browRaise',
  'browInnerGap',
  'mouthOpen',
  'lipThickness',
  'iod',
] as const;

/**
 * One row per processed frame.
 * - `t`: frame time in ms on the media clock (CLAUDE.md: time comes from the frame).
 * - `block`: index into `blocks`, or −1 between blocks (questionnaires, instructions).
 * - `face`: 1 if a face was found; the signal columns are then NaN-free, else 0 and
 *   the signals are 0 (JSON has no NaN).
 * - flags are 0/1; `closure` is 1 on the frame a blink ends, 2 for a longer
 *   closure, else 0; `closureMs` is that closure's duration.
 */
export const FRAME_COLUMNS = [
  't',
  'block',
  'face',
  ...SIGNAL_COLUMNS,
  'eyesClosed',
  'gazeCentred',
  'offScreen',
  'lookingDown',
  'yawn',
  'nod',
  'closure',
  'closureMs',
] as const;

export type FrameColumn = (typeof FRAME_COLUMNS)[number];
export const COLUMN = Object.fromEntries(FRAME_COLUMNS.map((c, i) => [c, i])) as Readonly<
  Record<FrameColumn, number>
>;

/** Experimenter notes are short by design: a free-text field must not become a diary. */
export const NOTES_MAX_LENGTH = 500;

export interface BlockRecord {
  readonly index: number;
  readonly kind: BlockKind;
  /** Planned length in seconds. */
  readonly plannedS: number;
  /** ISO 8601 wall-clock start and end. */
  readonly startedAt: string;
  endedAt: string | null;
  tlx: TlxAnswers | null;
  /** Unweighted mean of the six subscales. */
  rawTlx: number | null;
  extra: BlockExtraAnswers | null;
}

export interface SessionMeta {
  readonly schema: typeof SESSION_SCHEMA;
  readonly kind: typeof SESSION_KIND;
  /** Random id, not derived from the participant. */
  readonly id: string;
  /** P01…P08 only (CLAUDE.md invariant 7). */
  readonly participant: string;
  readonly latinRow: number;
  readonly order: readonly TaskCondition[];
  readonly startedAt: string;
  /** feature_spec.json `code_hash` of the feature code that produced the signals. */
  readonly featureCodeHash: string;
  readonly columns: readonly FrameColumn[];
  readonly blocks: BlockRecord[];
  sus: { readonly answers: readonly number[]; readonly score: number } | null;
  notes: string;
  finishedAt: string | null;
}

export interface SessionExport extends SessionMeta {
  readonly frames: readonly (readonly number[])[];
}

/** Where a session lives while it is recorded; IndexedDB in the browser, memory in tests. */
export interface RecorderStore {
  putSession(meta: SessionMeta): Promise<void>;
  putChunk(sessionId: string, seq: number, rows: readonly (readonly number[])[]): Promise<void>;
  getSession(sessionId: string): Promise<SessionMeta | null>;
  /** Every chunk of a session, in `seq` order. */
  getChunks(sessionId: string): Promise<(readonly (readonly number[])[])[]>;
  listSessions(): Promise<SessionMeta[]>;
  deleteSession(sessionId: string): Promise<void>;
}

export interface SessionRecorderOptions {
  readonly store: RecorderStore;
  readonly participant: string;
  readonly featureCodeHash: string;
  /** Frames per stored chunk: about a minute at 15 fps, so a crash loses at most that. */
  readonly chunkFrames?: number;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

/** 4 decimals: below the landmark model's own jitter, and keeps the export small. */
function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

const bit = (b: boolean): number => (b ? 1 : 0);

/** The stored row for one frame (FRAME_COLUMNS order). */
export function frameRow(f: FrameFeatures, block: number): number[] {
  const s = f.signals;
  const signals = SIGNAL_COLUMNS.map((c) => (s ? round4(s[c]) : 0));
  const closure = f.closure ? (f.closure.kind === 'blink' ? 1 : 2) : 0;
  return [
    round4(f.tMs),
    block,
    bit(s !== null),
    ...signals,
    bit(f.eyesClosed),
    bit(f.gazeCentred),
    bit(f.offScreen),
    bit(f.lookingDown),
    bit(f.yawn),
    bit(f.nod),
    closure,
    f.closure ? Math.round(f.closure.durationMs) : 0,
  ];
}

/**
 * Records one study session. Frames are buffered and written to the store in
 * chunks; the session record is written on every block change and answer, so
 * a crashed tab still leaves an exportable session (`exportSession`).
 */
export class SessionRecorder {
  readonly meta: SessionMeta;

  readonly #store: RecorderStore;
  readonly #chunkFrames: number;
  readonly #now: () => Date;
  #buffer: number[][] = [];
  #seq = 0;
  #frames = 0;
  #block = -1;
  #writes: Promise<void> = Promise.resolve();
  #writeError: unknown = null;

  constructor(options: SessionRecorderOptions) {
    if (!isParticipantCode(options.participant)) {
      throw new RangeError(`Participant code must be P01…P08, got "${options.participant}".`);
    }
    this.#store = options.store;
    this.#chunkFrames = options.chunkFrames ?? 900;
    this.#now = options.now ?? (() => new Date());
    const newId = options.newId ?? (() => crypto.randomUUID());
    this.meta = {
      schema: SESSION_SCHEMA,
      kind: SESSION_KIND,
      id: newId(),
      participant: options.participant,
      latinRow: latinRow(options.participant),
      order: blockOrder(options.participant),
      startedAt: this.#now().toISOString(),
      featureCodeHash: options.featureCodeHash,
      columns: FRAME_COLUMNS,
      blocks: [],
      sus: null,
      notes: '',
      finishedAt: null,
    };
    this.#saveMeta();
  }

  /** Frames recorded so far. */
  get frameCount(): number {
    return this.#frames;
  }

  /** Index of the running block, or −1. */
  get currentBlock(): number {
    return this.#block;
  }

  /** The first failed write, if any (e.g. storage full). The study page shows it. */
  get writeError(): unknown {
    return this.#writeError;
  }

  pushFrame(f: FrameFeatures): void {
    if (this.meta.finishedAt) return;
    this.#buffer.push(frameRow(f, this.#block));
    this.#frames += 1;
    if (this.#buffer.length >= this.#chunkFrames) this.#flushBuffer();
  }

  beginBlock(kind: BlockKind, plannedS: number): BlockRecord {
    if (this.#block !== -1) this.endBlock();
    const record: BlockRecord = {
      index: this.meta.blocks.length,
      kind,
      plannedS,
      startedAt: this.#now().toISOString(),
      endedAt: null,
      tlx: null,
      rawTlx: null,
      extra: null,
    };
    this.meta.blocks.push(record);
    this.#block = record.index;
    this.#saveMeta();
    return record;
  }

  endBlock(): void {
    const record = this.meta.blocks[this.#block];
    if (!record) return;
    record.endedAt = this.#now().toISOString();
    this.#block = -1;
    this.#flushBuffer();
    this.#saveMeta();
  }

  setBlockAnswers(index: number, tlx: TlxAnswers, extra: BlockExtraAnswers): void {
    const record = this.meta.blocks[index];
    if (!record) throw new RangeError(`No block ${String(index)}.`);
    if (!isScaleAnswers(TLX_ITEMS, tlx) || !isScaleAnswers(BLOCK_EXTRA_ITEMS, extra)) {
      throw new RangeError('Every item needs an answer from 0 to 100 in steps of 5.');
    }
    record.tlx = { ...tlx };
    record.rawTlx = rawTlx(tlx);
    record.extra = { ...extra };
    this.#saveMeta();
  }

  setSus(answers: readonly number[]): void {
    if (!isSusAnswers(answers)) throw new RangeError('SUS needs ten answers, each 1–5.');
    this.meta.sus = { answers: [...answers], score: susScore(answers) };
    this.#saveMeta();
  }

  setNotes(notes: string): void {
    this.meta.notes = notes.slice(0, NOTES_MAX_LENGTH);
    this.#saveMeta();
  }

  /** Ends any running block and writes everything; the recorder ignores frames afterwards. */
  async finish(): Promise<void> {
    if (this.#block !== -1) this.endBlock();
    this.meta.finishedAt = this.#now().toISOString();
    this.#flushBuffer();
    this.#saveMeta();
    await this.flush();
  }

  /** Resolves once every write so far is stored; rejects with the first failed write. */
  async flush(): Promise<void> {
    this.#flushBuffer();
    await this.#writes;
    const error = this.#writeError;
    if (error instanceof Error) throw error;
    if (error !== null) throw new Error('Saving the study session failed.', { cause: error });
  }

  #flushBuffer(): void {
    if (this.#buffer.length === 0) return;
    const rows = this.#buffer;
    const seq = this.#seq;
    this.#buffer = [];
    this.#seq += 1;
    this.#queue(() => this.#store.putChunk(this.meta.id, seq, rows));
  }

  #saveMeta(): void {
    // A snapshot: later changes must not alter what this write stores.
    const snapshot = structuredClone(this.meta);
    this.#queue(() => this.#store.putSession(snapshot));
  }

  /** Writes run one after another, so chunks and the session record land in order. */
  #queue(write: () => Promise<void>): void {
    this.#writes = this.#writes.then(write).catch((error: unknown) => {
      this.#writeError ??= error;
    });
  }
}

/** Reads a stored session (finished or not) back as one export object. */
export async function exportSession(
  store: RecorderStore,
  sessionId: string,
): Promise<SessionExport> {
  const meta = await store.getSession(sessionId);
  if (!meta) throw new Error(`No stored session ${sessionId}.`);
  const chunks = await store.getChunks(sessionId);
  return { ...meta, frames: chunks.flat() };
}

/** File name for an export: participant and date only, no names (invariant 7). */
export function exportFileName(meta: Pick<SessionMeta, 'participant' | 'startedAt'>): string {
  const stamp = meta.startedAt.slice(0, 16).replace(/[:T]/g, '-');
  return `c2-study-${meta.participant}-${stamp}.json`;
}
