import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  BLOCK_EXTRA_ITEMS,
  TLX_ITEMS,
  checkSessionExport,
  type SessionExport,
} from '../../src/core/recorder/index.js';

// Pilot-study runner end to end (TODO B1): a whole session with 5 s blocks on
// the fake camera, then the exported file goes through the recorder self-check.
// The synthetic camera has no face, so every frame is recorded as "no face";
// that still proves the frames, block markers and answers reach the file.

const modelsPresent = existsSync(
  fileURLToPath(new URL('../../public/models/facemesh/landmarks/model.json', import.meta.url)),
);

test('B1: one full session exports a file that passes the self-check', async ({ page }) => {
  test.skip(!modelsPresent, 'face mesh models missing: run pnpm fetch-models');
  test.setTimeout(180_000);

  const origins = new Set<string>();
  page.on('request', (r) => origins.add(new URL(r.url()).origin));

  await page.goto('/study.html?seconds=5');
  await page.getByRole('combobox').selectOption('P02');
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Start session' }).click();

  await page.getByRole('button', { name: 'Turn camera on' }).click();
  const next = page.getByRole('button', { name: 'Continue to rest block' });
  await expect(next).toBeEnabled({ timeout: 60_000 });
  await next.click();

  // Rest, then four task blocks; a NASA-TLX form after each task block.
  for (let step = 0; step < 5; step += 1) {
    await page.getByRole('button', { name: /^Start / }).click();
    if (step === 0) continue;
    const continueButton = page.getByRole('button', { name: 'Continue' });
    await expect(continueButton).toBeVisible({ timeout: 15_000 });
    // An untouched slider is not an answer.
    await continueButton.click();
    await expect(page.getByText('Please answer every question')).toBeVisible();
    for (const item of [...TLX_ITEMS, ...BLOCK_EXTRA_ITEMS]) {
      await page.getByRole('slider', { name: item.label }).fill(String(10 * step + 20));
    }
    await continueButton.click();
  }

  for (let i = 0; i < 10; i += 1) {
    await page.locator(`input[name="sus-${String(i)}"][value="4"]`).check();
  }
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByText('Session finished')).toBeVisible({ timeout: 15_000 });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export session file' }).first().click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^c2-study-P02-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);
  const path = await file.path();
  const out = JSON.parse(readFileSync(path, 'utf8')) as SessionExport;

  expect(checkSessionExport(out)).toEqual([]);
  expect(out.participant).toBe('P02');
  expect(out.blocks.map((b) => b.kind)).toEqual(['rest', ...out.order]);
  expect(out.blocks.slice(1).every((b) => b.tlx !== null && b.extra !== null)).toBe(true);
  expect(out.sus?.score).toBe(50);
  expect(out.frames.length).toBeGreaterThan(20);
  expect(out.finishedAt).not.toBeNull();

  // Same-origin only (invariant 3): nothing went to any other host.
  expect([...origins]).toEqual(['http://localhost:4175']);
});
