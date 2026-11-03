import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('PAGE ERROR', error));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, route => route.abort());
  await page.goto('/Underwater-world-model/');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#depthLegend')).toBeVisible();
  await page.waitForTimeout(800);
});

async function drawAoi(page, from = { x: 180, y: 180 }, to = { x: 430, y: 360 }) {
  await page.locator('#drawAoi').click();
  const canvas = page.locator('#map canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#aoiStatus')).not.toContainText('No AOI selected');
}

test('critical flow preserves land basemap, source-matches isobaths and auto-fits micro-AOI', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await expect(page.locator('#bathyMode')).toHaveValue('chart-relief');
  await expect(page.locator('#bathyMode option')).toHaveCount(4);
  await expect(page.locator('#bathyMode')).not.toContainText('Atlas');
  await expect(page.locator('#bathyMode')).not.toContainText('GEBCO');
  await expect(page.locator('#contourDensity')).toHaveValue('dense');
  await expect(page.locator('#depthLegend')).toContainText('Depth shading');
  await expect(page.locator('#downloadManifest')).toBeDisabled();

  const maxZoom = await page.evaluate(() => window.__MSO__.map.getMaxZoom());
  expect(maxZoom).toBe(22);
  await page.evaluate(() => window.__MSO__.map.setZoom(17));
  await page.waitForTimeout(250);

  const zoomBeforeAoi = await page.evaluate(() => window.__MSO__.map.getZoom());
  await drawAoi(page, { x: 150, y: 130 }, { x: 550, y: 530 });
  await expect(page.locator('#aoiScaleStatus')).toContainText('MICRO-AOI');
  await expect(page.locator('#aoiScaleStatus')).toContainText('auto-fit');
  await expect(page.locator('#fitAoi')).toBeEnabled();
  await expect(page.locator('#spatialAdequacy')).toContainText('UNRESOLVED');
  await expect(page.locator('#spatialAdequacy')).toContainText('COARSE');
  await page.waitForTimeout(650);
  const zoomAfterAoi = await page.evaluate(() => window.__MSO__.map.getZoom());
  expect(zoomAfterAoi).toBeGreaterThanOrEqual(zoomBeforeAoi);
  expect(zoomAfterAoi).toBeGreaterThan(16);

  await page.locator('#clearAoi').click();
  await expect(page.locator('#aoiStatus')).toContainText('No AOI selected');
  await expect(page.locator('#fitAoi')).toBeDisabled();

  await page.locator('#baseMap').selectOption('satellite');
  await page.locator('#bathyMode').selectOption('emodnet-multicolour');
  await expect(page.locator('#depthLegend')).toContainText('EMODnet depth');
  await expect(page.locator('#contourStatus')).toContainText(/EMODnet|Loading source-matched/);
  await page.locator('#contourDensity').selectOption('major');
  await page.locator('#contourDensity').selectOption('dense');
  await page.locator('#contours').uncheck();
  await page.locator('#contours').check();

  await page.evaluate(() => window.__MSO__.map.setZoom(17));
  await drawAoi(page, { x: 180, y: 150 }, { x: 560, y: 500 });
  await expect(page.locator('#bathyStatus')).toContainText(/Numeric bathymetry unavailable|REAL EMODnet/);

  await page.locator('#bathyMode').selectOption('chart-relief');
  await expect(page.locator('#contourStatus')).toContainText('Seascape');
  await expect(page.locator('#depthLegend')).toContainText('sea-only');

  await expect(page.locator('#envVariables input:checked')).toHaveCount(5);
  await page.locator('#analysisGridM').fill('20');
  await page.locator('#buildEnvRequest').click();
  await expect(page.locator('#envRequestStatus')).toContainText('SOURCE-RESOLVED');
  await expect(page.locator('#envRequestStatus')).toContainText('5 jobs');
  await expect(page.locator('#envRequestStatus')).toContainText('spatial:');
  await expect(page.locator('#downloadManifest')).toBeEnabled();
  await expect(page.locator('#downloadAoi')).toBeEnabled();
  await expect(page.locator('#downloadCopernicus')).toBeEnabled();
  await expect(page.locator('#openBathymetry')).toHaveAttribute('href', /ows\.emodnet-bathymetry\.eu\/wcs/);

  await page.locator('#envMaxDepth').fill('800');
  await expect(page.locator('#downloadManifest')).toBeDisabled();
  await expect(page.locator('#envRequestStatus')).toContainText('changed');
  await page.locator('#buildEnvRequest').click();
  await expect(page.locator('#envRequestStatus')).toContainText('SOURCE-RESOLVED');

  await page.locator('#optimize').click();
  await expect(page.locator('#results .result').first()).toBeVisible();
  await expect(page.locator('#results')).toContainText('Recommended');

  expect(errors).toEqual([]);
});
