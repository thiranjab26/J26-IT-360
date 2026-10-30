/**
 * Pure helpers for scripts/extract-landmarks.ts (TODO P1): dataset listings,
 * face crops and the .npy writer. No TF.js and no file system writes here, so
 * everything is unit-tested in tests/unit/scripts/extract-landmarks-lib.test.ts.
 *
 * Public datasets live outside the repo (default C:\datasets) because their
 * licences forbid redistribution (CLAUDE.md invariant 7). Only landmarks are
 * written out; no pixels are ever saved.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DATASETS = ['aflw2000', '300w-lp', 'raf-db', 'expw', 'fer2013'] as const;
export type DatasetName = (typeof DATASETS)[number];

/** Axis-aligned face box in source-image pixels. */
export interface Box {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Square region of the source image that is resampled into the model input. */
export interface Crop {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export type ItemSource =
  /** JPEG file; `box` set when the dataset gives a face box to crop around. */
  | { readonly kind: 'jpeg'; readonly path: string; readonly box?: Box }
  /** FER2013 row: 48×48 grayscale pixels as the CSV's space-separated string. */
  | { readonly kind: 'gray48'; readonly pixels: string };

export interface Item {
  /** Position in the dataset listing; the row of the output .npy. */
  readonly index: number;
  /** Stable id to join with the dataset's own labels (path, or `name#face` for ExpW). */
  readonly id: string;
  /** The dataset's own split name (`train`, `test`, `val`, `PublicTest`, …). */
  readonly split: string;
  /** The dataset's raw label as written in its files ('' when the labels live in .mat files). */
  readonly label: string;
  readonly source: ItemSource;
}

/**
 * Margin added on every side of a dataset face box, as a fraction of the box's
 * longer side. RAF-DB and ExpW boxes are tight around the face, but the
 * BlazeFace detector in front of the mesh was trained on selfie-style frames
 * with hair, neck and background around the face, which is also what the
 * webcam gives the app. 0.25 makes the face about two thirds of the crop.
 * (tune) The found-rate per margin is in the P1 notes in docs/c2/TODO.md.
 */
export const DEFAULT_CROP_MARGIN = 0.25;

/** Side of the square crop fed to FaceMesh for boxed datasets (px). Above the mesh's own 192 px input. */
export const CROP_OUTPUT_SIZE = 256;

/**
 * FER2013 faces are 48×48 and already cropped. They are upscaled to 192 px
 * (the mesh's input size): at 48 px the detector's 128 px input would be
 * mostly upsampling anyway, and a probe found 88 of the first 100 faces at 192.
 */
export const FER_OUTPUT_SIZE = 192;

/** Square crop centred on `box`, side = longer box side × (1 + 2 × margin). May extend past the image. */
export function squareCrop(box: Box, margin: number = DEFAULT_CROP_MARGIN): Crop {
  const w = box.x2 - box.x1;
  const h = box.y2 - box.y1;
  const size = Math.max(w, h) * (1 + 2 * margin);
  return {
    x: (box.x1 + box.x2) / 2 - size / 2,
    y: (box.y1 + box.y2) / 2 - size / 2,
    size,
  };
}

/** Decoded image: `channels` bytes per pixel, row-major (RGBA from jpeg-js, 1 for FER). */
export interface RawImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 3 | 4;
}

/**
 * Bilinear resample of `crop` into an `out`×`out` RGB float image (0..255),
 * the layout `tf.tensor3d(..., [out, out, 3])` expects. Pixels outside the
 * source are black, so a crop that runs past the image edge is padded rather
 * than shifted (shifting would move the face off-centre).
 */
export function resampleCrop(src: RawImage, crop: Crop, out: number): Float32Array {
  const dst = new Float32Array(out * out * 3);
  const scale = crop.size / out;
  const { data, width, height, channels } = src;
  const at = (x: number, y: number, c: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return data[(y * width + x) * channels + (channels === 1 ? 0 : c)] ?? 0;
  };
  for (let oy = 0; oy < out; oy += 1) {
    // Pixel centres: output pixel oy covers source [crop.y + oy*scale, +scale).
    const sy = crop.y + (oy + 0.5) * scale - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let ox = 0; ox < out; ox += 1) {
      const sx = crop.x + (ox + 0.5) * scale - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const o = (oy * out + ox) * 3;
      for (let c = 0; c < 3; c += 1) {
        const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx;
        const bottom = at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx;
        dst[o + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return dst;
}

/** Header of a version 1.0 .npy file holding little-endian float32 data of `shape`. */
export function npyHeader(shape: readonly number[]): Uint8Array {
  const dims = shape.length === 1 ? `${String(shape[0])},` : shape.join(', ');
  let dict = `{'descr': '<f4', 'fortran_order': False, 'shape': (${dims}), }`;
  // Magic (6) + version (2) + header length (2) + dict + '\n' must be a multiple of 64.
  const unpadded = 10 + dict.length + 1;
  dict += ' '.repeat((64 - (unpadded % 64)) % 64) + '\n';
  const header = new Uint8Array(10 + dict.length);
  header.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]);
  header[8] = dict.length & 0xff;
  header[9] = dict.length >> 8;
  for (let i = 0; i < dict.length; i += 1) header[10 + i] = dict.charCodeAt(i);
  return header;
}

/** CSV field, quoted only when needed. */
export function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------------------
// Dataset listings. Order is deterministic so a stopped run can resume and
// worker k always gets items with index % workers === k.
// ---------------------------------------------------------------------------

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '');
}

/** AFLW2000-3D: 2,000 images, test set only (standard protocol: train on 300W-LP, test here). */
async function listAflw(root: string): Promise<Item[]> {
  const dir = join(root, 'aflw2000-3d', 'AFLW2000');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.jpg')).sort();
  return files.map((f, index) => ({
    index,
    id: `AFLW2000/${f}`,
    split: 'test',
    label: '',
    source: { kind: 'jpeg', path: join(dir, f) },
  }));
}

/**
 * 300W-LP: 122,450 images (61,225 + horizontally flipped copies), whole
 * 450×450 images with the face centred, so no crop. Split from the Kaggle
 * `train_test_split_ALL.csv`. That file also lists AFLW2000 images as train/val;
 * those rows are ignored, because AFLW2000 is the held-out test set.
 */
async function list300wLp(root: string): Promise<Item[]> {
  const base = join(root, '300w-lp');
  const rows = lines(await readFile(join(base, 'train_test_split_ALL.csv'), 'utf8')).slice(1);
  const items: Item[] = [];
  for (const row of rows) {
    const [image, , split, , dataset] = row.split(',');
    if (dataset !== '300W_LP' || !image || !split) continue;
    items.push({
      index: items.length,
      id: image,
      split,
      label: '',
      source: { kind: 'jpeg', path: join(base, image) },
    });
  }
  return items;
}

/** The first four fields as finite numbers, or null. */
function finite4(
  fields: readonly (string | undefined)[],
): readonly [number, number, number, number] | null {
  const [a = NaN, b = NaN, c = NaN, d = NaN] = fields.slice(0, 4).map(Number);
  return [a, b, c, d].every((v) => Number.isFinite(v)) ? [a, b, c, d] : null;
}

/** Parses a RAF-DB `<name>_boundingbox.txt`: `x1 y1 x2 y2`. */
export function parseRafBox(text: string): Box {
  const v = finite4(text.trim().split(/\s+/));
  if (!v) throw new Error(`bad RAF box: ${text}`);
  return { x1: v[0], y1: v[1], x2: v[2], y2: v[3] };
}

/** RAF-DB basic: 15,339 photos with face boxes; labels 1..7, official train/test split. */
async function listRaf(root: string): Promise<Item[]> {
  const base = join(root, 'raf-db');
  const rows = lines(await readFile(join(base, 'list_patition_label.txt'), 'utf8'));
  const items: Item[] = [];
  for (const row of rows) {
    const [name, label] = row.trim().split(/\s+/);
    if (!name || !label) continue;
    const stem = name.replace(/\.jpg$/, '');
    const box = parseRafBox(
      await readFile(join(base, 'boundingbox', `${stem}_boundingbox.txt`), 'utf8'),
    );
    items.push({
      index: items.length,
      id: name,
      split: name.startsWith('test') ? 'test' : 'train',
      label,
      source: { kind: 'jpeg', path: join(base, 'original', name), box },
    });
  }
  return items;
}

/**
 * Parses one ExpW `label.lst` line:
 * `image face_id top left right bottom confidence label`.
 */
export function parseExpwLine(line: string): {
  name: string;
  face: string;
  box: Box;
  label: string;
} {
  const [name, face, top, left, right, bottom, , label] = line.trim().split(/\s+/);
  const v = finite4([top, left, right, bottom]);
  if (!name || !face || !label || !v) throw new Error(`bad ExpW line: ${line}`);
  const [t, l, r, b] = v;
  return { name, face, box: { x1: l, y1: t, x2: r, y2: b }, label };
}

/** ExpW: 91,793 faces in whole photos (several faces per photo); labels 0..6; no official split. */
async function listExpw(root: string): Promise<Item[]> {
  const base = join(root, 'expw');
  const rows = lines(await readFile(join(base, 'label', 'label.lst'), 'utf8'));
  return rows.map((row, index) => {
    const { name, face, box, label } = parseExpwLine(row);
    return {
      index,
      id: `${name}#${face}`,
      split: 'train',
      label,
      source: { kind: 'jpeg', path: join(base, 'origin', name), box },
    };
  });
}

/**
 * FER2013: 35,887 rows of `emotion,pixels,Usage`. FER+ labels
 * (`fer2013new.csv`) are row-aligned with this file and joined in Python by
 * index. `keep` drops the pixel strings of rows another worker handles, so
 * each worker holds only its share of the 290 MB file in memory.
 */
async function listFer(root: string, keep: (index: number) => boolean): Promise<Item[]> {
  const rows = lines(await readFile(join(root, 'fer2013', 'fer2013.csv'), 'utf8')).slice(1);
  return rows.map((row, index) => {
    const [label, pixels, split] = row.split(',');
    return {
      index,
      id: `fer2013.csv#${String(index)}`,
      split: split ?? '',
      label: label ?? '',
      source: { kind: 'gray48', pixels: keep(index) ? (pixels ?? '') : '' },
    };
  });
}

export async function listItems(
  dataset: DatasetName,
  root: string,
  keep: (index: number) => boolean = () => true,
): Promise<Item[]> {
  switch (dataset) {
    case 'aflw2000':
      return listAflw(root);
    case '300w-lp':
      return list300wLp(root);
    case 'raf-db':
      return listRaf(root);
    case 'expw':
      return listExpw(root);
    case 'fer2013':
      return listFer(root, keep);
  }
}
