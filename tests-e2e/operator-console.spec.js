import { test, expect } from '@playwright/test';

test.beforeEach(async ({page})=>{
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/,route=>route.abort());
  await page.goto('/Underwater-world-model/');
  await expect(page.locator('#map')).toBeVisible();
});

test('v0.26 starts with map-first viewport and no persistent right bar',async({page})=>{
  await expect(page.locator('#operatorDrawer')).toBeHidden();
  await expect(page.locator('#operatorRail .operator-rail-button')).toHaveCount(5);
  await expect(page.locator('#operatorStatusBar')).toBeVisible();
  await expect(page.locator('#operatorAoiState')).toHaveText('NON DEFINITA');
  await expect(page.locator('#operatorAcousticState')).toHaveText('TL NON CALCOLATA');
  await expect(page.locator('#quickDrawAoi')).toBeEnabled();
  await expect(page.locator('#quickFitAoi')).toBeDisabled();
  await expect(page.locator('#quickClearAoi')).toBeDisabled();
  await expect(page.locator('#placeSearchForm')).toBeVisible();
});

test('one functional panel at a time and close panel without changing map or AOI',async({page})=>{
  const before=await page.evaluate(()=>({center:window.__MSO__.map.getCenter().toArray(),aoi:window.__MSO__.state.aoi}));
  await page.locator('#operatorTab-chart').click();
  await expect(page.locator('#operatorPanel-chart')).toBeVisible();
  await expect(page.locator('#seaMapPanel')).toBeVisible();
  await expect(page.locator('#operatorPanel-data')).toBeHidden();
  await page.locator('#operatorTab-data').click();
  await expect(page.locator('#environmentPanel')).toBeVisible();
  await expect(page.locator('#operatorPanel-chart')).toBeHidden();
  await page.locator('#operatorTab-acoustic').click();
  await expect(page.locator('#acousticEnvironmentPanel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#operatorDrawer')).toBeHidden();
  const after=await page.evaluate(()=>({center:window.__MSO__.map.getCenter().toArray(),aoi:window.__MSO__.state.aoi}));
  expect(after.aoi).toEqual(before.aoi);
  expect(after.center[0]).toBeCloseTo(before.center[0],5);
  expect(after.center[1]).toBeCloseTo(before.center[1],5);
});

test('quick AOI controls remain usable while contextual panels are closed',async({page})=>{
  await page.locator('#quickDrawAoi').click();
  await expect(page.locator('#aoiStatus')).toContainText('Drag on the map');
  const canvas=page.locator('#map canvas').first();
  const bb=await canvas.boundingBox();
  await page.mouse.move(bb.x+150,bb.y+170);
  await page.mouse.down();
  await page.mouse.move(bb.x+370,bb.y+370,{steps:8});
  await page.mouse.up();
  await expect(page.locator('#operatorAoiState')).toHaveText('DEFINITA');
  await expect(page.locator('#quickFitAoi')).toBeEnabled();
  await expect(page.locator('#quickClearAoi')).toBeEnabled();
  await page.locator('#quickClearAoi').click();
  await expect(page.locator('#operatorAoiState')).toHaveText('NON DEFINITA');
  await expect(page.locator('#operatorDrawer')).toBeHidden();
});
