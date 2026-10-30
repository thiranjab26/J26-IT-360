/**
 * Helpers for the P8 video extractor (docs/c2/TODO.md, P8): the DAiSEE clip
 * list and raw-frame splitting. No TF.js here, so it is unit-tested in
 * test/video-lib.test.ts.
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

export const SPLITS = ['Train', 'Validation', 'Test'] as const;
export type Split = (typeof SPLITS)[number];

/**
 * Clips left out. 2100552061 failed the CRC check when DAiSEE was unpacked
 * (C:\datasets\unpack.log); OpenCV still decodes all 300 frames but reports a
 * damaged block, so it is excluded rather than trusted (TODO P8 facts).
 */
export const EXCLUDED_CLIPS: ReadonlySet<string> = new Set(['2100552061']);

export interface Clip {
  /** Position in the listing (Train, Validation, Test; clip id order within each). */
  readonly index: number;
  /** DAiSEE ClipID without extension, e.g. `1100011002`. */
  readonly id: string;
  readonly split: Split;
  /** Person folder the clip sits in. Splits are person-disjoint (checked 30 Oct). */
  readonly subject: string;
  readonly path: string;
}

/** ClipIDs (without extension) in one of DAiSEE's `<Split>Labels.csv` files. */
export function parseLabelIds(csv: string): string[] {
  const rows = csv.split(/\r?\n/).filter((r) => r.trim() !== '');
  const header = rows[0]?.split(',').map((h) => h.trim()) ?? [];
  if (header[0] !== 'ClipID') throw new Error(`unexpected DAiSEE label header: ${rows[0] ?? ''}`);
  return rows.slice(1).map((r) => (r.split(',')[0] ?? '').trim().replace(/\.(avi|mp4)$/i, ''));
}

/**
 * The labelled clips of every split, from the official per-split label files
 * (not AllLabels.csv, which disagrees with them). Every listed clip must have
 * exactly one video file, or this throws.
 */
export async function listClips(root: string): Promise<Clip[]> {
  const clips: Clip[] = [];
  for (const split of SPLITS) {
    const ids = parseLabelIds(await readFile(join(root, 'Labels', `${split}Labels.csv`), 'utf8'));
    const files = await videoFiles(join(root, 'DataSet', split));
    for (const id of [...ids].sort()) {
      if (EXCLUDED_CLIPS.has(id)) continue;
      const found = files.get(id);
      if (!found) throw new Error(`${split} label ${id} has no video file`);
      clips.push({ index: clips.length, id, split, subject: found.subject, path: found.path });
    }
  }
  return clips;
}

/** `<split dir>/<subject>/<clip id>/<clip id>.(avi|mp4)` → id → file. */
async function videoFiles(splitDir: string): Promise<Map<string, { subject: string; path: string }>> {
  const out = new Map<string, { subject: string; path: string }>();
  for (const subject of await readdir(splitDir, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    for (const clipDir of await readdir(join(splitDir, subject.name), { withFileTypes: true })) {
      if (!clipDir.isDirectory()) continue;
      for (const file of await readdir(join(splitDir, subject.name, clipDir.name))) {
        const ext = extname(file).toLowerCase();
        if (ext !== '.avi' && ext !== '.mp4') continue;
        const id = file.slice(0, -ext.length);
        if (out.has(id)) throw new Error(`clip ${id} has more than one video file`);
        out.set(id, { subject: subject.name, path: join(splitDir, subject.name, clipDir.name, file) });
      }
    }
  }
  return out;
}

/**
 * Cuts ffmpeg's raw rgb24 stream (bytes arrive in arbitrary chunks) into whole
 * frames of `width × height × 3` bytes.
 */
export class FrameSplitter {
  readonly #frameBytes: number;
  #pending: Buffer = Buffer.alloc(0);

  constructor(width: number, height: number) {
    if (!(width > 0 && height > 0)) throw new Error(`bad frame size ${String(width)}x${String(height)}`);
    this.#frameBytes = width * height * 3;
  }

  /** Returns the frames completed by `chunk` (each a copy, safe to keep). */
  push(chunk: Buffer): Uint8Array[] {
    this.#pending = this.#pending.length === 0 ? chunk : Buffer.concat([this.#pending, chunk]);
    const frames: Uint8Array[] = [];
    let offset = 0;
    while (this.#pending.length - offset >= this.#frameBytes) {
      frames.push(Uint8Array.from(this.#pending.subarray(offset, offset + this.#frameBytes)));
      offset += this.#frameBytes;
    }
    this.#pending = this.#pending.subarray(offset);
    return frames;
  }

  /** Bytes of an unfinished frame left at the end of the stream (should be 0). */
  get leftover(): number {
    return this.#pending.length;
  }
}
