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
  await page.waitForTimeout(800);
  await openPanel(page, 'chart');
  await expect(page.locator('#aoiDepthGridStatus')).toHaveCount(1); // status may belong to another closed operator context
});

async function openPanel(page, id) {
  const tab = page.locator('#operatorTab-' + id);
  if ((await tab.getAttribute('aria-expanded')) !== 'true') await tab.click();
  await expect(page.locator('#operatorPanel-' + id)).toBeVisible();
}

async function drawAoi(page, from = { x: 180, y: 180 }, to = { x: 430, y: 360 }) {
  await page.locator('#quickDrawAoi').click();
  const canvas = page.locator('#map canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#aoiStatus')).not.toContainText('No AOI selected');
}

test('critical flow keeps numeric grids as debug while preserving confidence-aware contours and extraction contracts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await expect(page.locator('.header .badge').first()).toContainText('v0.30');
  await expect(page.locator('#baseMap option')).toHaveCount(2);
  await expect(page.locator('#baseMap')).toContainText('Minimal');
  await expect(page.locator('#baseMap')).toContainText('Satellite');
  await expect(page.locator('#baseMap')).toHaveValue('minimal');

  await expect(page.locator('#bathyMode')).toHaveValue('aoi-adaptive');
  await expect(page.locator('#depthLegend')).toBeHidden();
  await expect(page.locator('#contours')).toBeEnabled();
  await expect(page.locator('#contourDensity')).toBeEnabled();
  await expect(page.locator('#debugBathymetryGrid')).not.toBeChecked();
  await expect(page.locator('#contourStatus')).toContainText(/isobat|AOI/i);

  await page.evaluate(() => window.__MSO__.map.setZoom(17));
  await page.waitForTimeout(250);
  const zoomBeforeAoi = await page.evaluate(() => window.__MSO__.map.getZoom());
  await drawAoi(page, { x: 150, y: 130 }, { x: 550, y: 530 });

  await expect(page.locator('#aoiScaleStatus')).toContainText('MICRO-AOI');
  await expect(page.locator('#bathyBrokerStatus')).toContainText('BEST AVAILABLE PLAN');
  await expect(page.locator('#bathyBrokerStatus')).toContainText('baseline EMODNET_STANDARD_DTM');
  await expect(page.locator('#downloadBathyPlan')).toBeEnabled();
  await expect(page.locator('#bathyBrokerCandidates .source-candidate')).toHaveCount(7);
  await expect(page.locator('#fitAoi')).toBeEnabled();
  await expect(page.locator('#bathyStatus')).toContainText('REAL EMODnet');
  await expect(page.locator('#aoiDepthGridStatus')).toContainText('confidence');
  // Visual overzoom must not hide the depth legend.
  await expect(page.locator('#depthLegend')).toBeVisible();
  await expect(page.locator('#depthLegend')).toContainText('AOI REAL bathymetry');
  await expect(page.locator('#contourStatus')).toContainText(/isobat/i);
  await expect(page.locator('#contourStatus')).toContainText(/confiden|confidence/i);

  await expect.poll(async () => page.evaluate(() =>
    window.__MSO__.map.getLayer('aoi-derived-contours-layer')
      ? window.__MSO__.map.getLayoutProperty('aoi-derived-contours-layer', 'visibility')
      : 'missing'
  ), { timeout: 10000 }).toBe('visible');

  const wm = await page.evaluate(() => ({
    quality: window.__MSO__.state.bathymetryQuality,
    summary: window.__MSO__.state.adaptiveContours,
    contourCount: window.__MSO__.getLocalContours().features.length,
    firstContour: window.__MSO__.getLocalContours().features[0]?.properties ?? null,
    numeric: Boolean(window.__MSO__.map.getLayer('aoi-depth-grid-layer')),
    numericVisibility: window.__MSO__.map.getLayoutProperty('aoi-depth-grid-layer', 'visibility'),
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
  expect(wm.numericVisibility).toBe('none');
  expect(wm.contours).toBe(true);
  expect(wm.contourVisibility).toBe('visible');
  expect(wm.wms).toBe(false);

  await page.locator('#debugBathymetryGrid').check();
  await page.waitForTimeout(120);
  const debugVisible = await page.evaluate(() => window.__MSO__.map.getLayoutProperty('aoi-depth-grid-layer', 'visibility'));
  expect(debugVisible).toBe('visible');
  await page.locator('#debugBathymetryGrid').uncheck();
  await page.waitForTimeout(120);
  const debugHidden = await page.evaluate(() => window.__MSO__.map.getLayoutProperty('aoi-depth-grid-layer', 'visibility'));
  expect(debugHidden).toBe('none');

  const zoomAfterAoi = await page.evaluate(() => window.__MSO__.map.getZoom());
  expect(zoomAfterAoi).toBeGreaterThanOrEqual(zoomBeforeAoi);
  expect(zoomAfterAoi).toBeGreaterThan(16);

  await page.locator('#contourDensity').selectOption('major');
  await page.waitForTimeout(150);
  const majorFilter = await page.evaluate(() => window.__MSO__.map.getFilter('aoi-derived-contours-layer'));
  expect(majorFilter).toBeTruthy();
  await page.locator('#contourDensity').selectOption('dense');

  await page.locator('#contours').uncheck();
  await expect(page.locator('#contourStatus')).toContainText(/disattivat|off/i);
  const hidden = await page.evaluate(() => window.__MSO__.map.getLayoutProperty('aoi-derived-contours-layer', 'visibility'));
  expect(hidden).toBe('none');
  await page.locator('#contours').check();
  await expect(page.locator('#contourStatus')).toContainText(/isobat/i);

  await page.locator('#baseMap').selectOption('satellite');
  await page.waitForTimeout(900);
  await expect(page.locator('#baseMap')).toHaveValue('satellite');
  const afterBasemap = await page.evaluate(() => ({
    numeric: Boolean(window.__MSO__.map.getLayer('aoi-depth-grid-layer')),
    numericVisibility: window.__MSO__.map.getLayoutProperty('aoi-depth-grid-layer', 'visibility'),
    contours: Boolean(window.__MSO__.map.getLayer('aoi-derived-contours-layer')),
    contourVisibility: window.__MSO__.map.getLayoutProperty('aoi-derived-contours-layer', 'visibility')
  }));
  expect(afterBasemap.numeric).toBe(true);
  expect(afterBasemap.numericVisibility).toBe('none');
  expect(afterBasemap.contours).toBe(true);
  expect(afterBasemap.contourVisibility).toBe('visible');
  await expect(page.locator('#depthLegend')).toContainText('Intervallo profondità AOI');

  await page.locator('#bathyMode').selectOption('emodnet-rainbow');
  await page.waitForTimeout(500);
  await expect(page.locator('#depthLegend')).toContainText('AOI REAL bathymetry');
  const contextState = await page.evaluate(() => ({
    wms: Boolean(window.__MSO__.map.getLayer('bathymetry-layer')),
    numericVisibility: window.__MSO__.map.getLayoutProperty('aoi-depth-grid-layer', 'visibility'),
    localContourVisibility: window.__MSO__.map.getLayoutProperty('aoi-derived-contours-layer', 'visibility')
  }));
  expect(contextState.wms).toBe(true);
  expect(await page.evaluate(() => window.__MSO__.map.getLayoutProperty('bathymetry-layer','visibility'))).toBe('none');
  expect(contextState.numericVisibility).toBe('none');
  expect(contextState.localContourVisibility).toBe('visible');

  await page.locator('#bathyMode').selectOption('aoi-adaptive');
  await page.waitForTimeout(300);
  await expect(page.locator('#depthLegend')).toContainText('AOI REAL bathymetry');
  await expect(page.locator('#contourStatus')).toContainText(/isobat/i);

  await expect(page.locator('#envVariables input:checked')).toHaveCount(5);
  await openPanel(page, 'data');
  await page.locator('#analysisGridM').fill('20');
  await page.locator('#buildEnvRequest').click();
  await expect(page.locator('#envRequestStatus')).toContainText('SOURCE-RESOLVED');
  await expect(page.locator('#downloadManifest')).toBeEnabled();
  await expect(page.locator('#downloadWorldModel')).toBeEnabled();

  await openPanel(page, 'assets');
  await page.locator('#optimize').click();
  await expect(page.locator('#results .result').first()).toBeVisible();
  await expect(page.locator('#results')).toContainText('Recommended');

  await page.locator('#quickClearAoi').click();
  await expect(page.locator('#aoiStatus')).toContainText('No AOI selected');
  await expect(page.locator('#depthLegend')).toBeHidden();
  await expect(page.locator('#contourStatus')).toContainText(/isobat|AOI/i);

  expect(errors).toEqual([]);
});


test('v0.23 keeps isobaths and bathymetry available under visual overzoom, with a clear warning', async ({ page }) => {
  await page.evaluate(() => window.__MSO__.map.setZoom(17));
  await drawAoi(page, { x: 150, y: 130 }, { x: 550, y: 530 });
  await expect(page.locator('#bathymetryDetailLimit')).toBeVisible();
  await expect(page.locator('#bathymetryDetailLimit')).toContainText('Sovrascala batimetrica');
  const state = await page.evaluate(() => {
    const map = window.__MSO__.map;
    return {
      geographicZoom: map.getZoom(),
      derivedContourMaxZoom: map.getLayer('aoi-derived-contours-layer')?.maxzoom ?? null,
      bodyLimited: document.body.classList.contains('bathymetry-coarse-view'),
      aoiSelected: Boolean(window.__MSO__.state.aoi)
    };
  });
  expect(state.geographicZoom).toBeGreaterThan(16);
  expect(state.derivedContourMaxZoom ?? 24).toBeGreaterThan(state.geographicZoom);
  expect(state.bodyLimited).toBe(true);
  expect(state.aoiSelected).toBe(true);
  await page.evaluate(() => window.__MSO__.map.setZoom(10));
  await expect(page.locator('body')).not.toHaveClass(/bathymetry-coarse-view/);
});


test('v0.21 land style switch preserves the marine stack, AOI and numeric data', async ({ page }) => {
  await page.locator('#bathyMode').selectOption('emodnet-rainbow');
  await expect.poll(async () => page.evaluate(() =>
    Boolean(window.__MSO__.map.getLayer('bathymetry-layer'))
  ), { timeout: 10000 }).toBe(true);
  const before = await page.evaluate(() => {
    const { map, state } = window.__MSO__;
    window.__landSeaProbe = {
      styleLoads: 0,
      marineSource: map.getSource('bathymetry-source'),
      seaMaskSource: map.getSource('sea-coastline-vectors'),
      bathyLayer: map.getLayer('bathymetry-layer'),
      marineMode: state.bathyMode,
      marineOpacity: map.getPaintProperty('bathymetry-layer', 'raster-opacity'),
      geography: [map.getCenter().lng, map.getCenter().lat, map.getZoom()],
      onStyleLoad: () => window.__landSeaProbe.styleLoads++
    };
    map.on('style.load', window.__landSeaProbe.onStyleLoad);
    return {
      seaMask: Boolean(window.__landSeaProbe.seaMaskSource),
      landMinimal: map.getLayoutProperty('land-basemap-minimal', 'visibility'),
      landSatellite: map.getLayoutProperty('land-basemap-satellite', 'visibility')
    };
  });
  expect(before.seaMask).toBe(true);
  expect(before.landMinimal).toBe('visible');
  expect(before.landSatellite).toBe('none');

  await page.locator('#baseMap').selectOption('satellite');
  await expect.poll(async () => page.evaluate(() => window.__MSO__.map.getLayoutProperty('land-basemap-satellite', 'visibility'))).toBe('visible');

  const after = await page.evaluate(() => {
    const { map, state } = window.__MSO__;
    const probe = window.__landSeaProbe;
    map.off('style.load', probe.onStyleLoad);
    return {
      styleLoads: probe.styleLoads,
      marineSourceSame: map.getSource('bathymetry-source') === probe.marineSource,
      bathyLayerSame: map.getLayer('bathymetry-layer') === probe.bathyLayer,
      seaMaskSourceSame: map.getSource('sea-coastline-vectors') === probe.seaMaskSource,
      marineModeSame: state.bathyMode === probe.marineMode,
      marineOpacitySame: map.getPaintProperty('bathymetry-layer', 'raster-opacity') === probe.marineOpacity,
      geography: [map.getCenter().lng, map.getCenter().lat, map.getZoom()],
      previousGeography: probe.geography,
      landMinimal: map.getLayoutProperty('land-basemap-minimal', 'visibility'),
      landSatellite: map.getLayoutProperty('land-basemap-satellite', 'visibility')
    };
  });
  expect(after.styleLoads).toBe(0);
  expect(after.marineSourceSame).toBe(true);
  expect(after.bathyLayerSame).toBe(true);
  expect(after.seaMaskSourceSame).toBe(true);
  expect(after.marineModeSame).toBe(true);
  expect(after.marineOpacitySame).toBe(true);
  expect(after.landMinimal).toBe('none');
  expect(after.landSatellite).toBe('visible');
  expect(after.geography[2]).toBeCloseTo(after.previousGeography[2], 4);

  await page.locator('#baseMap').selectOption('minimal');
  await expect.poll(async () => page.evaluate(() => window.__MSO__.map.getLayoutProperty('land-basemap-minimal', 'visibility'))).toBe('visible');
});

test('v0.22 renders sea context without AOI and does not reset it on land switch', async ({ page }) => {
  await expect(page.locator('#bathyMode')).toHaveValue('aoi-adaptive');
  await expect(page.locator('#aoiStatus')).toContainText('No AOI selected');
  await expect(page.locator('#seaContextNote')).toContainText('isobate di CONTESTO EMODnet');
  await expect.poll(async () => page.evaluate(() => Boolean(window.__MSO__.map.getLayer('bathymetry-fallback-layer'))), { timeout: 10000 }).toBe(true);
  const before = await page.evaluate(() => {
    const map = window.__MSO__.map;
    const style = map.getStyle();
    return {
      oceanFill: map.getPaintProperty('sea-water-background', 'fill-color'),
      bathySource: map.getSource('bathymetry-fallback-source'),
      bathyLayer: map.getLayer('bathymetry-fallback-layer'),
      mainBathy: Boolean(map.getLayer('bathymetry-layer')),
      waterIndex: style.layers.findIndex(layer => layer.id === 'sea-water-background'),
      bathyIndex: style.layers.findIndex(layer => layer.id === 'bathymetry-fallback-layer'),
      landMode: map.getLayoutProperty('land-basemap-minimal', 'visibility')
    };
  });
  expect(before.oceanFill).toBe('#b9d8eb');
  expect(before.mainBathy).toBe(false);
  expect(before.bathyIndex).toBeGreaterThan(before.waterIndex);
  expect(before.landMode).toBe('visible');

  await page.locator('#baseMap').selectOption('satellite');
  const after = await page.evaluate(() => {
    const map = window.__MSO__.map;
    return {
      oceanFill: map.getPaintProperty('sea-water-background', 'fill-color'),
      mainBathy: Boolean(map.getLayer('bathymetry-layer')),
      fallbackPresent: Boolean(map.getLayer('bathymetry-fallback-layer')),
      landMode: map.getLayoutProperty('land-basemap-satellite', 'visibility')
    };
  });
  expect(after.fallbackPresent).toBe(true);
  expect(after.oceanFill).toBe('#b9d8eb');
  expect(after.mainBathy).toBe(false);
  expect(after.landMode).toBe('visible');
});


test('v0.23 GEBCO context WMS remains mounted beyond native scale and labels isobaths as different-source context', async ({ page }) => {
  await page.locator('#bathyMode').selectOption('gebco-global');
  await expect.poll(async () => page.evaluate(() =>
    Boolean(window.__MSO__.map.getLayer('bathymetry-layer'))
  ), { timeout: 10000 }).toBe(true);
  await expect(page.locator('#contourStatus')).toContainText(/isobat|AOI/i);
  await page.evaluate(() => window.__MSO__.map.setZoom(17));
  await expect(page.locator('#bathymetryDetailLimit')).toContainText('Sovrascala batimetrica');
  const current = await page.evaluate(() => {
    const map = window.__MSO__.map;
    return {
      rasterPresent: Boolean(map.getLayer('bathymetry-layer')),
      rasterMaxZoom: map.getLayer('bathymetry-layer')?.maxzoom ?? 24,
      rasterSourceMaxZoom: map.getSource('bathymetry-source')?.maxzoom ?? null,
      contoursPresent: Boolean(map.getLayer('contours-fallback-layer') || map.getLayer('adaptive-contours-line'))
    };
  });
  expect(current.rasterPresent).toBe(true);
  expect(current.rasterMaxZoom).toBeGreaterThan(17);
  expect(current.rasterSourceMaxZoom).toBe(11);
  expect(current.contoursPresent).toBe(true);
});


test('v0.24 exposes all Bellhop3D environment inputs but does not claim TL run readiness', async ({ page }) => {
  await openPanel(page, 'acoustic');
  await expect(page.locator('#acousticEnvironmentPanel')).toBeVisible();
  await page.locator('#buildAcousticInventory').click();
  await expect(page.locator('#bellhopInventoryStatus')).toContainText('Define an AOI');

  await drawAoi(page);
  await page.locator('#bellhopBufferM').fill('5000');
  await page.locator('#buildAcousticInventory').click();
  await expect(page.locator('#bellhopInventoryStatus')).toContainText('NOT READY / NO TL RUN');
  await expect(page.locator('#bellhopInventoryRows .source-candidate')).toHaveCount(12);
  await expect(page.locator('#downloadBellhopInventory')).toBeEnabled();

  const manifest = await page.evaluate(() => window.__MSO__.getAcousticInventory());
  expect(manifest.schema).toBe('bellhop3d-environment-inventory/0.1');
  expect(manifest.readiness.status).toBe('NOT_READY');
  expect(manifest.readiness.completed_and_validated_inputs).toHaveLength(0);
  expect(manifest.environmental_request.source_jobs).toHaveLength(7);
  expect(manifest.propagation_domain.buffer_m).toBe(5000);
  expect(manifest.derived_workflow.find(item => item.id === 'transmission_loss').status).toBe('NOT_RUN');
  expect(manifest.scenario_inputs_pending.length).toBeGreaterThan(5);

  await page.locator('#bellhopBufferM').fill('10000');
  await expect(page.locator('#downloadBellhopInventory')).toBeDisabled();
  await page.locator('#buildAcousticInventory').click();
  await expect(page.locator('#downloadBellhopInventory')).toBeEnabled();
});


test('v0.24 nearest measured SVP selection is based on AOI, depth and time with no fabricated TL', async ({ page }) => {
  await drawAoi(page);
  await openPanel(page, 'acoustic');
  const parameters = await page.evaluate(() => {
    const aoi = window.__MSO__.state.aoi;
    return {
      latitude: (aoi.minLat + aoi.maxLat) / 2,
      longitude: (aoi.minLon + aoi.maxLon) / 2,
      snapshot: document.querySelector('#svpSimulationTime').value + 'Z'
    };
  });
  await page.locator('#svpRequiredDepth').fill('100');
  const casts = {
    schema: 'svp-candidates/0.1',
    profiles: [
      {
        id: 'far-cast', source: 'local measured CTD',
        latitude: parameters.latitude + 0.08, longitude: parameters.longitude + 0.1,
        observed_at: parameters.snapshot,
        samples: [{ depth_m: 0, sound_speed_m_s: 1510 }, { depth_m: 50, sound_speed_m_s: 1507 }, { depth_m: 105, sound_speed_m_s: 1503 }]
      },
      {
        id: 'nearest-cast', source: 'local measured CTD',
        latitude: parameters.latitude, longitude: parameters.longitude,
        observed_at: parameters.snapshot,
        samples: [{ depth_m: 0, sound_speed_m_s: 1512 }, { depth_m: 50, sound_speed_m_s: 1508 }, { depth_m: 105, sound_speed_m_s: 1504 }]
      }
    ]
  };
  await page.locator('#svpCandidatesFile').setInputFiles({
    name: 'measured-casts.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(casts), 'utf-8')
  });
  await expect(page.locator('#svpCandidatesStatus')).toContainText('2 observed SVP candidate(s)');
  await page.locator('#buildAcousticInventory').click();
  await expect(page.locator('#svpSelectionStatus')).toContainText('nearest-cast');
  const manifest = await page.evaluate(() => window.__MSO__.getAcousticInventory());
  expect(manifest.nearest_svp.selected_cast.id).toBe('nearest-cast');
  expect(manifest.nearest_svp.selected_cast.distance_km).toBeLessThan(0.1);
  expect(manifest.svp_forecast_adaptation.transmission_loss).toBe('NOT_COMPUTED');
  expect(manifest.svp_forecast_adaptation.detection_range).toBe('UNDEFINED_WITHOUT_SENSOR_AND_DETECTION_CRITERION');
  expect(manifest.readiness.status).toBe('NOT_READY');
  await expect(page.locator('#downloadBellhopInventory')).toBeEnabled();
});


test('v0.25 place search centers map without creating or changing an AOI', async ({ page }) => {
  await page.route('https://photon.komoot.io/api?**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      type: 'FeatureCollection', features: [
        { type:'Feature', geometry: {type:'Point', coordinates:[9.83, 44.105]}, properties:{name:'La Spezia', country:'Italia', osm_id:123, osm_type:'N', osm_value:'city'} },
        { type:'Feature', geometry: {type:'Point', coordinates:[9.89, 44.1]}, properties:{name:'Porto di La Spezia', country:'Italia', osm_id:456, osm_type:'W', osm_value:'harbour'} }
      ]
    }) });
  });

  await expect(page.locator('#aoiStatus')).toContainText('No AOI selected');
  await page.locator('#placeQuery').fill('La Spezia');
  await page.locator('#placeSearchForm button[type=submit]').click();
  await expect(page.locator('#placeSearchResults button')).toHaveCount(2);
  await page.locator('#placeSearchResults button').first().click();
  await expect(page.locator('#placeSearchStatus')).toContainText('AOI esistente invariata');
  await expect.poll(async () => page.evaluate(() => Math.abs(window.__MSO__.map.getCenter().lng - 9.83)), { timeout: 10000 }).toBeLessThan(0.05);
  const after = await page.evaluate(() => ({
    center: window.__MSO__.map.getCenter(),
    aoi: window.__MSO__.state.aoi
  }));
  expect(after.center.lng).toBeCloseTo(9.83,1);
  expect(after.center.lat).toBeCloseTo(44.105,1);
  expect(after.aoi).toBeNull();
});

test('v0.25 AOI REAL selects global GEBCO in Malaysia and EMODnet in Europe', async ({ page }) => {
  await expect(page.locator('#bathyMode')).toHaveValue('aoi-adaptive');
  await page.evaluate(() => window.__MSO__.map.jumpTo({ center:[119.2,0.9], zoom:8 }));
  await expect.poll(async () => page.evaluate(() => window.__MSO__.layers.getContextBathymetry()), { timeout: 8000 }).toBe('gebco-global');
  await expect(page.locator('#marineContextStatus')).toContainText('GEBCO 2026');
  const sea = await page.evaluate(() => {
    const map = window.__MSO__.map;
    return {
      source: map.getSource('bathymetry-fallback-source')?.serialize(),
      layer: Boolean(map.getLayer('bathymetry-fallback-layer')),
      mode: window.__MSO__.state.bathyMode,
      aoi: window.__MSO__.state.aoi,
      seaMask: Boolean(map.getLayer('sea-water-background'))
    };
  });
  expect(sea.layer).toBe(true);
  expect(sea.source.tiles[0]).toContain('wms.gebco.net');
  expect(sea.source.tiles[0]).toContain('gebco_latest_2');
  expect(sea.source.maxzoom).toBe(11);
  expect(sea.mode).toBe('aoi-adaptive');
  expect(sea.aoi).toBeNull();
  expect(sea.seaMask).toBe(true);
  await page.evaluate(() => window.__MSO__.map.jumpTo({center:[15,43],zoom:8}));
  await expect.poll(async () => page.evaluate(() => window.__MSO__.layers.getContextBathymetry()), { timeout: 8000 }).toBe('emodnet-multicolour');
  await expect(page.locator('#marineContextStatus')).toContainText('EMODnet regional');
});


test('v0.28 counts are recomputed from AOI numeric samples, not new WMS layers', async ({ page }) => {
  await expect(page.locator('#contourCount')).toHaveValue('8');
  await page.evaluate(() => window.__MSO__.map.setZoom(17));
  await page.waitForTimeout(180);
  await drawAoi(page, {x:150,y:130},{x:540,y:490});
  await expect.poll(async()=>page.evaluate(()=>window.__MSO__.state.adaptiveContours?.requested_levels), {timeout:10000}).toBe(8);
  const initial = await page.evaluate(()=>({
    aoi: {...window.__MSO__.state.aoi},
    source: window.__MSO__.state.bathymetryGridSource,
    terrain: window.__MSO__.map.getLayer('land-basemap-minimal')?.layout?.visibility
  }));
  await page.locator('#contourCount').fill('5');
  await page.locator('#contourCount').press('Tab');
  await expect.poll(async()=>page.evaluate(()=>window.__MSO__.state.adaptiveContours?.requested_levels), {timeout:10000}).toBe(5);
  await expect(page.locator('#contourStatus')).toContainText(/5 richieste/);
  await expect(page.locator('#downloadAoiContours')).toBeEnabled();
  await page.locator('#bathyMode').selectOption('gebco-global');
  const after = await page.evaluate(()=>({
    aoi: window.__MSO__.state.aoi,
    source: window.__MSO__.state.bathymetryGridSource,
    terrain: window.__MSO__.map.getLayer('land-basemap-minimal')?.layout?.visibility,
    sourceRaster: window.__MSO__.map.getLayer('bathymetry-layer')
      ? window.__MSO__.map.getLayoutProperty('bathymetry-layer','visibility') : null,
    localContour: window.__MSO__.map.getLayer('aoi-derived-contours-layer')
      ? window.__MSO__.map.getLayoutProperty('aoi-derived-contours-layer','visibility') : null
  }));
  expect(after.aoi).toEqual(initial.aoi);
  expect(after.source).toBe(initial.source);
  expect(after.terrain).toBe(initial.terrain);
  expect([null,'none']).toContain(after.sourceRaster);
  expect(after.localContour).toBe('visible');
  await page.locator('#contourCount').fill('11');
  await page.locator('#contourCount').press('Tab');
  await expect.poll(async()=>page.evaluate(()=>window.__MSO__.state.adaptiveContours?.requested_levels), {timeout:10000}).toBe(11);
});
