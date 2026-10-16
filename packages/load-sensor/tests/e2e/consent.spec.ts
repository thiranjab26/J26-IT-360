import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { acceptConsent, turnSensingOn } from './helpers.js';

// Consent and control UI (TODO A6, CLAUDE.md invariant 4, FR7).

const modelsPresent = existsSync(
  fileURLToPath(new URL('../../public/models/facemesh/landmarks/model.json', import.meta.url)),
);

declare global {
  interface Window {
    __cameraRequests?: number;
  }
}

test.describe('consent and control (A6)', () => {
  test('no camera request before consent; declining leaves everything usable', async ({ page }) => {
    // Count every getUserMedia call the page makes.
    await page.addInitScript(() => {
      window.__cameraRequests = 0;
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => {
        window.__cameraRequests = (window.__cameraRequests ?? 0) + 1;
        return original(c);
      };
    });
    const cameraRequests = () => page.evaluate(() => window.__cameraRequests ?? 0);

    await page.goto('/');
    const dialog = page.getByTestId('consent-dialog');
    await expect(page.getByTestId('sensing-switch')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('camera-indicator')).toHaveText('Off');
    await expect(dialog).toBeHidden();

    // "Turn sensing on" shows the notice first; focus starts on its title.
    await page.getByTestId('enable').click();
    await expect(dialog).toBeVisible();
    await expect(page.locator('#consent-title')).toBeFocused();
    await expect(page.locator('#consent-title')).toHaveText('Before you turn on the camera');

    // Esc, "Not now" and the close button all decline.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByTestId('sensing-switch').click();
    await page.getByTestId('consent-decline').click();
    await expect(dialog).toBeHidden();
    await page.getByTestId('enable').click();
    await page.getByTestId('consent-close').click();
    await expect(dialog).toBeHidden();

    expect(await cameraRequests()).toBe(0);
    await expect(page.getByTestId('camera-status')).toHaveText('idle');
    await expect(page.getByTestId('sensing-switch')).toHaveAttribute('aria-checked', 'false');

    // The rest of the app works with sensing off, and the event stream says so.
    await page.getByTestId('tab-signals').click();
    await expect(page.locator('#panel-signals')).toBeVisible();
    await page.getByTestId('tab-performance').click();
    await expect(page.locator('#panel-performance')).toBeVisible();
    await expect(page.getByTestId('event-status')).toHaveText('disabled');
    await page.getByTestId('tab-break').click();
    await page.getByTestId('play-memory').click();
    await expect(page.getByTestId('mm-card')).toHaveCount(12);
    expect(await cameraRequests()).toBe(0);
  });

  test('agreeing turns the camera on; switch, indicator and calibration prompt follow', async ({
    page,
  }) => {
    test.skip(!modelsPresent, 'Face mesh assets missing: run `pnpm fetch-models` first.');
    test.setTimeout(90_000);
    await page.goto('/');
    const baseTitle = await page.title();

    await page.getByTestId('sensing-switch').click();
    await acceptConsent(page);
    await expect(page.getByTestId('camera-status')).toHaveText('active');
    await expect(page.getByTestId('sensing-switch')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('sensor-status')).toHaveText('Sensing is on.', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('camera-indicator')).toHaveText('On · live');
    await expect(page).toHaveTitle(`● Camera on · ${baseTitle}`);
    // The fake camera shows no face: the prompt asks the learner to move into view.
    await expect(page.getByTestId('calib-prompt')).toHaveAttribute('data-kind', 'find-face', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('calib-title')).toHaveText('Move into view');

    // The sidebar switch turns it off from any tab and releases the camera.
    await page.getByTestId('tab-signals').click();
    await page.getByTestId('sensing-switch').click();
    await expect(page.getByTestId('camera-status')).toHaveText('stopped');
    await expect(page.getByTestId('live-tracks')).toHaveText('0');
    await expect(page.getByTestId('camera-indicator')).toHaveText('Off');
    await expect(page).toHaveTitle(baseTitle);
  });

  test('the notice shows before every camera start; consent can be withdrawn', async ({ page }) => {
    await page.goto('/');
    await turnSensingOn(page);
    await expect(page.getByTestId('camera-status')).toHaveText('active');

    // Pause and resume do not ask again: the camera never stopped.
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('camera-status')).toHaveText('paused');
    await page.getByTestId('resume').click();
    await expect(page.getByTestId('camera-status')).toHaveText('active');
    await expect(page.getByTestId('consent-dialog')).toBeHidden();

    // Off, then on again: the notice comes back, in this visit and after a reload.
    await page.getByTestId('disable').click();
    await expect(page.getByTestId('camera-status')).toHaveText('stopped');
    await page.getByTestId('enable').click();
    await expect(page.getByTestId('consent-dialog')).toBeVisible();
    await page.getByTestId('consent-decline').click();
    await expect(page.getByTestId('camera-status')).toHaveText('stopped');
    await page.reload();
    await turnSensingOn(page);
    await expect(page.getByTestId('camera-status')).toHaveText('active');

    // Withdrawing turns the camera off at once.
    await page.getByTestId('review-consent').click();
    await expect(page.getByTestId('consent-stamp')).toContainText('Agreed on');
    await page.getByTestId('consent-withdraw').click();
    await expect(page.getByTestId('camera-status')).toHaveText('stopped');
    await expect(page.getByTestId('live-tracks')).toHaveText('0');
  });
});
