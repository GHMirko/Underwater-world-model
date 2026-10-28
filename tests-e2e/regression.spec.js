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

test('critical flow survives map/layer/data-request changes and external network failure', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await expect(page.locator('#bathyMode')).toHaveValue('chart-relief');
  await expect(page.locator('#contourDensity')).toHaveValue('dense');
  await expect(page.locator('#depthLegend')).toContainText('Depth shading');
  await expect(page.locator('#downloadManifest')).toBeDisabled();

  await drawAoi(page);
  await page.locator('#clearAoi').click();
  await expect(page.locator('#aoiStatus')).toContainText('No AOI selected');

  await page.locator('#baseMap').selectOption('satellite');
  await page.locator('#bathyMode').selectOption('emodnet-multicolour');
  await expect(page.locator('#depthLegend')).toContainText('EMODnet depth');
  await page.locator('#contourDensity').selectOption('major');
  await page.locator('#contourDensity').selectOption('dense');
  await page.locator('#contours').uncheck();
  await page.locator('#contours').check();

  await drawAoi(page, { x: 220, y: 220 }, { x: 500, y: 390 });
  await expect(page.locator('#bathyStatus')).toContainText(/Numeric bathymetry unavailable|REAL EMODnet/);

  await expect(page.locator('#envVariables input:checked')).toHaveCount(5);
  await page.locator('#buildEnvRequest').click();
  await expect(page.locator('#envRequestStatus')).toContainText('SOURCE-RESOLVED');
  await expect(page.locator('#envRequestStatus')).toContainText('5 jobs');
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
