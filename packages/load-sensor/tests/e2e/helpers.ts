import { expect, type Page } from '@playwright/test';

/**
 * Opts in the way a learner does (A6): press "Turn sensing on", read the
 * privacy notice, agree. A fresh browser context has no consent on record,
 * so the notice always shows the first time.
 */
export async function turnSensingOn(page: Page): Promise<void> {
  await page.getByTestId('enable').click();
  await acceptConsent(page);
}

/** Agrees to the notice that some other control (sidebar switch, Break game) opened. */
export async function acceptConsent(page: Page): Promise<void> {
  const dialog = page.getByTestId('consent-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('consent-accept').click();
  await expect(dialog).toBeHidden();
}
