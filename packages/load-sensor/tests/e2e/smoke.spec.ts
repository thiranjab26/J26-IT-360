import { expect, test } from '@playwright/test';

test('demo page loads with sensing off by default (CLAUDE.md invariant 4)', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('AdaptLearn C02 — Load sensor');
  await expect(page.getByTestId('sensor-status')).toHaveText('Sensing is off.');
});
