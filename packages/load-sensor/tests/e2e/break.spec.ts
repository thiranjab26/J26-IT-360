import { expect, test } from '@playwright/test';

test.describe('Break tab games', () => {
  test('memory match can be played to the end with no network requests', async ({ page }) => {
    await page.goto('/');
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));

    await page.getByTestId('tab-break').click();
    await page.getByTestId('play-memory').click();
    const cards = page.getByTestId('mm-card');
    await expect(cards).toHaveCount(12);

    // Pair cards by their (hidden) front icon, then flip each pair.
    const fronts = await cards.evaluateAll((nodes) =>
      nodes.map((n) => n.querySelector('.mm-front')?.innerHTML ?? ''),
    );
    const byFace = new Map<string, number[]>();
    fronts.forEach((f, i) => byFace.set(f, [...(byFace.get(f) ?? []), i]));
    expect(byFace.size).toBe(6);
    for (const [a, b] of byFace.values()) {
      await cards.nth(a ?? 0).click();
      await cards.nth(b ?? 0).click();
    }

    await expect(page.getByTestId('mm-pairs')).toHaveText('6 / 6');
    await expect(page.getByTestId('mm-moves')).toHaveText('6');
    await expect(page.getByTestId('mm-summary')).toBeVisible();
    // Fully offline game: icons, art and sounds are all generated in code.
    expect(requests).toEqual([]);
  });

  test('neck stretch asks for the camera when sensing is off', async ({ page }) => {
    await page.goto('/#break');
    await page.getByTestId('play-neck').click();
    await expect(page.getByTestId('ns-camera')).toBeVisible();
    await page.getByTestId('ns-camera').click();
    // Sensing starts from inside the game; the fake camera shows no face.
    await expect(page.getByTestId('sensor-status')).toHaveText('Sensing is on.', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('ns-instruction')).toHaveText(
      'Sit comfortably and look at the centre',
    );

    // The live preview sits in the coach panel's slot, not over the play area.
    const toggle = page.getByTestId('ns-camera-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#panel-camera')).toHaveAttribute('data-dock', 'slot');
    const slot = await page.getByTestId('ns-slot').boundingBox();
    const card = await page.locator('.camera-card').boundingBox();
    expect(Math.abs((slot?.x ?? 0) - (card?.x ?? -99))).toBeLessThan(2);
    expect(Math.abs((slot?.width ?? 0) - (card?.width ?? -99))).toBeLessThan(2);

    // The in-game switch turns the camera off again.
    await toggle.click();
    await expect(page.getByTestId('sensor-status')).toHaveText('Sensing is off.');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('ns-camera')).toBeVisible();
  });
});
