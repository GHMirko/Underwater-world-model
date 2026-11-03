import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('PAGE ERROR', error));

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

test('critical flow derives confidence-aware adaptive isobaths from AOI numeric bathymetry', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await expect(page.locator('.header .badge').first()).toContainText('v0.16 Confidence-Aware Contours');
  await expect(page.locator('#baseMap option')).toHaveCount(2);
  await expect(page.locator('#baseMap')).toContainText('Minimal');
  await expect(page.locator('#baseMap')).toContainText('Satellite');
  await expect(page.locator('#baseMap')).toHaveValue('minimal');

  await expect(page.locator('#bathyMode')).toHaveValue('aoi-adaptive');
  await expect(page.locator('#depthLegend')).toBeHidden();
  await expect(page.locator('#contours')).toBeEnabled();
  await expect(page.locator('#contourDensity')).toBeEnabled();
  await expect(page.locator('#contourStatus')).toContainText('waiting');

  await page.evaluate(() => window.__MSO__.map.setZoom(17));
  await page.waitForTimeout(250);
  const zoomBeforeAoi = await page.evaluate(() => window.__MSO__.map.getZoom());
  await drawAoi(page, { x: 150, y: 130 }, { x: 550, y: 530 });

  await expect(page.locator('#aoiScaleStatus')).toContainText('MICRO-AOI');
  await expect(page.locator('#fitAoi')).toBeEnabled();
  await expect(page.locator('#bathyStatus')).toContainText('REAL EMODnet');
  await expect(page.locator('#aoiDepthGridStatus')).toContainText('confidence');
  await expect(page.locator('#depthLegend')).toBeVisible();
  await expect(page.locator('#depthLegend')).toContainText('AOI REAL bathymetry');
  await expect(page.locator('#contourStatus')).toContainText('Adaptive isobaths');
  await expect(page.locator('#contourStatus')).toContainText('confidence');

  const wm = await page.evaluate(() => ({
    quality: window.__MSO__.state.bathymetryQuality,
    summary: window.__MSO__.state.adaptiveContours,
    contourCount: window.__MSO__.getLocalContours().features.length,
    firstContour: window.__MSO__.getLocalContours().features[0]?.properties ?? null,
    numeric: Boolean(window.__MSO__.map.getLayer('aoi-depth-grid-layer')),
    contours: Boolean(window.__MSO__.map.getLayer('aoi-derived-contours-layer')),
    contourVisibility: window.__MSO__.map.getLayoutProperty('aoi-derived-contours-layer', 'visibility'),
    wms: Boolean(window.__MSO__.map.getLayer('bathymetry-layer'))
  }));
  expect(wm.quality).toBeTruthy();
  expect(['HIGH', 'MEDIUM', 'LOW', 'VERY_LOW']).toContain(wm.quality.confidence);
  expect(wm.summary).toBeTruthy();
  expect(wm.summary.interval_m).toBeGreaterThan(0);
  expect(wm.contourCount).toBeGreaterThan(0);
  expect(wm.firstContour.layer_class).toBe('DERIVED');
  expect(wm.firstContour.derivation).toBe('MARCHING_SQUARES_NUMERIC_GRID');
  expect(wm.numeric).toBe(true);
  expect(wm.contours).toBe(true);
  expect(wm.contourVisibility).toBe('visible');
  expect(wm.wms).toBe(false);

  const zoomAfterAoi = await page.evaluate(() => window.__MSO__.map.getZoom());
  expect(zoomAfterAoi).toBeGreaterThanOrEqual(zoomBeforeAoi);
  expect(zoomAfterAoi).toBeGreaterThan(16);

  await page.locator('#contourDensity').selectOption('major');
  await page.waitForTimeout(150);
  const majorFilter = await page.evaluate(() => window.__MSO__.map.getFilter('aoi-derived-contours-layer'));
  expect(majorFilter).toBeTruthy();
  await page.locator('#contourDensity').selectOption('dense');

  await page.locator('#contours').uncheck();
  await expect(page.locator('#contourStatus')).toContainText('off');
  const hidden = await page.evaluate(() => window.__MSO__.map.getLayoutProperty('aoi-derived-contours-layer', 'visibility'));
  expect(hidden).toBe('none');
  await page.locator('#contours').check();
  await expect(page.locator('#contourStatus')).toContainText('Adaptive isobaths');

  await page.locator('#baseMap').selectOption('satellite');
  await page.waitForTimeout(900);
  await expect(page.locator('#baseMap')).toHaveValue('satellite');
  const afterBasemap = await page.evaluate(() => ({
    numeric: Boolean(window.__MSO__.map.getLayer('aoi-depth-grid-layer')),
    contours: Boolean(window.__MSO__.map.getLayer('aoi-derived-contours-layer')),
    contourVisibility: window.__MSO__.map.getLayoutProperty('aoi-derived-contours-layer', 'visibility')
  }));
  expect(afterBasemap.numeric).toBe(true);
  expect(afterBasemap.contours).toBe(true);
  expect(afterBasemap.contourVisibility).toBe('visible');
  await expect(page.locator('#depthLegend')).toContainText('AOI colour scale');

  await page.locator('#bathyMode').selectOption('emodnet-rainbow');
  await page.waitForTimeout(500);
  await expect(page.locator('#depthLegend')).toContainText('context');
  const contextState = await page.evaluate(() => ({
    wms: Boolean(window.__MSO__.map.getLayer('bathymetry-layer')),
    numericVisibility: window.__MSO__.map.getLayoutProperty('aoi-depth-grid-layer', 'visibility'),
    localContourVisibility: window.__MSO__.map.getLayoutProperty('aoi-derived-contours-layer', 'visibility')
  }));
  expect(contextState.wms).toBe(true);
  expect(contextState.numericVisibility).toBe('none');
  expect(contextState.localContourVisibility).toBe('none');

  await page.locator('#bathyMode').selectOption('aoi-adaptive');
  await page.waitForTimeout(300);
  await expect(page.locator('#depthLegend')).toContainText('AOI REAL bathymetry');
  await expect(page.locator('#contourStatus')).toContainText('Adaptive isobaths');

  await expect(page.locator('#envVariables input:checked')).toHaveCount(5);
  await page.locator('#analysisGridM').fill('20');
  await page.locator('#buildEnvRequest').click();
  await expect(page.locator('#envRequestStatus')).toContainText('SOURCE-RESOLVED');
  await expect(page.locator('#downloadManifest')).toBeEnabled();

  await page.locator('#optimize').click();
  await expect(page.locator('#results .result').first()).toBeVisible();
  await expect(page.locator('#results')).toContainText('Recommended');

  await page.locator('#clearAoi').click();
  await expect(page.locator('#aoiStatus')).toContainText('No AOI selected');
  await expect(page.locator('#depthLegend')).toBeHidden();
  await expect(page.locator('#contourStatus')).toContainText('waiting');

  expect(errors).toEqual([]);
});
