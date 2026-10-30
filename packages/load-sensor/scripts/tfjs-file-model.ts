/**
 * Loads a TF.js model (model.json + weight shards) from disk for Node scripts.
 * The libraries' own loaders expect a URL; in the browser the app serves the
 * same files same-origin (invariant 3).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type * as tf from '@tensorflow/tfjs-core';

export function fileModel(modelJsonPath: string): tf.io.IOHandler {
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
      // Spread keeps `signature` and `userDefinedMetadata`: graph models map
      // their output names through the signature.
      return {
        ...json,
        weightSpecs,
        weightData: all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength),
      };
    },
  };
}
