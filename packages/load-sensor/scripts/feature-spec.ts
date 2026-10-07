/**
 *   pnpm feature-spec          # regenerate public/models/classifier/feature_spec.json
 *   pnpm feature-spec --check  # exit 1 if the committed file is out of date
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildFeatureSpec, SPEC_PATH } from './feature-spec-lib.js';

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const next = await buildFeatureSpec();
  const current = await readFile(SPEC_PATH, 'utf8').catch(() => '');

  if (check) {
    if (current.replace(/\r\n/g, '\n') !== next) {
      console.error('feature_spec.json is out of date: run `pnpm feature-spec` and commit it.');
      process.exitCode = 1;
    } else {
      console.log('feature_spec.json is up to date.');
    }
    return;
  }

  await mkdir(dirname(SPEC_PATH), { recursive: true });
  await writeFile(SPEC_PATH, next);
  const { code_hash: hash } = JSON.parse(next) as { code_hash: string };
  console.log(`wrote ${SPEC_PATH} (code_hash ${hash.slice(0, 12)}…)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
