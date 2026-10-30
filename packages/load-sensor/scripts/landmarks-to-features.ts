/**
 * Turns extracted dataset landmarks into model inputs (TODO P2), using the
 * app's own TypeScript feature code so Python never re-implements a feature
 * (CLAUDE.md "one source of truth"; ARCHITECTURE.md §6).
 *
 *   pnpm landmarks-to-features <dataset> [--dir=C:/datasets/landmarks]
 *
 * Reads `<dir>/<dataset>.npy` from `pnpm extract-landmarks` and writes, row for
 * row (NaN rows where no face was found or the mesh was degenerate):
 *
 *   <dataset>.signals.npy      [N, 13]   computeFrameSignals(): EAR, gaze, the
 *                                         geometric head pose (the P3 baseline),
 *                                         brow and mouth signals
 *   <dataset>.mesh_camera.npy  [N, 1434] meshInput(…, 'camera'): head-pose model input
 *   <dataset>.mesh_face.npy    [N, 1434] meshInput(…, 'face'): expression model input
 *   <dataset>.features.json    column names, shapes, feature_spec code_hash
 *
 * Every crop fed to the extractor is square, so the frame aspect is 1.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  computeFrameSignals,
  MESH_INPUT_LENGTH,
  meshInput,
  type FrameSignals,
} from '../src/core/features/index.js';
import { DATASETS, npyHeader, readNpyF32 } from './extract-landmarks-lib.js';
import { buildFeatureSpec } from './feature-spec-lib.js';

/** Column order of signals.npy. Keys of FrameSignals, fixed here so the order never depends on object layout. */
const SIGNAL_NAMES = [
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
] as const satisfies readonly (keyof FrameSignals)[];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dataset = argv.find((a) => !a.startsWith('--'));
  if (!dataset || !(DATASETS as readonly string[]).includes(dataset)) {
    throw new Error(`usage: landmarks-to-features <${DATASETS.join('|')}> [--dir=…]`);
  }
  const dir =
    argv.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) ?? 'C:/datasets/landmarks';

  const { shape, data } = readNpyF32(await readFile(join(dir, `${dataset}.npy`)));
  const [n = 0, points, stride] = shape;
  if (points !== 478 || stride !== 3)
    throw new Error(`expected [N, 478, 3], got [${shape.join(', ')}]`);

  const signals = new Float32Array(n * SIGNAL_NAMES.length).fill(NaN);
  const camera = new Float32Array(n * MESH_INPUT_LENGTH).fill(NaN);
  const face = new Float32Array(n * MESH_INPUT_LENGTH).fill(NaN);
  let ok = 0;
  for (let r = 0; r < n; r += 1) {
    const landmarks = data.subarray(r * MESH_INPUT_LENGTH, (r + 1) * MESH_INPUT_LENGTH);
    if (Number.isNaN(landmarks[0])) continue; // no face found by the extractor
    const mesh = { landmarks, aspect: 1 };
    const s = computeFrameSignals(mesh);
    const c = meshInput(mesh, 'camera');
    const f = meshInput(mesh, 'face');
    // All three or none, so every model is trained and tested on the same rows.
    if (!s || !c || !f) continue;
    SIGNAL_NAMES.forEach((name, k) => (signals[r * SIGNAL_NAMES.length + k] = s[name]));
    camera.set(c, r * MESH_INPUT_LENGTH);
    face.set(f, r * MESH_INPUT_LENGTH);
    ok += 1;
  }

  const write = (name: string, values: Float32Array, cols: number): Promise<void> =>
    writeFile(
      join(dir, `${dataset}.${name}.npy`),
      Buffer.concat([npyHeader([n, cols]), new Uint8Array(values.buffer)]),
    );
  await write('signals', signals, SIGNAL_NAMES.length);
  await write('mesh_camera', camera, MESH_INPUT_LENGTH);
  await write('mesh_face', face, MESH_INPUT_LENGTH);

  const spec = JSON.parse(await buildFeatureSpec()) as { code_hash: string };
  const meta = {
    dataset,
    created: new Date().toISOString(),
    rows: n,
    rows_with_features: ok,
    feature_code_hash: spec.code_hash,
    signals: {
      file: `${dataset}.signals.npy`,
      columns: SIGNAL_NAMES,
      units: 'see FrameSignals: IOD lengths, degrees, eye widths',
    },
    mesh_camera: { file: `${dataset}.mesh_camera.npy`, length: MESH_INPUT_LENGTH, frame: 'camera' },
    mesh_face: { file: `${dataset}.mesh_face.npy`, length: MESH_INPUT_LENGTH, frame: 'face' },
  };
  await writeFile(join(dir, `${dataset}.features.json`), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`${dataset}: ${String(ok)}/${String(n)} rows with features → ${dir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
