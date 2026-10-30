/**
 * Python → TF.js parity check for an exported model (TODO C1 round trip, P5).
 *
 *   pnpm model-parity <model dir> <parity fixture json>
 *
 * Loads `<model dir>/model.json` as a TF.js graph model (the same loader the
 * app will use, @tensorflow/tfjs-converter), runs it on the fixture inputs
 * written by research/c2-load/training/export.py and exits 1 if any output
 * differs from the Keras output by more than the fixture's tolerance (1e-4).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import '@tensorflow/tfjs-backend-cpu';
import * as tf from '@tensorflow/tfjs-core';
import { loadGraphModel } from '@tensorflow/tfjs-converter';
import { fileModel } from './tfjs-file-model.js';

interface Fixture {
  readonly inputs: number[][];
  readonly outputs: number[][];
  readonly tolerance: number;
}

async function main(): Promise<void> {
  const [modelDir, fixturePath] = process.argv.slice(2);
  if (!modelDir || !fixturePath) throw new Error('usage: model-parity <model dir> <fixture json>');
  await tf.setBackend('cpu');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture;
  const model = await loadGraphModel(fileModel(join(modelDir, 'model.json')));

  const input = tf.tensor2d(fixture.inputs, undefined, 'float32');
  const output = model.predict(input) as tf.Tensor;
  const actual = (await output.array()) as number[][];
  tf.dispose([input, output]);
  model.dispose();

  let maxDiff = 0;
  fixture.outputs.forEach((row, i) => {
    row.forEach((expected, j) => {
      maxDiff = Math.max(maxDiff, Math.abs((actual[i]?.[j] ?? NaN) - expected));
    });
  });
  const ok = maxDiff <= fixture.tolerance;
  console.log(
    `${modelDir}: ${String(fixture.inputs.length)} rows, max |TF.js − Keras| = ${maxDiff.toExponential(2)} ` +
      `(tolerance ${fixture.tolerance.toExponential(0)}) → ${ok ? 'PASS' : 'FAIL'}`,
  );
  if (!ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
