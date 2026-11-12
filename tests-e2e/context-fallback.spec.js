import { test, expect } from '@playwright/test';

const contextFeatures = {
  type: 'FeatureCollection',
  features: [50,100,200,500].map((depth,i) => ({
    type:'Feature',
    properties:{ Elevation:String(-depth) },
    geometry:{type:'LineString',coordinates:[
      [16.9,40.19+i*0.04],[17.25,40.32+i*0.04],[17.56,40.46+i*0.04]
    ]}
  }))
};

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('PAGE ERROR',error));
  await page.route('https://rest.emodnet-bathymetry.eu/**', route => {
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({avg:12.0})});
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173|rest\.emodnet-bathymetry\.eu).*/, route=>route.abort());
  // Register exact vector mock after the generic offline block.
  await page.route('https://ows.emodnet-bathymetry.eu/wfs?**', route =>
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(contextFeatures)}));
  await page.goto('/Underwater-world-model/');
  await expect(page.locator('#map')).toBeVisible();
  await page.evaluate(() => window.__MSO__.map.jumpTo({ center:[17.23,40.47], zoom:9 }));
  await page.locator('#operatorTab-chart').click();
});

async function drawAoi(page) {
  await page.locator('#quickDrawAoi').click();
  const box=await page.locator('#map canvas').first().boundingBox();
  await page.mouse.move(box.x+170,box.y+150);
  await page.mouse.down();
  await page.mouse.move(box.x+510,box.y+380,{steps:7});
  await page.mouse.up();
  await expect(page.locator('#operatorAoiState')).toHaveText('DEFINITA');
}

test('regression: published EMODnet isobaths render BEFORE AOI in Taranto without altering terrain',async({page})=>{
  await expect(page.locator('.header .badge').first()).toContainText('v0.29');
  await expect(page.locator('#operatorAoiState')).toHaveText('NON DEFINITA');
  await expect(page.locator('#contourCount')).toHaveValue('8');
  await expect.poll(async()=>page.evaluate(() =>
    Boolean(window.__MSO__.map.getLayer('adaptive-contours-line'))),{timeout:12000}).toBe(true);
  await expect(page.locator('#mapContourStatus')).toContainText(/CONTESTO.*WFS/i);
  await expect(page.locator('#mapContourStatus')).toContainText('4 livelli');
  const visible=await page.evaluate(()=>{
    const m=window.__MSO__.map;
    return {
      context:m.queryRenderedFeatures({layers:['adaptive-contours-line']}).length,
      land:m.getLayoutProperty('land-basemap-minimal','visibility'),
      landSatellite:m.getLayoutProperty('land-basemap-satellite','visibility'),
      bathy:m.getLayer('bathymetry-fallback-layer') ?
        m.getLayoutProperty('bathymetry-fallback-layer','visibility') : null,
      actualAoi:window.__MSO__.state.aoi
    };
  });
  expect(visible.context).toBeGreaterThan(0);
  expect(visible.land).toBe('visible');
  expect(visible.landSatellite).toBe('none');
  expect([null,'none']).toContain(visible.bathy);
  expect(visible.actualAoi).toBeNull();
  await expect(page.locator('#downloadAoiContours')).toBeDisabled();
});

test('N controls published context levels; drawing AOI cancels WFS and never imports context into numeric AOI',async({page})=>{
  await expect.poll(async()=>page.evaluate(() =>
    Boolean(window.__MSO__.map.getLayer('adaptive-contours-line'))),{timeout:12000}).toBe(true);
  await page.locator('#contourCount').fill('2');
  await page.locator('#contourCount').press('Tab');
  await expect(page.locator('#mapContourStatus')).toContainText('2 livelli');
  await expect(page.locator('#operatorAoiState')).toHaveText('NON DEFINITA');
  await drawAoi(page);
  await expect.poll(async()=>page.evaluate(()=>
    !window.__MSO__.map.getLayer('adaptive-contours-line') &&
    !window.__MSO__.map.getLayer('contours-fallback-layer')),{timeout:10000}).toBe(true);
  await expect(page.locator('#mapContourStatus')).toContainText(/AOI.*numeriche non disponibili/i);
  await expect(page.locator('#downloadAoiContours')).toBeDisabled();
  await page.locator('#quickClearAoi').click();
  await expect(page.locator('#operatorAoiState')).toHaveText('NON DEFINITA');
  await expect.poll(async()=>page.evaluate(() =>
    Boolean(window.__MSO__.map.getLayer('adaptive-contours-line'))),{timeout:12000}).toBe(true);
  await expect(page.locator('#mapContourStatus')).toContainText(/CONTESTO.*WFS/i);
});

test('changing bathymetry selection does not change terrain while published context contours remain visible',async({page})=>{
  await expect.poll(async()=>page.evaluate(() =>
    Boolean(window.__MSO__.map.getLayer('adaptive-contours-line'))),{timeout:12000}).toBe(true);
  for (const mode of ['gebco-global','emodnet-rainbow','emodnet-multicolour','chart-relief','aoi-adaptive']) {
    await page.locator('#bathyMode').selectOption(mode);
    await expect.poll(async()=>page.evaluate(() =>
      Boolean(window.__MSO__.map.getLayer('adaptive-contours-line'))),{timeout:10000}).toBe(true);
    const result=await page.evaluate(()=>{
      const m=window.__MSO__.map;
      return {
        land:m.getLayoutProperty('land-basemap-minimal','visibility'),
        ocean:m.getLayer('sea-water-background')?.id ?? null,
        bathy:m.getLayer('bathymetry-layer') ? m.getLayoutProperty('bathymetry-layer','visibility') : null,
        fallback:m.getLayer('bathymetry-fallback-layer') ? m.getLayoutProperty('bathymetry-fallback-layer','visibility') : null
      };
    });
    expect(result.land).toBe('visible');
    expect([null,'none']).toContain(result.bathy);
    expect([null,'none']).toContain(result.fallback);
  }
  await expect(page.locator('#mapContourStatus')).toContainText('EModnet WFS');
});
