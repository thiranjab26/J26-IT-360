import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT, FEATURE_NAMES } from '../../../src/core/features/index.js';
import { buildFeatureSpec, SPEC_PATH } from '../../../scripts/feature-spec-lib.js';

describe('feature_spec.json (ARCHITECTURE.md §6, definition of done #3)', () => {
  it('is up to date with the feature code — run `pnpm feature-spec` if this fails', async () => {
    const committed = (await readFile(SPEC_PATH, 'utf8')).replace(/\r\n/g, '\n');
    expect(committed).toBe(await buildFeatureSpec());
  });

  it('lists the features in vector order with a code hash', async () => {
    const spec = JSON.parse(await buildFeatureSpec()) as {
      code_hash: string;
      feature_count: number;
      features: { index: number; name: string }[];
    };
    expect(spec.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(spec.feature_count).toBe(FEATURE_COUNT);
    expect(spec.features.map((f) => f.name)).toEqual(FEATURE_NAMES);
    expect(spec.features.map((f) => f.index)).toEqual(FEATURE_NAMES.map((_, i) => i));
  });
});
