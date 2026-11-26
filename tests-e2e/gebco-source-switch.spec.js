import { test, expect } from '@playwright/test';

const GEBCO_GEO_TIFF_B64='SUkqAAgAAAARAAABAwABAAAACAAAAAEBAwABAAAACAAAAAIBAwABAAAAIAAAAAMBAwABAAAAAQAAAAYBAwABAAAAAQAAABEBBAABAAAAgAEAABUBAwABAAAAAQAAABYBAwABAAAACAAAABcBBAABAAAAAAEAABwBAwABAAAAAQAAAFMBAwABAAAAAwAAAA6DDAADAAAA2gAAAIKEDAAGAAAA8gAAAK+HAwAgAAAAIgEAALCHDAACAAAAYgEAALGHAgAIAAAAcgEAAIGkAgAGAAAAegEAAAAAAAD8qfHSTWJQP/yp8dJNYlA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC4HoXrUTgxQLByaJHtPERAAAAAAAAAAAABAAEAAAAHAAAEAAABAAIAAQQAAAEAAQAACAAAAQDmEAEIsYcHAAAABggAAAEAjiMJCLCHAQABAAsIsIcBAAAAiG10lh2kckAAAABAplRYQVdHUyA4NHwALTk5OTkAAAAQQQAAAMEAADDBAABgwQAAiMEAAKDBAAC4wQAA0MEAAODAAAAgwQAAUMEAAIDBAACYwQAAsMEAAMjBAADgwQAAEMEAAEDBAABwwQAAkMEAAKjBAADAwQAA2MEAAPDBAAAwwQAAYMEAAIjBAACgwQAAuMEAANDBAADowQAAAMIAAFDBAACAwQAAmMEAALDBAADIwQAA4MEAAPjBAAAIwgAAcMEAAJDBAACowQAAwMEAANjBAADwwQAABMIAABDCAACIwQAAoMEAALjBAADQwQAA6MEAAADCAAAMwgAAGMIAAJjBAACwwQAAyMEAAODBAAD4wQAACMIAABTCAAAgwg==';
const testAoi={minLon:17.2199,minLat:40.4679,maxLon:17.2281,maxLat:40.4761};
test('REAL source selector changes actual isobaths; imported GEBCO N changes geometries and restores independently of land',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://rest.emodnet-bathymetry.eu/**',r=>r.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({avg:-24.2})
  }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173|rest\.emodnet-bathymetry\.eu).*/,r=>r.abort());
  await page.goto('/Underwater-world-model/');
  await expect(page.locator('.header .badge')).toContainText('v0.32');
  const tab=page.locator('#operatorTab-chart');
  if((await tab.getAttribute('aria-expanded'))!=='true')await tab.click();
  await page.locator('#bathyMode').selectOption('gebco-global');
  await expect(page.locator('#selectedBathyDataStatus')).toContainText('importare');
  await page.evaluate(aoi=>window.__MSO__.aoi.setAoi(aoi,{notify:true}),testAoi);
  await page.locator('#gebcoGeotiffFile').setInputFiles({
    name:'GEBCO_2026_test.tif',mimeType:'image/tiff',
    buffer:Buffer.from(GEBCO_GEO_TIFF_B64,'base64')
  });
  await expect.poll(async()=>page.evaluate(()=>
    window.__MSO__.getGebcoContoursSummary()?.requested_levels),{timeout:12000}).toBe(8);
  await expect(page.locator('#gebcoNumericStatus')).toContainText('8 richieste');
  await expect.poll(async()=>page.evaluate(()=>
    window.__MSO__.getGebcoContours()?.features?.length),{timeout:12000}).toBeGreaterThan(0);
  const initial=await page.evaluate(()=>{
    const map=window.__MSO__.map;
    return {
      n:window.__MSO__.getGebcoContoursSummary().available_levels,
      levels:[...new Set(window.__MSO__.getGebcoContours().features.map(x=>x.properties.depth_m))],
      emodnet:map.getLayer('adaptive-contours-line')
        ?map.getLayoutProperty('adaptive-contours-line','visibility'):null,
      wcs:map.getLayer('aoi-derived-contours-layer')
        ?map.getLayoutProperty('aoi-derived-contours-layer','visibility'):null,
      geomap:map.getLayoutProperty('land-basemap-minimal','visibility'),
      gebco:map.getLayoutProperty('gebco-numeric-isobaths-layer','visibility')
    };
  });
  expect(initial.n).toBeGreaterThan(0);
  expect(initial.geomap).toBe('visible');
  expect(initial.gebco).toBe('visible');
  expect([null,'none']).toContain(initial.wcs);
  expect([null,'none']).toContain(initial.emodnet);
  await page.locator('#contourCount').fill('2');
  await page.locator('#contourCount').press('Tab');
  await expect.poll(async()=>page.evaluate(()=>
    window.__MSO__.getGebcoContoursSummary()?.requested_levels),{timeout:10000}).toBe(2);
  const two=await page.evaluate(()=>new Set(window.__MSO__.getGebcoContours().features.map(x=>x.properties.depth_m)).size);
  await page.locator('#contourCount').fill('6');
  await page.locator('#contourCount').press('Tab');
  await expect.poll(async()=>page.evaluate(()=>
    window.__MSO__.getGebcoContoursSummary()?.requested_levels),{timeout:10000}).toBe(6);
  const six=await page.evaluate(()=>new Set(window.__MSO__.getGebcoContours().features.map(x=>x.properties.depth_m)).size);
  expect(six).toBeGreaterThan(two);
  await page.locator('#bathyMode').selectOption('emodnet-rainbow');
  await expect.poll(async()=>page.evaluate(()=>window.__MSO__.map.getLayoutProperty('gebco-numeric-isobaths-layer','visibility'))).toBe('none');
  await page.locator('#bathyMode').selectOption('gebco-global');
  await expect.poll(async()=>page.evaluate(()=>window.__MSO__.map.getLayoutProperty('gebco-numeric-isobaths-layer','visibility'))).toBe('visible');
  expect(await page.evaluate(()=>window.__MSO__.map.getLayoutProperty('land-basemap-minimal','visibility'))).toBe('visible');
  expect(errors).toEqual([]);
});
