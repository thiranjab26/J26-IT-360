import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Request } from '@playwright/test';

// Runs the real camera + TF.js face mesh pipeline in Chromium with the synthetic
// fake camera (playwright.config.ts). The fake camera shows a test pattern, not
// a face, so this proves the plumbing, backend choice and network behaviour;
// landmark quality is checked by hand on the debug overlay.

const modelsPresent = existsSync(
  fileURLToPath(new URL('../../public/models/facemesh/landmarks/model.json', import.meta.url)),
);

test.describe('camera and landmarks (FR1, FR7, NFR2)', () => {
  test.skip(!modelsPresent, 'Face mesh assets missing: run `pnpm fetch-models` first.');

  test('opt in → camera active → model on webgl/wasm → frames processed → off releases the camera', async ({
    page,
    baseURL,
  }) => {
    const requests: Request[] = [];
    page.on('request', (r) => requests.push(r));

    await page.goto('/');
    await expect(page.getByTestId('sensor-status')).toHaveText('Sensing is off.');
    await expect(page.getByTestId('live-tracks')).toHaveText('0');

    await page.getByTestId('enable').click();

    await expect(page.getByTestId('camera-status')).toHaveText('active');
    await expect(page.getByTestId('sensor-status')).toHaveText('Sensing is on.', {
      timeout: 60_000,
    });
    // Never the plain cpu backend (ARCHITECTURE.md §3).
    await expect(page.getByTestId('backend')).toHaveText(/^(webgl|wasm)$/);
    await expect(page.getByTestId('frame-clock')).toHaveText(
      /^(video-frame-callback|animation-frame)$/,
    );

    // Frames reach the provider and come back without errors.
    await expect
      .poll(async () => Number(await page.getByTestId('camera-frames').textContent()), {
        timeout: 30_000,
      })
      .toBeGreaterThan(30);
    await expect
      .poll(async () => (await page.getByTestId('frame-p50').textContent()) ?? '', {
        timeout: 30_000,
      })
      .toMatch(/ms$/);
    await expect(page.getByTestId('errors')).toHaveText('0');

    // A4: landmark samples reach the feature pipeline. The fake camera shows no
    // face, so presence must turn "Absent" after 2 s and calibration must not advance.
    await page.getByTestId('tab-signals').click();
    await expect(page.getByTestId('kpi-presence')).toBeVisible();
    await expect(page.getByTestId('kpi-presence')).toHaveText('Absent', { timeout: 30_000 });
    await expect(page.getByTestId('calibration')).toContainText('0 / 60 s');

    // On the Signals tab the camera is docked as a mini preview and keeps
    // delivering frames (a display:none video could stop its frame callbacks).
    await expect(page.getByTestId('dock-expand')).toBeVisible();
    const docked = Number(await page.getByTestId('camera-frames').textContent());
    await expect
      .poll(async () => Number(await page.getByTestId('camera-frames').textContent()))
      .toBeGreaterThan(docked + 10);
    await page.getByTestId('dock-expand').click();
    await expect(page.getByTestId('tab-camera')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('dock-expand')).toBeHidden();

    // FR7 / NFR2: everything the page loaded came from its own origin…
    const origin = new URL(baseURL ?? '').origin;
    const foreign = requests.map((r) => r.url()).filter((u) => new URL(u).origin !== origin);
    expect(foreign).toEqual([]);

    // …and while sensing runs, nothing is requested at all.
    const before = requests.length;
    await page.waitForTimeout(5_000);
    expect(requests.slice(before).map((r) => r.url())).toEqual([]);

    await page.getByTestId('disable').click();
    await expect(page.getByTestId('sensor-status')).toHaveText('Sensing is off.');
    await expect(page.getByTestId('camera-status')).toHaveText('stopped');
    // All tracks stopped: the camera LED goes off (checked by hand on real hardware).
    await expect(page.getByTestId('live-tracks')).toHaveText('0');
  });

  test('pause and resume stop and restart frame delivery', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('enable').click();
    await expect(page.getByTestId('camera-status')).toHaveText('active');

    await page.getByTestId('pause').click();
    await expect(page.getByTestId('camera-status')).toHaveText('paused');
    await expect(page.getByTestId('live-tracks')).toHaveText('1');
    const frozen = await page.getByTestId('camera-frames').textContent();
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId('camera-frames')).toHaveText(frozen ?? '');

    await page.getByTestId('resume').click();
    await expect(page.getByTestId('camera-status')).toHaveText('active');
    await expect
      .poll(async () => Number(await page.getByTestId('camera-frames').textContent()))
      .toBeGreaterThan(Number(frozen));
  });
});

test('camera permission denied is reported, not thrown (A2)', async ({ browser }) => {
  // A context without the camera permission and without the auto-accept flag
  // behaves like a user clicking "Block".
  const context = await browser.newContext({ permissions: [] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
    });
  });
  await page.goto('/');
  await page.getByTestId('enable').click();
  await expect(page.getByTestId('camera-status')).toHaveText('permission_denied');
  await expect(page.getByTestId('sensor-status')).toContainText('permission was denied');
  await expect(page.getByTestId('enable')).toBeEnabled();
  await context.close();
});
