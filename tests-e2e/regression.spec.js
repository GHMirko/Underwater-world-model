import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('PAGE ERROR', error));

  // Keep the browser regression deterministic: numeric EMODnet depth samples
  // are mocked with a repeatable shallow-water range, while every other
  // external service is blocked. This tests adaptive colouring without making
  // CI depend on third-party availability.
  let depthCounter = 0;
  await page.route('https://rest.emodnet-bathymetry.eu/**', route => {
    const depth = 3.4 + (depthCounter++ % 12) * 1.6;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ avg: depth }) });
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173|rest\.emodnet-bathymetry\.eu).*/, route => route.abort());

  await page.goto('/Underwater-world-model/');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#aoiDepthGridStatus')).toBeVisible();
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

test('critical flow keeps client land separate and uses AOI real adaptive bathymetry', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await expect(page.locator('.header .badge').first()).toContainText('v0.15 Adaptive Bathymetry');
  await expect(page.locator('#baseMap option')).toHaveCount(2);
  await expect(page.locator('#baseMap')).toContainText('Minimal');
  await expect(page.locator('#baseMap')).toContainText('Satellite');
  await expect(page.locator('#baseMap')).not.toContainText('Chart');
  await expect(page.locator('#baseMap')).not.toContainText('Terrain');
  await expect(page.locator('#baseMap')).toHaveValue('minimal');

  await expect(page.locator('#bathyMode')).toHaveValue('aoi-adaptive');
  await expect(page.locator('#bathyMode option')).toHaveCount(5);
  await expect(page.locator('#bathyMode')).toContainText('AOI REAL');
  await expect(page.locator('#bathyMode')).toContainText('context WMS');
  await expect(page.locator('#depthLegend')).toBeHidden();
  await expect(page.locator('#contours')).toBeDisabled();
  await expect(page.locator('#contourDensity')).toBeDisabled();
  await expect(page.locator('#aoiDepthGridStatus')).toContainText('define an AOI');
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
  await expect(page.locator('#bathySourceStatus')).toContainText('standard EMODnet DTM ~115 m fallback');
  await expect(page.locator('#bathyStatus')).toContainText('REAL EMODnet');
  await expect(page.locator('#aoiDepthGridStatus')).toContainText('AOI REAL bathymetry');
  await expect(page.locator('#aoiDepthGridStatus')).toContainText('adaptive');
  await expect(page.locator('#depthLegend')).toBeVisible();
  await expect(page.locator('#depthLegend')).toContainText('AOI REAL bathymetry');
  await expect(page.locator('#depthLegend')).toContainText('adaptive colour scale');
  await expect(page.locator('#depthLegend')).toContainText('AOI colour scale');

  const sourceStatus = await page.evaluate(() => window.__MSO__.state.bathymetrySource?.status);
  expect(sourceStatus).toBe('STANDARD_FALLBACK');
  await page.waitForTimeout(650);
  const zoomAfterAoi = await page.evaluate(() => window.__MSO__.map.getZoom());
  expect(zoomAfterAoi).toBeGreaterThanOrEqual(zoomBeforeAoi);
  expect(zoomAfterAoi).toBeGreaterThan(16);

  // In local adaptive mode there must be no WMS bathymetry raster covering land.
  const localLayerState = await page.evaluate(() => ({
    numeric: Boolean(window.__MSO__.map.getLayer('aoi-depth-grid-layer')),
    wms: Boolean(window.__MSO__.map.getLayer('bathymetry-layer')),
    visibility: window.__MSO__.map.getLayoutProperty('aoi-depth-grid-layer', 'visibility')
  }));
  expect(localLayerState.numeric).toBe(true);
  expect(localLayerState.wms).toBe(false);
  expect(localLayerState.visibility).toBe('visible');

  // Numeric sea-data layer must survive a land/background change.
  await page.locator('#baseMap').selectOption('satellite');
  await page.waitForTimeout(900);
  await expect(page.locator('#baseMap')).toHaveValue('satellite');
  const numericAfter = await page.evaluate(() => Boolean(window.__MSO__.map.getLayer('aoi-depth-grid-layer')));
  expect(numericAfter).toBe(true);
  await expect(page.locator('#depthLegend')).toContainText('AOI colour scale');

  // Context WMS is still available explicitly, but is no longer the local default.
  await page.locator('#bathyMode').selectOption('emodnet-rainbow');
  await page.waitForTimeout(500);
  await expect(page.locator('#depthLegend')).toContainText('context');
  await expect(page.locator('#contours')).toBeEnabled();
  await expect(page.locator('#contourDensity')).toBeEnabled();
  const contextState = await page.evaluate(() => ({
    wms: Boolean(window.__MSO__.map.getLayer('bathymetry-layer')),
    numericVisibility: window.__MSO__.map.getLayoutProperty('aoi-depth-grid-layer', 'visibility')
  }));
  expect(contextState.wms).toBe(true);
  expect(contextState.numericVisibility).toBe('none');

  await page.locator('#bathyMode').selectOption('aoi-adaptive');
  await page.waitForTimeout(300);
  await expect(page.locator('#depthLegend')).toContainText('AOI REAL bathymetry');
  const adaptiveAgain = await page.evaluate(() => ({
    wms: Boolean(window.__MSO__.map.getLayer('bathymetry-layer')),
    numericVisibility: window.__MSO__.map.getLayoutProperty('aoi-depth-grid-layer', 'visibility')
  }));
  expect(adaptiveAgain.wms).toBe(false);
  expect(adaptiveAgain.numericVisibility).toBe('visible');

  await expect(page.locator('#envVariables input:checked')).toHaveCount(5);
  await page.locator('#analysisGridM').fill('20');
  await page.locator('#buildEnvRequest').click();
  await expect(page.locator('#envRequestStatus')).toContainText('SOURCE-RESOLVED');
  await expect(page.locator('#envRequestStatus')).toContainText('5 jobs');
  await expect(page.locator('#envRequestStatus')).toContainText('HR bathy 0');
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

  await page.locator('#clearAoi').click();
  await expect(page.locator('#aoiStatus')).toContainText('No AOI selected');
  await expect(page.locator('#depthLegend')).toBeHidden();
  await expect(page.locator('#aoiDepthGridStatus')).toContainText('define an AOI');

  expect(errors).toEqual([]);
});
