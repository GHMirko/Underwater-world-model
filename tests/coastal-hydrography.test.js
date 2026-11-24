import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCoastalHydrography, coastalEvidence } from '../src/data/coastal-hydrography.js';
import { reconstructCoastalSeafloor, coastalModelCsv } from '../src/data/chart-constrained-surface.js';
import { pugliaRequestUrl, parsePugliaArcgisFeatures, fetchPugliaContours } from '../src/data/puglia-coastal-source.js';

const aoi={minLon:15,minLat:40,maxLon:15.005,maxLat:40.005};
const ring=[[14.999,39.999],[15.006,39.999],[15.006,40.006],[14.999,40.006],[14.999,39.999]];
function polygon(kind,min=0,max=50){
  return {type:'Feature',properties:{_s57_layer:kind,DRVAL1:min,DRVAL2:max,CATZOC:'A2'},
    geometry:{type:'Polygon',coordinates:[ring]}};
}
const soundings=[[15.0004,40.0004,10],[15.0045,40.0005,30],
  [15.0005,40.0045,11],[15.0045,40.0045,29]]
  .map(coords=>({type:'Feature',properties:{_s57_layer:'SOUNDG'},geometry:{type:'Point',coordinates:coords}}));
const curve={type:'Feature',properties:{_s57_layer:'DEPCNT',VALDCO:20},
  geometry:{type:'LineString',coordinates:[[15.0025,40.0004],[15.0025,40.0046]]}};
const base={type:'FeatureCollection',features:[...soundings,curve,polygon('DEPARE'),
  polygon('M_QUAL')]};

test('S-57 object classes retain point soundings, contour equalities, DEPARE inequalities and CATZOC metadata',()=>{
  const dataset=normalizeCoastalHydrography(base,{sourceId:'ENC_TEST',verticalDatum:'UNVERIFIED'});
  assert.equal(dataset.schema,'coastal-hydrography/0.1');
  assert.equal(dataset.counts.SOUNDG,4);
  assert.equal(dataset.counts.DEPCNT,1);
  assert.equal(dataset.counts.DEPARE,1);
  assert.equal(dataset.counts.M_QUAL,1);
  assert.equal(dataset.source.datum_status,'UNVALIDATED');
  const ev=coastalEvidence(dataset);
  assert.equal(ev.soundings[0].properties.depth_m,10);
  assert.equal(ev.depthAreas[0].properties.min_depth_m,0);
  assert.equal(ev.depthAreas[0].properties.max_depth_m,50);
  assert.equal(ev.qualityAreas[0].properties.catzoc,'A2');
});

test('chart-constrained bathymetry reconstructs only supported cells and never passes Bellhop3D gates',()=>{
  const dataset=normalizeCoastalHydrography(base,{sourceId:'ENC_TEST'});
  const model=reconstructCoastalSeafloor({aoi,dataset,targetGridM:40,maxSupportDistanceM:400});
  assert.equal(model.schema,'coastal-chart-seafloor-reconstruction/0.1');
  assert.equal(model.bellhop3d_gate.status,'BLOCKED_NOT_ANALYSIS_READY');
  assert.equal(model.bellhop3d_gate.can_export_as_model_input,false);
  assert.ok(model.coverage_ratio>0 && model.coverage_ratio<1);
  const cells=model.cells.filter(cell=>cell.depth_m!=null);
  assert.ok(cells.length>0);
  assert.ok(cells.every(c=>c.depth_m>=0 && c.depth_m<=50));
  assert.ok(cells.every(c=>c.predictor_eligible===false && c.uncertainty_m===null));
  assert.ok(cells.some(c=>c.catzoc.includes('A2')));
  assert.ok(cells.some(c=>c.contributing_object_classes.includes('DEPCNT')));
  const csv=coastalModelCsv(model);
  assert.match(csv,/lon,lat,depth_m/);
  assert.equal(csv.trim().split('\n').length,cells.length+1);
});

test('DEPARE-only does NOT fabricate a flat depth or midpoint DTM',()=>{
  const dataset=normalizeCoastalHydrography({type:'FeatureCollection',features:[polygon('DEPARE',0,20)]});
  const model=reconstructCoastalSeafloor({aoi,dataset,targetGridM:50,maxSupportDistanceM:400});
  assert.equal(model.coverage_ratio,0);
  assert.ok(model.cells.every(c=>c.depth_m==null));
  assert.equal(model.evidence.sampled_point_constraints,0);
});

test('DEPARE inequality rejects chart interpolation outside range rather than silently clipping',()=>{
  const changed={type:'FeatureCollection',features:[...soundings,curve,polygon('DEPARE',0,5)]};
  const dataset=normalizeCoastalHydrography(changed);
  const model=reconstructCoastalSeafloor({aoi,dataset,targetGridM:50,maxSupportDistanceM:400});
  assert.equal(model.coverage_ratio,0);
  assert.ok(model.flags.blocked_cell_counts.depth_area_conflicts>0);
});

test('model refuses made-up spatial resolution and unbounded AOI extrapolation',()=>{
  const dataset=normalizeCoastalHydrography(base);
  assert.throws(()=>reconstructCoastalSeafloor({aoi,dataset,targetGridM:1}),/5–1000/);
  assert.throws(()=>reconstructCoastalSeafloor({
    aoi:{minLon:14,minLat:39,maxLon:16,maxLat:41},dataset,targetGridM:5
  }),/massimo 20000/);
  assert.equal(reconstructCoastalSeafloor({aoi,dataset,targetGridM:40}).grid.output_resolution_is_computational_only,true);
});

test('S-57 input without recognized depth objects is rejected',()=>{
  assert.throws(()=>normalizeCoastalHydrography({type:'FeatureCollection',features:[
    {type:'Feature',properties:{_s57_layer:'COALNE'},geometry:{type:'LineString',coordinates:[[15,40],[15.1,40.1]]}}
  ]}),/Nessuna feature/);
});

test('Puglia ArcGIS Z values are NEGATIVE elevations and converted to positive depths',()=>{
  const features=parsePugliaArcgisFeatures({features:[
    {attributes:{OBJECTID:123,Z:-15},geometry:{paths:[[[17.1,40.3],[17.2,40.4]]]}}
  ]});
  const norm=normalizeCoastalHydrography(features,{sourceId:'PUGLIA_BATIMETRIA_ARCGIS'});
  assert.equal(norm.counts.DEPCNT,1);
  assert.equal(norm.geometry.features[0].properties.depth_m,15);
  assert.equal(norm.source.source_data_type,'PUBLISHED_REGIONAL_CONTOURS');
});

test('Puglia AOI query is spatially limited with WGS84, actual IDs are requested in bounded batches',async()=>{
  const area={minLon:17,minLat:40.2,maxLon:17.3,maxLat:40.5};
  const url=new URL(pugliaRequestUrl(area));
  assert.equal(url.searchParams.get('inSR'),'4326');
  assert.equal(url.searchParams.get('outSR'),'4326');
  assert.equal(url.searchParams.get('geometry'),'17,40.2,17.3,40.5');
  let requests=0;
  const dataset=await fetchPugliaContours(area,{fetchImpl:async u=>{
    requests++;
    const params=new URL(u).searchParams;
    if(params.get('returnIdsOnly'))return{ok:true,json:async()=>({objectIds:[1,2]})};
    assert.equal(params.get('objectIds'),'1,2');
    return{ok:true,json:async()=>({features:[
      {attributes:{OBJECTID:1,Z:-5},geometry:{paths:[[[17.1,40.3],[17.2,40.4]]]}},
      {attributes:{OBJECTID:2,Z:-10},geometry:{paths:[[[17.05,40.32],[17.25,40.42]]]}}
    ]})};
  }});
  assert.equal(requests,2);
  assert.equal(dataset.features.length,2);
  assert.throws(()=>pugliaRequestUrl({minLon:130,minLat:0,maxLon:131,maxLat:1}),/esterna/);
});
