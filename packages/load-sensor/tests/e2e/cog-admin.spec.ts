import { expect, test } from '@playwright/test';

// Cog admin panel (cog-admin.html): settings reach the sensor page in another tab,
// session commands work over the BroadcastChannel, and nothing leaves the origin.

test.describe('cog admin', () => {
  test('settings sync to the sensor page and the panel controls the session (FR7, NFR2)', async ({
    context,
    baseURL,
  }) => {
    const urls: string[] = [];
    context.on('request', (r) => urls.push(r.url()));

    const sensor = await context.newPage();
    await sensor.goto('/');
    const admin = await context.newPage();
    await admin.goto('/cog-admin.html');

    // Sensing is still off by default (invariant 4); the panel sees the page.
    await expect(admin.getByTestId('admin-connection')).toHaveText('Connected Â· sensing off');
    await expect(admin.getByTestId('admin-camera')).toHaveText('Off');

    // A setting changed in the panel reaches the sensor page without a reload.
    await admin.getByTestId('set-points').check({ force: true });
    await expect(sensor.getByTestId('toggle-points')).toBeChecked();
    await admin.getByTestId('set-alarm').uncheck({ force: true });
    await expect(sensor.getByTestId('toggle-alarm')).not.toBeChecked();

    // And back: the switch on the sensor page updates the panel.
    await sensor.getByTestId('toggle-alarm').check({ force: true });
    await expect(admin.getByTestId('set-alarm')).toBeChecked();

    // Sensing is turned on from the sensor page; the panel can pause and stop it.
    await sensor.getByTestId('enable').click();
    await expect(admin.getByTestId('admin-camera')).toHaveText(/Live|Starting/, {
      timeout: 60_000,
    });
    await expect(admin.getByTestId('admin-pause')).toBeEnabled({ timeout: 60_000 });
    await admin.getByTestId('admin-pause').click();
    await expect(sensor.getByTestId('camera-status')).toHaveText('paused');
    await admin.getByTestId('admin-resume').click();
    await expect(sensor.getByTestId('camera-status')).toHaveText('active');
    await admin.getByTestId('admin-stop').click();
    await expect(sensor.getByTestId('sensor-status')).toHaveText('Sensing is off.');

    // Same origin only: no request to any other host.
    const origin = new URL(baseURL ?? '').origin;
    expect(urls.filter((u) => !u.startsWith(origin) && !u.startsWith('data:'))).toEqual([]);
  });

  test('reset restores defaults', async ({ page }) => {
    await page.goto('/cog-admin.html');
    const fps = page.getByTestId('set-fps');
    await fps.fill('10');
    await expect(page.getByText('10 fps', { exact: true })).toBeVisible();
    await page.getByTestId('admin-reset-all').click();
    await expect(fps).toHaveValue('15');
    await expect(page.getByTestId('admin-keys')).toContainText('Nothing stored');
  });
});
