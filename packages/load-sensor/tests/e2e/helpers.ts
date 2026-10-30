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

/**
 * Waits until the service worker has precached the whole app (Performance tab
 * read-out "Offline cache: Ready") and controls the page, so no install
 * downloads are still running and a reload can be served offline.
 */
export async function waitForOfflineReady(page: Page): Promise<void> {
  await expect(page.getByTestId('offline')).toHaveText('Ready', { timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

/** Agrees to the notice that some other control (sidebar switch, Break game) opened. */
export async function acceptConsent(page: Page): Promise<void> {
  const dialog = page.getByTestId('consent-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('consent-accept').click();
  // Closed, not "hidden": the dialog fades out over 0.26 s (styles.css), and
  // until the fade's end is processed it keeps its box (display: block,
  // opacity 0), which Playwright counts as visible. Agree starts the face model
  // load at once, which can block the main thread for seconds on a busy
  // machine, so toBeHidden() failed at random (30 Oct 2026, 2 of 4 runs under
  // full CPU load) although the dialog had closed and the camera was starting.
  await expect(dialog).not.toHaveAttribute('open');
  // ...and it closed as "agree", not as a decline (a click that missed the
  // button lands on the backdrop, which declines): the switch turns on as soon
  // as the camera starts. Longer timeout for the same busy-machine reason.
  await expect(page.getByTestId('sensing-switch')).toHaveAttribute('aria-checked', 'true', {
    timeout: 15_000,
  });
}
