/**
 * `pnpm evidence`: regenerates the NFR2 network evidence in docs/evidence/
 * (TODO A7, ARCHITECTURE.md §9 point 4). Runs tests/e2e/privacy-network.spec.ts
 * with EVIDENCE=1, so the HAR of a 60 s sensing session and its summary are
 * written to docs/evidence/ instead of the test output folder.
 *
 * A separate command so an ordinary `pnpm test:e2e` never rewrites committed
 * evidence files. (Setting the variable in the package.json script itself
 * would not work in both PowerShell and POSIX shells.)
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const result = spawnSync(
  process.execPath,
  [cli, 'test', 'tests/e2e/privacy-network.spec.ts', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, EVIDENCE: '1' } },
);
process.exit(result.status ?? 1);
