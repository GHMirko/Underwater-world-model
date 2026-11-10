import { test, expect } from '@playwright/test';

test.beforeEach(async ({page})=>{
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/,route=>route.abort());
  await page.goto('/Underwater-world-model/');
  await expect(page.locator('#map')).toBeVisible();
});

test('v0.27 saves an experiment with AOI in browser storage and reopens it after reload',async({page})=>{
  await page.locator('#operatorTab-mission').click();
  await expect(page.locator('#experimentPanel')).toBeVisible();
  await page.locator('#experimentName').fill('Catania Area 001');
  await page.locator('#createExperiment').click();
  await expect(page.locator('#currentExperiment')).toContainText('Catania Area 001');
  await expect(page.locator('#experimentStatus')).toContainText('SOLO in questo browser');
  await expect(page.locator('#activeExperimentName')).toHaveText('Catania Area 001');
  await page.locator('#quickDrawAoi').click();
  const canvas=page.locator('#map canvas').first();
  const rect=await canvas.boundingBox();
  await page.mouse.move(rect.x+130,rect.y+180);
  await page.mouse.down();
  await page.mouse.move(rect.x+350,rect.y+370,{steps:8});
  await page.mouse.up();
  await expect(page.locator('#operatorAoiState')).toHaveText('DEFINITA');
  await expect(page.locator('#activeExperimentDirty')).toContainText('NON SALVATE');
  const before=await page.evaluate(()=>({...window.__MSO__.state.aoi}));
  await page.locator('#saveExperiment').click();
  await expect(page.locator('#activeExperimentDirty')).toHaveText('SALVATO');
  await page.reload();
  await expect(page.locator('#operatorAoiState')).toHaveText('NON DEFINITA');
  await page.locator('#operatorTab-mission').click();
  await page.locator('#experimentLibrary').selectOption({label:/Catania Area 001/});
  await page.locator('#openLocalExperiment').click();
  await expect(page.locator('#activeExperimentName')).toHaveText('Catania Area 001');
  await expect(page.locator('#operatorAoiState')).toHaveText('DEFINITA');
  const after=await page.evaluate(()=>window.__MSO__.state.aoi);
  expect(after.minLat).toBeCloseTo(before.minLat,5);
  expect(after.maxLon).toBeCloseTo(before.maxLon,5);
  await expect(page.locator('#operatorAcousticState')).toHaveText('TL NON CALCOLATA');
});

test('v0.27 removes Photon lang=it (400) and lets operator move search panel on map',async({page})=>{
  let searchedUrl;
  await page.route('https://photon.komoot.io/api?**',route=>{
    searchedUrl=route.request().url();
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      features:[{type:'Feature',properties:{name:'Catania',country:'Italia',osm_value:'city',osm_id:123},
        geometry:{type:'Point',coordinates:[15.087,37.502]}}]
    })});
  });
  const form=page.locator('#placeSearchForm'),handle=form.locator('label[for=placeQuery]');
  const before=await form.boundingBox(),title=await handle.boundingBox();
  await page.mouse.move(title.x+55,title.y+8);
  await page.mouse.down();
  await page.mouse.move(title.x+145,title.y+60,{steps:6});
  await page.mouse.up();
  const after=await form.boundingBox();
  expect(after.x).toBeGreaterThan(before.x+35);
  expect(after.y).toBeGreaterThan(before.y+20);
  await page.locator('#placeQuery').fill('catania');
  await page.locator('#placeSearchForm button[type=submit]').click();
  await expect(page.locator('#placeSearchResults button')).toHaveCount(1);
  expect(new URL(searchedUrl).searchParams.get('q')).toBe('catania');
  expect(new URL(searchedUrl).searchParams.has('lang')).toBe(false);
  await page.locator('#placeSearchResults button').first().click();
  await expect(page.locator('#placeSearchStatus')).toContainText('AOI esistente invariata');
});
