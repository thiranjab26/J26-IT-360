import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { CAMERA_SOURCE } from './fake-camera.js';

// TODO A7, NFR6, CLAUDE.md "Dispose tensors": over a long run of the real
// sensor (createLoadSensor() on bench.html: camera, TF.js face mesh, features,
// classifier, events), the number of live TF.js tensors does not grow.
//
// Default 120 s, which keeps the suite usable. A 30–60 minute soak (NFR6):
//   LONG_RUN_SECONDS=3600 pnpm test:e2e tests/e2e/long-run.spec.ts
//
// Readings are once a second, each taken between two inferences (no
// temporary tensors alive), so without a leak the count is exactly constant.
// Verified to fail when the provider stops disposing its input tensor
// (growth +128 in 30 s, 2026-10-16).

const modelsPresent = existsSync(
  fileURLToPath(new URL('../../public/models/facemesh/landmarks/model.json', import.meta.url)),
);

const SECONDS = Number(process.env.LONG_RUN_SECONDS ?? 120);

interface Report {
  run: { frames_processed: number; face_ratio: number | null };
  memory: {
    tensors_start: number | null;
    tensors_end: number | null;
    tensor_growth: number | null;
    js_heap_slope_mb_per_min: number | null;
    samples: { tS: number; tensors: number }[];
  };
  within_budget: { tensors_flat: boolean | null };
}

test.describe('long run: no tensor leak (NFR6)', () => {
  test.skip(!modelsPresent, 'Face mesh assets missing: run `pnpm fetch-models` first.');

  test(`live tensors stay flat over ${String(SECONDS)} s of sensing (${CAMERA_SOURCE})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout((SECONDS + 240) * 1000);
    await page.goto(`/bench.html?seconds=${String(SECONDS)}&warmup=10`);
    await page.getByTestId('bench-start').click();
    const status = page.getByTestId('bench-status');
    await expect(status).toHaveAttribute('data-state', /^(done|failed)$/, {
      timeout: (SECONDS + 200) * 1000,
    });
    expect(await status.getAttribute('data-state'), (await status.textContent()) ?? '').toBe(
      'done',
    );

    const report = JSON.parse(
      (await page.getByTestId('bench-report').textContent()) ?? 'null',
    ) as Report;
    await testInfo.attach('bench-report', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    // The pipeline really ran the whole time.
    expect(report.run.frames_processed).toBeGreaterThan(SECONDS);
    expect(report.memory.samples.length).toBeGreaterThanOrEqual(SECONDS - 1);

    const tensors = report.memory.samples.map((m) => m.tensors);
    expect(new Set(tensors).size, `tensor readings: ${tensors.join(' ')}`).toBe(1);
    expect(report.memory.tensor_growth).toBe(0);
    expect(report.within_budget.tensors_flat).toBe(true);
  });
});
