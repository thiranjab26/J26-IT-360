import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Request } from '@playwright/test';
import { CAMERA_SOURCE } from './fake-camera.js';
import { turnSensingOn, waitForOfflineReady } from './helpers.js';

// TODO A7, NFR2, FR7, ARCHITECTURE.md §9 point 4: with the camera on and the
// sensor running, the browser makes zero network requests for 60 s. Every
// request of the whole session (initial load included) goes to this origin.
//
// Evidence: the session's HAR (URLs, timings and headers; bodies omitted) and a
// summary. Written to the test output folder on every run, and to
// docs/evidence/ when EVIDENCE=1 (`pnpm evidence`), so ordinary test runs do
// not rewrite committed files.

const modelsPresent = existsSync(
  fileURLToPath(new URL('../../public/models/facemesh/landmarks/model.json', import.meta.url)),
);

/** The window ARCHITECTURE.md §9 asks for. */
const SENSING_WINDOW_MS = 60_000;

const EVIDENCE_DIR = fileURLToPath(new URL('../../docs/evidence/', import.meta.url));
const writeEvidence = process.env.EVIDENCE === '1';

test.describe('no network traffic while sensing (NFR2)', () => {
  test.skip(!modelsPresent, 'Face mesh assets missing: run `pnpm fetch-models` first.');

  test(`zero requests during ${String(SENSING_WINDOW_MS / 1000)} s of sensing; HAR saved`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(SENSING_WINDOW_MS + 120_000);
    const harPath = writeEvidence
      ? `${EVIDENCE_DIR}nfr2-sensing-60s.har`
      : testInfo.outputPath('nfr2-sensing-60s.har');
    mkdirSync(dirname(harPath), { recursive: true });

    // A fresh context: empty cache, no service worker yet, so the HAR shows the
    // complete first visit followed by the silent sensing window. The fake
    // camera comes from the browser's launch args (playwright.config.ts).
    const context = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      permissions: ['camera'],
      recordHar: { path: harPath, content: 'omit', mode: 'full' },
    });
    const requests: { readonly at: number; readonly request: Request }[] = [];
    context.on('request', (request) => requests.push({ at: Date.now(), request }));

    const page = await context.newPage();
    await page.goto('/');
    // Initial asset load is over once the service worker finished precaching.
    await waitForOfflineReady(page);

    await turnSensingOn(page);
    await expect(page.getByTestId('sensor-status')).toHaveText('Sensing is on.', {
      timeout: 60_000,
    });
    await expect
      .poll(async () => Number(await page.getByTestId('camera-frames').textContent()), {
        timeout: 30_000,
      })
      .toBeGreaterThan(30);

    // ── The measured window: sensing on, frames flowing, model loaded. ──
    const windowStart = Date.now();
    const framesAtStart = Number(await page.getByTestId('camera-frames').textContent());
    await page.waitForTimeout(SENSING_WINDOW_MS);
    const windowEnd = Date.now();
    const framesAtEnd = Number(await page.getByTestId('camera-frames').textContent());
    const eventStatus = (await page.getByTestId('event-status').textContent()) ?? '';
    const backend = (await page.getByTestId('backend').textContent()) ?? '';

    const duringWindow = requests.filter((r) => r.at >= windowStart).map((r) => r.request.url());
    const origin = new URL(baseURL ?? '').origin;
    const foreign = requests
      .map((r) => r.request.url())
      .filter((u) => new URL(u).origin !== origin);

    await page.getByTestId('disable').click();
    await expect(page.getByTestId('live-tracks')).toHaveText('0');
    await context.close(); // writes the HAR

    const summary = {
      evidence: 'NFR2 / FR7: zero network requests while sensing',
      test: 'tests/e2e/privacy-network.spec.ts',
      recorded_at: new Date(windowEnd).toISOString(),
      browser: `${browser.browserType().name()} ${browser.version()}`,
      camera_source: CAMERA_SOURCE,
      backend,
      event_status_at_end: eventStatus,
      sensing_window_s: (windowEnd - windowStart) / 1000,
      frames_received_in_window: framesAtEnd - framesAtStart,
      requests_total_session: requests.length,
      requests_during_window: duringWindow.length,
      requests_to_other_origins: foreign.length,
      har: harPath.split(/[\\/]/).pop(),
    };
    const summaryPath = harPath.replace(/\.har$/, '.summary.json');
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    await testInfo.attach('summary', { path: summaryPath, contentType: 'application/json' });

    // Frames really flowed during the window (≈ 30 fps camera; at least 10 fps).
    expect(summary.frames_received_in_window).toBeGreaterThan((SENSING_WINDOW_MS / 1000) * 10);
    expect(duringWindow).toEqual([]);
    expect(foreign).toEqual([]);
  });
});
