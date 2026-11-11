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
  await openPanel(page, 'chart');
});

async function openPanel(page, id) {
  const tab = page.locator('#operatorTab-' + id);
  if ((await tab.getAttribute('aria-expanded')) !== 'true') await tab.click();
  await expect(page.locator('#operatorPanel-' + id)).toBeVisible();
}

async function drawAoi(page) {
  await page.locator('#quickDrawAoi').click();
  const canvas = page.locator('#map canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 170, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 430, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#aoiStatus')).not.toContainText('No AOI selected');
}

test('v0.28 does not manufacture AOI isobaths or overlay context when depths are constant', async ({ page }) => {
  await expect(page.locator('.header .badge').first()).toContainText('v0.28');
  await expect(page.locator('#bathyMode')).toHaveValue('aoi-adaptive');
  await expect(page.locator('#contours')).toBeChecked();
  await expect(page.locator('#contourCount')).toHaveValue('8');
  await expect(page.locator('#contourStatus')).toContainText('Definire AOI');

  await drawAoi(page);
  await expect(page.locator('#aoiDepthGridStatus')).toContainText('AOI REAL bathymetry');
  await page.waitForTimeout(1500);

  const summary = await page.evaluate(() => window.__MSO__.state.adaptiveContours);
  expect(summary == null || summary.feature_count === 0).toBe(true);
  const contextLayers = await page.evaluate(() => ({
    wfs: Boolean(window.__MSO__.map.getLayer('adaptive-contours-line')),
    wms: Boolean(window.__MSO__.map.getLayer('contours-fallback-layer')),
    marine: window.__MSO__.map.getLayer('bathymetry-fallback-layer')?.layout?.visibility ?? null
  }));
  expect(contextLayers.wfs).toBe(false);
  expect(contextLayers.wms).toBe(false);
  expect(contextLayers.marine).toBe('none');
  await expect(page.locator('#downloadAoiContours')).toBeDisabled();
});
