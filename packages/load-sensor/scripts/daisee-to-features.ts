/**
 * P8.3: per-second features for every extracted DAiSEE clip.
 *
 *   pnpm daisee-to-features [--dir=C:/datasets/landmarks/daisee]
 *
 * Reads `<dir>/daisee.csv` and the per-clip `.npy` files written by
 * research/c2-load/video-extract, and writes, row for row with daisee.csv:
 *
 *   <dir>/daisee.seconds.npy   [N, 10, FEATURE_COUNT] raw per-second features
 *   <dir>/daisee.valid.npy     [N, 10] share of each second's frames with a face
 *   <dir>/daisee.features.json feature names (FEATURES order), code_hash, shapes
 *
 * Labels are joined in Python from DAiSEE's own label files by clip id.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FEATURE_COUNT, FEATURE_NAMES } from '../src/core/features/index.js';
import { CLIP_SECONDS, clipSeconds } from './daisee-features-lib.js';
import { npyHeader, readNpyF32 } from './extract-landmarks-lib.js';
import { buildFeatureSpec } from './feature-spec-lib.js';

interface Row {
  readonly id: string;
  readonly split: string;
  readonly frames: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
}

async function main(): Promise<void> {
  const dir =
    process.argv.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) ??
    'C:/datasets/landmarks/daisee';
  const lines = (await readFile(join(dir, 'daisee.csv'), 'utf8')).trim().split(/\r?\n/);
  const header = lines[0]?.split(',') ?? [];
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`daisee.csv has no ${name} column`);
    return i;
  };
  const rows: Row[] = lines.slice(1).map((l) => {
    const c = l.split(',');
    return {
      id: c[col('id')] ?? '',
      split: c[col('split')] ?? '',
      frames: Number(c[col('frames')]),
      fps: Number(c[col('fps')]),
      width: Number(c[col('width')]),
      height: Number(c[col('height')]),
    };
  });

  const seconds = new Float32Array(rows.length * CLIP_SECONDS * FEATURE_COUNT);
  const valid = new Float32Array(rows.length * CLIP_SECONDS);
  for (const [i, r] of rows.entries()) {
    const { shape, data } = readNpyF32(await readFile(join(dir, r.split, `${r.id}.npy`)));
    if (shape[0] !== r.frames)
      throw new Error(`${r.id}: ${String(shape[0])} frames, csv says ${String(r.frames)}`);
    const out = clipSeconds(data, r.frames, r.fps, r.width / r.height);
    seconds.set(out.raw, i * CLIP_SECONDS * FEATURE_COUNT);
    valid.set(out.validRatio, i * CLIP_SECONDS);
    if ((i + 1) % 500 === 0) console.log(`${String(i + 1)}/${String(rows.length)}`);
  }

  await writeFile(
    join(dir, 'daisee.seconds.npy'),
    Buffer.concat([
      npyHeader([rows.length, CLIP_SECONDS, FEATURE_COUNT]),
      new Uint8Array(seconds.buffer),
    ]),
  );
  await writeFile(
    join(dir, 'daisee.valid.npy'),
    Buffer.concat([npyHeader([rows.length, CLIP_SECONDS]), new Uint8Array(valid.buffer)]),
  );
  const spec = JSON.parse(await buildFeatureSpec()) as { code_hash: string };
  const meta = {
    created: new Date().toISOString(),
    rows: rows.length,
    seconds_per_clip: CLIP_SECONDS,
    features: FEATURE_NAMES,
    feature_code_hash: spec.code_hash,
    normalisation: 'none: raw per-second features (TODO P8 decision 4)',
    files: { seconds: 'daisee.seconds.npy', valid: 'daisee.valid.npy', index: 'daisee.csv' },
  };
  await writeFile(join(dir, 'daisee.features.json'), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`${String(rows.length)} clips → ${dir}/daisee.seconds.npy`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
