import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Request } from '@playwright/test';

// TODO A5: the sensor tab publishes LoadStateEvents on the same-origin
// BroadcastChannel and the mock consumer (another tab, importing only
// signals.ts) receives them. The fake camera shows a test pattern, not a face,
// so the honest stream is: disabled → starting → calibrating → no_face with
// presence "absent" and load_state null. That is exactly the null handling
// consumers must cope with (ARCHITECTURE.md §8).

const modelsPresent = existsSync(
  fileURLToPath(new URL('../../public/models/facemesh/landmarks/model.json', import.meta.url)),
);

test.describe('event stream to other components (FR6, NFR2, NFR8)', () => {
  test.skip(!modelsPresent, 'Face mesh assets missing: run `pnpm fetch-models` first.');

  test('mock consumer in another tab follows the sensor; nothing leaves the origin', async ({
    context,
    baseURL,
  }) => {
    const requests: Request[] = [];
    context.on('request', (r) => requests.push(r));

    const consumer = await context.newPage();
    await consumer.goto('/consumer.html');
    await expect(consumer.getByTestId('consumer-connection')).toHaveText('Waiting for a sensor…');

    const sensor = await context.newPage();
    await sensor.goto('/');
    // A sensor page that exists announces itself as "disabled" (sensing is opt-in).
    await expect(consumer.getByTestId('consumer-connection')).toContainText('Live');
    await expect(sensor.getByTestId('event-status')).toHaveText('disabled');
    await expect(consumer.getByTestId('consumer-load')).toHaveText('null');

    await sensor.getByTestId('enable').click();
    await expect(sensor.getByTestId('sensor-status')).toHaveText('Sensing is on.', {
      timeout: 60_000,
    });
    // No face in the fake camera: absent after 2 s, no load estimate.
    await expect(consumer.getByTestId('consumer-presence')).toHaveText('absent', {
      timeout: 30_000,
    });
    await expect(sensor.getByTestId('event-status')).toHaveText('no_face');
    await expect(consumer.getByTestId('consumer-load')).toHaveText('null');
    await expect(consumer.getByTestId('consumer-strain')).toHaveText(/^(Low|Medium|High)$/);
    await expect(sensor.getByTestId('load-model')).toHaveText('heuristic-0');

    // Heartbeats keep arriving while nothing changes (every 5 s).
    const count = Number(await consumer.getByTestId('consumer-log').getAttribute('data-count'));
    await expect
      .poll(
        async () => Number(await consumer.getByTestId('consumer-log').getAttribute('data-count')),
        { timeout: 12_000 },
      )
      .toBeGreaterThan(count);

    // The consumer's copy is a plain event: no landmarks or frames in it.
    const latest = JSON.parse(
      (await consumer.getByTestId('consumer-latest').textContent()) ?? 'null',
    ) as Record<string, unknown>;
    expect(latest.schema_version).toBe(1);
    expect(
      Object.values(latest).every((v) => v === null || typeof v !== 'object' || !Array.isArray(v)),
    ).toBe(true);

    await sensor.getByTestId('disable').click();
    await expect(consumer.getByTestId('consumer-presence')).toHaveText('null');
    await expect(sensor.getByTestId('event-status')).toHaveText('disabled');

    // Every request of both pages went to this origin only (invariant 1, NFR2).
    const origin = new URL(baseURL ?? '').origin;
    const foreign = requests
      .map((r) => r.url())
      .filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
    expect(foreign).toEqual([]);
  });
});
