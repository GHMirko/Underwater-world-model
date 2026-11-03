import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Constant shallow water deliberately produces no local contour crossing.
  await page.route('https://rest.emodnet-bathymetry.eu/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ avg: 12.0 }) });
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173|rest\.emodnet-bathymetry\.eu).*/, route => route.abort());
  await page.goto('/Underwater-world-model/');
  await expect(page.locator('#map')).toBeVisible();
  await page.waitForTimeout(1200);
});

async function drawAoi(page) {
  await page.locator('#drawAoi').click();
  const canvas = page.locator('#map canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 170, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 430, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#aoiStatus')).not.toContainText('No AOI selected');
}

test('AOI adaptive mode keeps EMODnet context isobaths before AOI and when local crossing is unavailable', async ({ page }) => {
  await expect(page.locator('.header .badge').first()).toContainText('v0.16.1');
  await expect(page.locator('#bathyMode')).toHaveValue('aoi-adaptive');
  await expect(page.locator('#contours')).toBeChecked();
  await expect(page.locator('#contourStatus')).toContainText('CONTEXT ONLY');

  await drawAoi(page);
  await expect(page.locator('#aoiDepthGridStatus')).toContainText('AOI REAL bathymetry');
  await page.waitForTimeout(1800);

  // Local numeric field exists, but a constant field has no contour crossing.
  const summary = await page.evaluate(() => window.__MSO__.state.adaptiveContours);
  expect(summary == null || summary.feature_count === 0).toBe(true);

  // Best-available-information policy keeps context contours on rather than
  // leaving the operator with a blank isobath layer.
  await expect(page.locator('#contourStatus')).toContainText('CONTEXT ONLY');
  const contextLayerPresent = await page.evaluate(() => Boolean(
    window.__MSO__.map.getLayer('adaptive-contours-line') ||
    window.__MSO__.map.getLayer('contours-fallback-layer')
  ));
  expect(contextLayerPresent).toBe(true);
});
