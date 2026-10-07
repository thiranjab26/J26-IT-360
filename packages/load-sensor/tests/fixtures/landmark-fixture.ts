/**
 * Loader for landmark fixtures recorded with the demo's dev-only Fixture
 * recorder (src/demo/fixture-recorder.ts). A fixture stores only the landmark
 * indices the features use, as numbers; this expands each frame back into a
 * full 478×3 array (other points zero) for the feature code.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANDMARK_COUNT } from '../../src/core/landmarks/types.js';

export interface LandmarkFixtureFile {
  readonly schema: 1;
  readonly kind: 'c2-landmark-fixture';
  readonly scenario: string;
  readonly notes: string;
  readonly aspect: number;
  readonly indices: readonly number[];
  readonly expected: { readonly blinks?: number };
  readonly frames: readonly { readonly t: number; readonly p: number[] | null }[];
}

export const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

export async function listRecordedFixtures(): Promise<string[]> {
  const names = await readdir(FIXTURE_DIR);
  return names.filter((n) => n.endsWith('.landmarks.json')).sort();
}

export async function loadFixture(name: string): Promise<LandmarkFixtureFile> {
  const parsed = JSON.parse(await readFile(join(FIXTURE_DIR, name), 'utf8')) as {
    kind?: unknown;
    schema?: unknown;
  };
  if (parsed.kind !== 'c2-landmark-fixture' || parsed.schema !== 1) {
    throw new Error(`${name} is not a c2 landmark fixture (schema 1)`);
  }
  return parsed as LandmarkFixtureFile;
}

/** Sparse [x, y, z per stored index] → full 478×3 array. */
export function expandFrame(indices: readonly number[], p: readonly number[]): Float32Array {
  const out = new Float32Array(LANDMARK_COUNT * 3);
  indices.forEach((index, k) => {
    out[index * 3] = p[k * 3] ?? 0;
    out[index * 3 + 1] = p[k * 3 + 1] ?? 0;
    out[index * 3 + 2] = p[k * 3 + 2] ?? 0;
  });
  return out;
}

/** Full array → sparse values for `indices`, rounded like the recorder (4 dp). */
export function compressFrame(indices: readonly number[], landmarks: Float32Array): number[] {
  return indices.flatMap((i) =>
    [0, 1, 2].map((k) => Math.round((landmarks[i * 3 + k] ?? 0) * 1e4) / 1e4),
  );
}
