import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import * as tf from '@tensorflow/tfjs-core';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { patchWasmIntBatchMatMul } from '../../../src/core/landmarks/wasm-int-matmul.js';

// Runs the real tfjs-backend-wasm in Node: the bug only shows on the real kernel.
beforeAll(async () => {
  const wasmEntry = createRequire(import.meta.url).resolve('@tensorflow/tfjs-backend-wasm');
  setWasmPaths(`${join(dirname(wasmEntry), '..', 'dist')}/`);
  expect(await tf.setBackend('wasm')).toBe(true);
  await tf.ready();
});

describe('patchWasmIntBatchMatMul (TODO A3 WASM fallback bug)', () => {
  it('the unpatched WASM kernel rejects int32, which is the bug', () => {
    const a = tf.tensor2d([1, 2, 3, 4], [2, 2], 'int32');
    expect(() => tf.matMul(a, a)).toThrow(/non-float32/);
    a.dispose();
  });

  it('multiplies int32 matrices exactly after the patch, without leaking tensors', async () => {
    patchWasmIntBatchMatMul(tf);
    patchWasmIntBatchMatMul(tf); // idempotent
    const before = tf.memory().numTensors;
    // Values like the model's pixel-index arithmetic, plus a negative one.
    const a = tf.tensor3d([191, 2, -3, 4, 5, 6], [1, 2, 3], 'int32');
    const b = tf.tensor3d([1, 0, 0, 1, 192, 7], [1, 3, 2], 'int32');
    const product = tf.matMul(a, b);
    expect(product.dtype).toBe('int32');
    // [191, 2, -3]·cols = [191 − 576, 2 − 21]; [4, 5, 6]·cols = [4 + 1152, 5 + 42].
    expect(await product.array()).toEqual([
      [
        [-385, -19],
        [1156, 47],
      ],
    ]);
    tf.dispose([a, b, product]);
    expect(tf.memory().numTensors).toBe(before);
  });

  it('leaves the float32 path unchanged', async () => {
    patchWasmIntBatchMatMul(tf);
    const a = tf.tensor2d([0.5, 1.5, -2, 3], [2, 2]);
    const product = tf.matMul(a, a);
    expect(product.dtype).toBe('float32');
    const values = (await product.array()) as number[][];
    expect(values[0]?.[0]).toBeCloseTo(-2.75);
    expect(values[1]?.[1]).toBeCloseTo(6);
    tf.dispose([a, product]);
  });
});
