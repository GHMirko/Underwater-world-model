import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/,route=>route.abort());
  await page.goto('/Underwater-world-model/');
  await expect(page.locator('#map')).toBeVisible();
  await page.evaluate(()=>window.__MSO__.map.jumpTo({center:[17.22,40.49],zoom:13}));
});

async function drawAoi(page){
  await page.locator('#quickDrawAoi').click();
  const canvas=page.locator('#map canvas').first(),bb=await canvas.boundingBox();
  await page.mouse.move(bb.x+155,bb.y+190);
  await page.mouse.down();
  await page.mouse.move(bb.x+435,bb.y+435,{steps:7});
  await page.mouse.up();
  await expect(page.locator('#operatorAoiState')).toHaveText('DEFINITA');
}
async function openData(page){
  const tab=page.locator('#operatorTab-data');
  if((await tab.getAttribute('aria-expanded'))!=='true')await tab.click();
  await expect(page.locator('#coastalHydrographyPanel')).toBeVisible();
}

test('v0.31 chart objects reconstruct a non-certified numerical seafloor without painting on land',async({page})=>{
  await expect(page.locator('.header .badge').first()).toContainText('v0.32');
  await drawAoi(page);
  await openData(page);
  const aoi=await page.evaluate(()=>window.__MSO__.state.aoi);
  const w=aoi.maxLon-aoi.minLon,h=aoi.maxLat-aoi.minLat;
  const line = (ratio,depth)=>({
    type:'Feature', properties:{_s57_layer:'DEPCNT',VALDCO:depth},
    geometry:{type:'LineString',coordinates:[
      [aoi.minLon+ratio*w,aoi.minLat+0.05*h],[aoi.minLon+ratio*w,aoi.maxLat-0.05*h]
    ]}
  });
  const geojson={type:'FeatureCollection',features:[
    line(0.2,5),line(0.5,12),line(0.8,25),
    {type:'Feature',properties:{_s57_layer:'DEPARE',DRVAL1:0,DRVAL2:50},
      geometry:{type:'Polygon',coordinates:[[
        [aoi.minLon,aoi.minLat],[aoi.maxLon,aoi.minLat],
        [aoi.maxLon,aoi.maxLat],[aoi.minLon,aoi.maxLat],[aoi.minLon,aoi.minLat]
      ]]}}
  ]};
  await page.locator('#coastalImportFile').setInputFiles({
    name:'coastal-test.geojson',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(geojson))
  });
  await expect(page.locator('#coastalSourceStatus')).toContainText('DEPCNT 3');
  await page.locator('#coastalGridM').fill('60');
  await page.locator('#coastalRadiusM').fill('500');
  await page.locator('#coastalBuildModel').click();
  await expect(page.locator('#coastalModelStatus')).toContainText('Bellhop3D: BLOCCATO');
  await expect(page.locator('#coastalDownloadModel')).toBeEnabled();
  await expect(page.locator('#coastalDownloadXyz')).toBeEnabled();
  const model=await page.evaluate(()=>window.__MSO__.coastalHydrography.getModel());
  expect(model.coverage_ratio).toBeGreaterThan(0);
  expect(model.bellhop3d_gate.can_export_as_model_input).toBe(false);
  expect(model.cells.every(cell=>cell.predictor_eligible===false)).toBe(true);
  const visible=await page.evaluate(()=>{
    const m=window.__MSO__.map;
    return {
      input:m.getLayer('coastal-import-lines')!=null,
      numeric:m.getLayer('coastal-derived-lines')!=null,
      land:m.getLayoutProperty('land-basemap-minimal','visibility')
    };
  });
  expect(visible.input).toBe(true);
  expect(visible.numeric).toBe(true);
  expect(visible.land).toBe('visible');
  await page.locator('#quickClearAoi').click();
  await expect(page.locator('#coastalDownloadModel')).toBeDisabled();
  await expect(page.locator('#coastalSourceStatus')).toContainText('DEPCNT 3');
});

test('Puglia public source can be queried with AOI through mock ArcGIS and derives positive depths from Z',async({page})=>{
  let requests=0;
  await page.route('https://webapps.sit.puglia.it/arcgis/rest/services/ServicesArcIMS/batimetria/MapServer/0/query?**',
    route=>{
      requests++;
      const query=new URL(route.request().url()).searchParams;
      if(query.has('returnIdsOnly'))return route.fulfill({
        status:200,contentType:'application/json',body:JSON.stringify({objectIds:[3,4,5]})
      });
      const [w,s,e,n]=query.get('geometry').split(',').map(Number);
      const features=[3,4,5].map((id,i)=>({
        attributes:{OBJECTID:id,Z:-[5,10,20][i]},
        geometry:{paths:[[
          [w+(i+1)*(e-w)/4,s+(n-s)*0.08],
          [w+(i+1)*(e-w)/4,n-(n-s)*0.08]
        ]]}
      }));
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({features})});
    });
  await drawAoi(page);
  await openData(page);
  await page.locator('#coastalFetchPuglia').click();
  await expect(page.locator('#coastalSourceStatus')).toContainText('DEPCNT 3');
  expect(requests).toBe(2);
  const loaded=await page.evaluate(()=>window.__MSO__.coastalHydrography.getDataset());
  expect(loaded.source.id).toBe('PUGLIA_BATIMETRIA_ARCGIS');
  expect(loaded.geometry.features.map(f=>f.properties.depth_m).sort((a,b)=>a-b)).toEqual([5,10,20]);
});
