/**
 * Offline landmark extraction for the public datasets (TODO P1). Runs the
 * app's own adapter A model — the same self-hosted FaceMesh files and
 * `createDetector` settings as TfjsFaceMeshProvider — so the trained models
 * see the same kind of landmarks the app produces.
 *
 *   pnpm extract-landmarks <dataset> [--workers=12] [--limit=N] [--margin=0.25]
 *                          [--root=C:/datasets] [--out=C:/datasets/landmarks] [--fresh]
 *
 *   dataset: aflw2000 | 300w-lp | raf-db | expw | fer2013
 *
 * Writes `<out>/<dataset>.npy` (float32 [N, 478, 3], NaN rows where no face
 * was found; x, y normalised to the crop, z in x units, as in FaceResult) and
 * `<out>/<dataset>.csv` (one row per item: id, split, label, crop) plus a
 * `<dataset>.summary.json`. No pixels are written anywhere.
 *
 * Backend: TF.js `cpu`. The app never uses it (too slow for live video), but
 * offline speed does not matter and the WASM backend cannot run this model:
 * the attention mesh multiplies int32 matrices (SpatialTransformer
 * `BatchMatMulV2`), which tfjs-backend-wasm 4.22.0 rejects. The work is split
 * over worker processes instead. A stopped run resumes where it left off.
 */
import { fork } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '@tensorflow/tfjs-backend-cpu';
import * as tf from '@tensorflow/tfjs-core';
import * as fld from '@tensorflow-models/face-landmarks-detection';
import { keypointsToLandmarks } from '../src/core/landmarks/keypoints.js';
import { FACEMESH_ASSET_PATHS } from '../src/core/landmarks/tfjs-facemesh-provider.js';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../src/core/landmarks/types.js';
import {
  csvField,
  DATASETS,
  DEFAULT_CROP_MARGIN,
  listItems,
  npyHeader,
  prepareInput as prepare,
  type Crop,
  type DatasetName,
} from './extract-landmarks-lib.js';

const SCRIPT = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = join(dirname(SCRIPT), '..');
const VALUES_PER_FACE = LANDMARK_COUNT * LANDMARK_STRIDE;
const RECORD_BYTES = VALUES_PER_FACE * 4;
const CSV_HEADER = 'index,id,split,label,found,crop_x,crop_y,crop_size,input_size,error';

interface Options {
  readonly dataset: DatasetName;
  readonly root: string;
  readonly out: string;
  readonly workers: number;
  readonly limit: number;
  readonly margin: number;
  readonly fresh: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const dataset = argv.find((a) => !a.startsWith('--'));
  if (!dataset || !(DATASETS as readonly string[]).includes(dataset)) {
    throw new Error(`usage: extract-landmarks <${DATASETS.join('|')}> [--workers=N] [--limit=N] …`);
  }
  // Leave cores for the OS; each worker holds its own model copy (~0.3 GB).
  const defaultWorkers = Math.max(1, Math.min(12, availableParallelism() - 2));
  return {
    dataset: dataset as DatasetName,
    root: flag('root') ?? 'C:/datasets',
    out: flag('out') ?? 'C:/datasets/landmarks',
    workers: Number(flag('workers') ?? defaultWorkers),
    limit: Number(flag('limit') ?? Infinity),
    margin: Number(flag('margin') ?? DEFAULT_CROP_MARGIN),
    fresh: argv.includes('--fresh'),
  };
}

/** Reads a self-hosted TF.js graph model from disk (the library's default would fetch tfhub.dev). */
function fileModel(modelJsonPath: string): tf.io.IOHandler {
  return {
    async load() {
      const json = JSON.parse(await readFile(modelJsonPath, 'utf8')) as tf.io.ModelJSON;
      const weightSpecs: tf.io.WeightsManifestEntry[] = [];
      const buffers: Buffer[] = [];
      for (const group of json.weightsManifest) {
        weightSpecs.push(...group.weights);
        for (const p of group.paths) buffers.push(await readFile(join(dirname(modelJsonPath), p)));
      }
      const all = Buffer.concat(buffers);
      return {
        ...json,
        weightSpecs,
        weightData: all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength),
      };
    },
  };
}

async function createDetector(): Promise<fld.FaceLandmarksDetector> {
  await tf.setBackend('cpu');
  await tf.ready();
  const models = join(PACKAGE_ROOT, 'public', 'models');
  // Same settings as TfjsFaceMeshProvider, except the model source.
  return fld.createDetector(fld.SupportedModels.MediaPipeFaceMesh, {
    runtime: 'tfjs',
    refineLandmarks: true,
    maxFaces: 1,
    detectorModelUrl: fileModel(join(models, FACEMESH_ASSET_PATHS.detector)),
    landmarkModelUrl: fileModel(join(models, FACEMESH_ASSET_PATHS.landmarks)),
  });
}

// ---------------------------------------------------------------------------
// Worker: processes items with index % workers === k, appending to its part files.
// ---------------------------------------------------------------------------

function partPaths(opts: Options, k: number): { csv: string; bin: string } {
  const base = join(opts.out, `${opts.dataset}.part${String(k)}`);
  return { csv: `${base}.csv`, bin: `${base}.f32` };
}

/** Keeps only complete rows of a part from a stopped run; returns how many there are. */
function recoverPart(paths: { csv: string; bin: string }): number {
  if (!existsSync(paths.csv)) return 0;
  const text = readFileSync(paths.csv, 'utf8');
  const complete = text.slice(0, text.lastIndexOf('\n') + 1);
  const rows = complete === '' ? 0 : complete.split('\n').length - 1;
  const binBytes = existsSync(paths.bin) ? readFileSync(paths.bin).byteLength : 0;
  // A row counts only when both its CSV line and its landmark record were written.
  const done = Math.min(rows, Math.floor(binBytes / RECORD_BYTES));
  writeFileSync(
    paths.csv,
    complete
      .split('\n')
      .slice(0, done)
      .map((l) => `${l}\n`)
      .join(''),
  );
  if (existsSync(paths.bin)) truncateSync(paths.bin, done * RECORD_BYTES);
  return done;
}

async function runWorker(opts: Options, k: number): Promise<void> {
  const mine = (i: number): boolean => i % opts.workers === k && i < opts.limit;
  const items = (await listItems(opts.dataset, opts.root, mine)).filter((it) => mine(it.index));
  const paths = partPaths(opts, k);
  const skip = recoverPart(paths);
  const detector = await createDetector();
  const empty = new Float32Array(VALUES_PER_FACE).fill(NaN);

  let done = skip;
  let found = 0;
  for (const item of items.slice(skip)) {
    let landmarks: Float32Array | null = null;
    let crop: Crop = { x: 0, y: 0, size: 0 };
    let size = 0;
    let error = '';
    try {
      const input = await prepare(item, opts.margin);
      crop = input.crop;
      size = input.size;
      const pixels = tf.tensor3d(input.rgb, [size, size, 3], 'float32');
      try {
        // Every image is independent. staticImageMode alone does not ensure
        // that in face-landmarks-detection 1.0.6: it still merges the new
        // detection with the face box from the previous image's landmarks
        // (dist/tfjs/detector.js, calculateAssociationNormRect), so reset()
        // first. Found 31 Oct by `pnpm landmark-parity` (TODO P1): extractions
        // before that date carry this state (29 of 40 AFLW2000 rows differed).
        detector.reset();
        const faces = await detector.estimateFaces(pixels, { staticImageMode: true });
        if (faces[0]) landmarks = keypointsToLandmarks(faces[0].keypoints, size, size);
      } finally {
        pixels.dispose();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (landmarks) found += 1;
    // Landmarks first: recoverPart() only trusts rows whose record is complete.
    appendFileSync(paths.bin, Buffer.from((landmarks ?? empty).buffer));
    const row = [
      item.index,
      item.id,
      item.split,
      item.label,
      landmarks ? 1 : 0,
      crop.x.toFixed(2),
      crop.y.toFixed(2),
      crop.size.toFixed(2),
      size,
      error,
    ];
    appendFileSync(paths.csv, `${row.map(csvField).join(',')}\n`);
    done += 1;
    process.send?.({ k, done, found, total: items.length, tensors: tf.memory().numTensors });
  }
  detector.dispose();
}

// ---------------------------------------------------------------------------
// Parent: forks the workers, reports progress, merges the parts.
// ---------------------------------------------------------------------------

interface Progress {
  done: number;
  found: number;
  total: number;
  tensors: number;
}

async function runParent(opts: Options): Promise<void> {
  await mkdir(opts.out, { recursive: true });
  const runPath = join(opts.out, `${opts.dataset}.run.json`);
  const run = { workers: opts.workers, limit: opts.limit, margin: opts.margin };
  if (opts.fresh) {
    for (let k = 0; k < 64; k += 1) {
      const p = partPaths(opts, k);
      await rm(p.csv, { force: true });
      await rm(p.bin, { force: true });
    }
    await rm(runPath, { force: true });
  }
  if (existsSync(runPath)) {
    const previous = (await readFile(runPath, 'utf8')).trim();
    if (previous !== JSON.stringify(run)) {
      throw new Error(
        `a run with other settings is in progress (${previous}); pass --fresh to discard it`,
      );
    }
    console.log('resuming the previous run');
  }
  await writeFile(runPath, JSON.stringify(run));

  const started = performance.now();
  const progress = new Map<number, Progress>();
  const log = (): void => {
    let done = 0;
    let found = 0;
    let total = 0;
    for (const p of progress.values()) {
      done += p.done;
      found += p.found;
      total += p.total;
    }
    const secs = (performance.now() - started) / 1000;
    const rate = done / secs;
    const eta = rate > 0 ? (total - done) / rate / 60 : NaN;
    const tensors = [...progress.values()].map((p) => p.tensors);
    console.log(
      `[${new Date().toLocaleTimeString()}] ${opts.dataset} ${String(done)}/${String(total)} ` +
        `found ${String(found)} this session · ${rate.toFixed(1)} img/s · ETA ${eta.toFixed(0)} min · ` +
        `tensors ${String(Math.min(...tensors))}–${String(Math.max(...tensors))}`,
    );
  };
  const timer = setInterval(log, 30_000);

  const args = process.argv.slice(2).filter((a) => a !== '--fresh');
  const exits = Array.from({ length: opts.workers }, (_, k) => {
    const child = fork(SCRIPT, [...args, `--worker=${String(k)}`], {
      execArgv: ['--import', 'tsx'],
    });
    child.on('message', (m: Progress & { k: number }) => {
      progress.set(m.k, m);
    });
    return new Promise<number>((resolve) => {
      child.on('exit', (code) => {
        resolve(code ?? 1);
      });
    });
  });
  const codes = await Promise.all(exits);
  clearInterval(timer);
  log();
  if (codes.some((c) => c !== 0)) {
    throw new Error(`worker exit codes ${codes.join(',')}; rerun the same command to resume`);
  }
  await merge(opts, (performance.now() - started) / 1000);
  await rm(runPath, { force: true });
}

async function merge(opts: Options, seconds: number): Promise<void> {
  const rows: { index: number; line: string; record: Buffer }[] = [];
  for (let k = 0; k < opts.workers; k += 1) {
    const p = partPaths(opts, k);
    if (!existsSync(p.csv)) continue;
    const lines = (await readFile(p.csv, 'utf8')).split('\n').filter((l) => l !== '');
    const bin = await readFile(p.bin);
    lines.forEach((line, i) => {
      rows.push({
        index: Number(line.slice(0, line.indexOf(','))),
        line,
        record: bin.subarray(i * RECORD_BYTES, (i + 1) * RECORD_BYTES),
      });
    });
  }
  rows.sort((a, b) => a.index - b.index);

  const npyPath = join(opts.out, `${opts.dataset}.npy`);
  const header = npyHeader([rows.length, LANDMARK_COUNT, LANDMARK_STRIDE]);
  await writeFile(npyPath, Buffer.concat([header, ...rows.map((r) => r.record)]));
  await writeFile(
    join(opts.out, `${opts.dataset}.csv`),
    `${CSV_HEADER}\n${rows.map((r) => r.line).join('\n')}\n`,
  );

  const bySplit: Record<string, { n: number; found: number }> = {};
  let errors = 0;
  for (const r of rows) {
    const cols = r.line.split(',');
    const split = cols[2] ?? '';
    const s = (bySplit[split] ??= { n: 0, found: 0 });
    s.n += 1;
    if (cols[4] === '1') s.found += 1;
    if (!r.line.endsWith(',')) errors += 1;
  }
  const found = rows.filter((r) => r.line.split(',')[4] === '1').length;
  const summary = {
    dataset: opts.dataset,
    created: new Date().toISOString(),
    model: 'tfjs MediaPipeFaceMesh, refineLandmarks, public/models/facemesh (adapter A)',
    backend: 'cpu',
    crop_margin: opts.margin,
    n: rows.length,
    found,
    found_rate: rows.length ? found / rows.length : 0,
    errors,
    by_split: bySplit,
    workers: opts.workers,
    seconds: Math.round(seconds),
    npy_bytes: (await stat(npyPath)).size,
  };
  await writeFile(
    join(opts.out, `${opts.dataset}.summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  for (let k = 0; k < opts.workers; k += 1) {
    const p = partPaths(opts, k);
    await rm(p.csv, { force: true });
    await rm(p.bin, { force: true });
  }
  console.log(JSON.stringify(summary, null, 2));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  const worker = argv.find((a) => a.startsWith('--worker='));
  if (worker) await runWorker(opts, Number(worker.slice('--worker='.length)));
  else await runParent(opts);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
