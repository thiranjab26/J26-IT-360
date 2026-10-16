import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Request } from '@playwright/test';
import { FACE_CLIP } from './fake-camera.js';
import { turnSensingOn, waitForOfflineReady } from './helpers.js';

// TODO A7, ARCHITECTURE.md §10, CLAUDE.md invariant 3: load once online →
// go offline → reload → sensing still works. With the network gone, every
// page, chunk, model and WASM file must come from the service worker cache.
//
// Which status counts as "works": with a face clip (ADAPTLEARN_FAKE_VIDEO) the
// sensor must reach `active`, i.e. calibrated and classifying. The synthetic
// pattern has no face, so there the bar is the most the pipeline can honestly
// reach: model loaded on webgl/wasm, frames processed, `no_face`.

const modelsPresent = existsSync(
  fileURLToPath(new URL('../../public/models/facemesh/landmarks/model.json', import.meta.url)),
);

test.describe('offline after first load (invariant 3)', () => {
  test.skip(!modelsPresent, 'Face mesh assets missing: run `pnpm fetch-models` first.');

  test('online load → offline → reload → sensing runs from the cache', async ({
    context,
    page,
  }) => {
    test.setTimeout(FACE_CLIP ? 180_000 : 90_000);

    // First visit, online: the service worker installs and precaches everything.
    await page.goto('/');
    await waitForOfflineReady(page);

    await context.setOffline(true);
    const failed: string[] = [];
    const network: Request[] = [];
    context.on('requestfailed', (r) => failed.push(`${r.url()} (${r.failure()?.errorText ?? ''})`));
    context.on('request', (r) => {
      network.push(r);
    });

    // Prove the network really is gone, so a pass below cannot be a false one.
    const probe = await page.evaluate(async () => {
      try {
        await fetch(`/offline-probe-${String(Date.now())}`, { cache: 'no-store' });
        return 'reachable';
      } catch {
        return 'unreachable';
      }
    });
    expect(probe).toBe('unreachable');
    failed.length = 0;
    network.length = 0;

    const response = await page.reload();
    expect(response?.fromServiceWorker(), 'page must come from the service worker').toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'AdaptLearn C02 — Load sensor',
    );

    await turnSensingOn(page);
    await expect(page.getByTestId('sensor-status')).toHaveText('Sensing is on.', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('backend')).toHaveText(/^(webgl|wasm)$/);
    await expect
      .poll(async () => Number(await page.getByTestId('camera-frames').textContent()), {
        timeout: 30_000,
      })
      .toBeGreaterThan(30);
    await expect(page.getByTestId('errors')).toHaveText('0');

    if (FACE_CLIP) {
      // Baseline (30 s) with a face in view, then live estimates.
      await expect(page.getByTestId('event-status')).toHaveText('active', { timeout: 120_000 });
    } else {
      await expect(page.getByTestId('event-status')).toHaveText('no_face', { timeout: 30_000 });
    }

    // Every request after going offline was answered by the service worker.
    const notFromCache = (
      await Promise.all(
        network.map(async (r) => ((await r.response())?.fromServiceWorker() ? null : r.url())),
      )
    ).filter((u): u is string => u !== null);
    expect(notFromCache).toEqual([]);
    expect(failed).toEqual([]);

    // The other two pages are cached too.
    for (const path of ['/consumer.html', '/cog-admin.html']) {
      const r = await page.goto(path);
      expect(r?.fromServiceWorker(), path).toBe(true);
      expect(r?.status(), path).toBe(200);
    }
  });
});
