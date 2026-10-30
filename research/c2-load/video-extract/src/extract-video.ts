/**
 * P8: landmarks from DAiSEE videos with the app's own FaceMesh (adapter A
 * model files and createDetector settings), so a model trained on them sees
 * the same landmarks the app produces. Offline only, never shipped.
 *
 *   run.sh [--fps=15] [--backend=tensorflow|cpu] [--workers=N] [--limit=N]
 *          [--root=/mnt/c/datasets/daisee/DAiSEE] [--out=/mnt/c/datasets/landmarks/daisee]
 *
 * Per clip, writes `<out>/<split>/<clip id>.npy` (float32 [frames, 478, 3],
 * NaN rows where no face was found; x / width, y / height, z / width as in
 * FaceResult) and `<clip id>.json` (frame count, fps, size, faces found).
 * Frame k is at k / fps seconds (ffmpeg fps filter). No pixels are saved.
 *
 * Like the app, it runs in video mode (`staticImageMode: false`): after the
 * first face the next frame's region comes from the previous landmarks and
 * the detector is skipped. The detector is reset at every clip.
 *
 * Backend `tensorflow` (@tensorflow/tfjs-node, native) is the fast path;
 * `cpu` is the backend the image extractor used, kept for the parity check.
 * A stopped run resumes: clips whose .npy exists are skipped.
 */
import { spawn } from 'node:child_process';
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as TfCore from '@tensorflow/tfjs-core';
import type * as Fld from '@tensorflow-models/face-landmarks-detection';
import { keypointsToLandmarks } from '../../../../packages/load-sensor/src/core/landmarks/keypoints.js';
import { FACEMESH_ASSET_PATHS } from '../../../../packages/load-sensor/src/core/landmarks/tfjs-facemesh-provider.js';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../../../../packages/load-sensor/src/core/landmarks/types.js';
import { npyHeader } from '../../../../packages/load-sensor/scripts/extract-landmarks-lib.js';
import { registerTensorflowTransform } from './tfjs-node-transform.js';
import { FrameSplitter, listClips, type Clip } from './video-lib.js';

const SCRIPT = fileURLToPath(import.meta.url);
const WORK_ROOT = join(dirname(SCRIPT), '..', '..', '..', '..');
const VALUES_PER_FACE = LANDMARK_COUNT * LANDMARK_STRIDE;

interface Options {
  readonly root: string;
  readonly out: string;
  readonly fps: number;
  readonly backend: 'tensorflow' | 'cpu';
  readonly workers: number;
  readonly limit: number;
}

function parseArgs(argv: readonly string[]): Options {
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const backend = flag('backend') ?? 'tensorflow';
  if (backend !== 'tensorflow' && backend !== 'cpu') throw new Error(`unknown backend ${backend}`);
  const fps = Number(flag('fps') ?? 15);
  if (!(fps > 0 && fps <= 30)) throw new Error(`fps must be in (0, 30], got ${String(fps)}`);
  return {
    root: flag('root') ?? '/mnt/c/datasets/daisee/DAiSEE',
    out: flag('out') ?? '/mnt/c/datasets/landmarks/daisee',
    fps,
    backend,
    workers: Number(flag('workers') ?? Math.max(1, Math.min(12, availableParallelism() - 2))),
    limit: Number(flag('limit') ?? Infinity),
  };
}

interface ClipResult {
  readonly id: string;
  readonly split: string;
  readonly subject: string;
  readonly frames: number;
  readonly found: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly ms: number;
  readonly backend: string;
}

/** Width and height of the first video stream (ffprobe). */
async function probe(path: string): Promise<{ width: number; height: number }> {
  const text = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path,
  ]);
  const [w, h] = text.trim().split(',').map(Number);
  if (!(w && h)) throw new Error(`ffprobe gave no size for ${path}: ${text}`);
  return { width: w, height: h };
}

function run(cmd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${String(code)}: ${err}`))));
  });
}

/** Decoded frames of a clip, resampled to `fps`, as raw RGB. */
async function* frames(path: string, fps: number, width: number, height: number): AsyncGenerator<Uint8Array> {
  const ff = spawn('ffmpeg', [
    '-v', 'error', '-nostdin', '-i', path, '-an', '-sn', '-vf', `fps=${String(fps)}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d: Buffer) => (err += d.toString()));
  const closed = new Promise<number | null>((resolve) => ff.on('close', resolve));
  const splitter = new FrameSplitter(width, height);
  for await (const chunk of ff.stdout as AsyncIterable<Buffer>) {
    for (const f of splitter.push(chunk)) yield f;
  }
  const code = await closed;
  if (code !== 0) throw new Error(`ffmpeg exited ${String(code)} for ${path}: ${err}`);
  if (splitter.leftover !== 0) throw new Error(`ffmpeg left ${String(splitter.leftover)} stray bytes for ${path}`);
}

async function loadModel(backend: Options['backend']): Promise<{ tf: typeof TfCore; detector: Fld.FaceLandmarksDetector }> {
  const tf = await import('@tensorflow/tfjs-core');
  if (backend === 'tensorflow') {
    await import('@tensorflow/tfjs-node');
    await registerTensorflowTransform(tf);
  } else {
    await import('@tensorflow/tfjs-backend-cpu');
  }
  if (!(await tf.setBackend(backend))) throw new Error(`backend ${backend} did not initialise`);
  await tf.ready();
  const fld = await import('@tensorflow-models/face-landmarks-detection');
  const models = join(WORK_ROOT, 'packages', 'load-sensor', 'public', 'models');
  // Same settings as TfjsFaceMeshProvider, except where the model files come from.
  const detector = await fld.createDetector(fld.SupportedModels.MediaPipeFaceMesh, {
    runtime: 'tfjs',
    refineLandmarks: true,
    maxFaces: 1,
    detectorModelUrl: fileModel(tf, join(models, FACEMESH_ASSET_PATHS.detector)),
    landmarkModelUrl: fileModel(tf, join(models, FACEMESH_ASSET_PATHS.landmarks)),
  });
  return { tf, detector };
}

/** Reads a self-hosted TF.js graph model from disk (as scripts/tfjs-file-model.ts in the app). */
function fileModel(_tf: typeof TfCore, modelJsonPath: string): TfCore.io.IOHandler {
  return {
    async load() {
      const json = JSON.parse(await readFile(modelJsonPath, 'utf8')) as TfCore.io.ModelJSON;
      const weightSpecs: TfCore.io.WeightsManifestEntry[] = [];
      const buffers: Buffer[] = [];
      for (const group of json.weightsManifest) {
        weightSpecs.push(...group.weights);
        for (const p of group.paths) buffers.push(await readFile(join(dirname(modelJsonPath), p)));
      }
      const all = Buffer.concat(buffers);
      return { ...json, weightSpecs, weightData: all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) };
    },
  };
}

async function processClip(
  clip: Clip,
  opts: Options,
  tf: typeof TfCore,
  detector: Fld.FaceLandmarksDetector,
): Promise<ClipResult> {
  const started = performance.now();
  const { width, height } = await probe(clip.path);
  // A fresh clip: no tracking carried over from the previous one.
  detector.reset();
  const rows: Float32Array[] = [];
  let found = 0;
  for await (const frame of frames(clip.path, opts.fps, width, height)) {
    // int32 like the app's tf.browser.fromPixels.
    const pixels = tf.tensor3d(frame, [height, width, 3], 'int32');
    let lm: Float32Array | null = null;
    try {
      const faces = await detector.estimateFaces(pixels, { flipHorizontal: false, staticImageMode: false });
      if (faces[0]) lm = keypointsToLandmarks(faces[0].keypoints, width, height);
    } finally {
      pixels.dispose();
    }
    if (lm) found += 1;
    rows.push(lm ?? new Float32Array(VALUES_PER_FACE).fill(NaN));
  }
  if (rows.length === 0) throw new Error(`no frames decoded from ${clip.path}`);

  const dir = join(opts.out, clip.split);
  await mkdir(dir, { recursive: true });
  const result: ClipResult = {
    id: clip.id, split: clip.split, subject: clip.subject, frames: rows.length, found,
    fps: opts.fps, width, height, ms: Math.round(performance.now() - started), backend: opts.backend,
  };
  // The .json first, the .npy last via rename: a clip counts as done only when its .npy exists.
  await writeFile(join(dir, `${clip.id}.json`), `${JSON.stringify(result)}\n`);
  const body = new Uint8Array(rows.length * VALUES_PER_FACE * 4);
  rows.forEach((r, i) => body.set(new Uint8Array(r.buffer), i * VALUES_PER_FACE * 4));
  const tmp = join(dir, `${clip.id}.npy.tmp`);
  await writeFile(tmp, Buffer.concat([npyHeader([rows.length, LANDMARK_COUNT, LANDMARK_STRIDE]), body]));
  await rename(tmp, join(dir, `${clip.id}.npy`));
  return result;
}

async function runWorker(opts: Options, k: number, clipsFile: string): Promise<void> {
  // The parent lists the clips once: walking 9,068 folders over /mnt/c takes minutes.
  const all = JSON.parse(await readFile(clipsFile, 'utf8')) as Clip[];
  const clips = all.filter((c) => c.index % opts.workers === k);
  const { tf, detector } = await loadModel(opts.backend);
  for (const clip of clips) {
    if (existsSync(join(opts.out, clip.split, `${clip.id}.npy`))) {
      process.send?.({ k, skipped: true });
      continue;
    }
    const r = await processClip(clip, opts, tf, detector);
    process.send?.({ k, frames: r.frames, found: r.found, ms: r.ms, tensors: tf.memory().numTensors });
  }
  detector.dispose();
}

async function runParent(opts: Options): Promise<void> {
  const clips = (await listClips(opts.root)).filter((c) => c.index < opts.limit);
  console.log(`${String(clips.length)} clips, ${String(opts.fps)} fps, backend ${opts.backend}, ${String(opts.workers)} workers`);
  await mkdir(opts.out, { recursive: true });
  const clipsFile = join(opts.out, 'clips.json');
  await writeFile(clipsFile, JSON.stringify(clips));
  const started = performance.now();
  let done = 0;
  let skipped = 0;
  let frameCount = 0;
  let tensors = new Map<number, number>();
  const log = (): void => {
    const s = (performance.now() - started) / 1000;
    const rate = frameCount / s;
    const left = clips.length - done - skipped;
    const perClip = done > 0 ? s / done : NaN;
    console.log(
      `[${new Date().toLocaleTimeString()}] ${String(done)} done + ${String(skipped)} skipped / ${String(clips.length)} · ` +
        `${rate.toFixed(1)} frames/s · ETA ${((left * perClip) / 60).toFixed(0)} min · tensors ${[...tensors.values()].join(',')}`,
    );
  };
  const timer = setInterval(log, 30_000);
  const args = process.argv.slice(2);
  const codes = await Promise.all(
    Array.from({ length: opts.workers }, (_, k) => {
      const child = fork(SCRIPT, [...args, `--worker=${String(k)}`, `--clips=${clipsFile}`], {
        execArgv: process.execArgv,
      });
      child.on('message', (m: { k: number; skipped?: boolean; frames?: number; tensors?: number }) => {
        if (m.skipped) skipped += 1;
        else {
          done += 1;
          frameCount += m.frames ?? 0;
          if (m.tensors !== undefined) tensors = new Map(tensors).set(m.k, m.tensors);
        }
      });
      return new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
    }),
  );
  clearInterval(timer);
  log();
  if (codes.some((c) => c !== 0)) throw new Error(`worker exit codes ${codes.join(',')}; rerun to resume`);
  await writeIndex(opts, clips);
}

/** daisee.csv + daisee.summary.json from the per-clip .json files. */
async function writeIndex(opts: Options, clips: readonly Clip[]): Promise<void> {
  const rows: ClipResult[] = [];
  for (const c of clips) {
    rows.push(JSON.parse(await readFile(join(opts.out, c.split, `${c.id}.json`), 'utf8')) as ClipResult);
  }
  const header = 'index,id,split,subject,frames,found,fps,width,height,ms,backend';
  const lines = rows.map((r, i) =>
    [i, r.id, r.split, r.subject, r.frames, r.found, r.fps, r.width, r.height, r.ms, r.backend].join(','),
  );
  await writeFile(join(opts.out, 'daisee.csv'), `${header}\n${lines.join('\n')}\n`);
  const frames = rows.reduce((n, r) => n + r.frames, 0);
  const found = rows.reduce((n, r) => n + r.found, 0);
  const summary = {
    created: new Date().toISOString(),
    clips: rows.length,
    frames,
    frames_with_face: found,
    found_rate: frames ? found / frames : 0,
    fps: opts.fps,
    backends: [...new Set(rows.map((r) => r.backend))],
    model: 'tfjs MediaPipeFaceMesh, refineLandmarks, video mode, packages/load-sensor/public/models/facemesh (adapter A)',
    files_in_out: (await readdir(opts.out)).length,
  };
  await writeFile(join(opts.out, 'daisee.summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  const worker = argv.find((a) => a.startsWith('--worker='));
  const clipsFile = argv.find((a) => a.startsWith('--clips='))?.slice('--clips='.length);
  if (worker) {
    if (!clipsFile) throw new Error('--worker needs --clips');
    await runWorker(opts, Number(worker.slice('--worker='.length)), clipsFile);
  } else {
    await runParent(opts);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
