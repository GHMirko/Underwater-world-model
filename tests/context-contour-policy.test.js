import test from 'node:test';
import assert from 'node:assert/strict';
import { selectContextContourLevels } from '../src/map/contour-model.js';
import { regionalBathymetryRegion } from '../src/map/bathymetry-context.js';

const published={
  type:'FeatureCollection',
  features:[50,100,200,500,1000].map((depth,i)=>({
    type:'Feature',
    properties:{Elevation:String(-depth)},
    geometry:{type:'LineString',coordinates:[[17,40+i*.01],[17.5,40+i*.01]]}
  }))
};

test('pre-AOI published WFS contours retain coastal 50m at regional zoom rather than hiding every contour',()=>{
  const result=selectContextContourLevels(published,8);
  assert.equal(result.metadata.role,'CONTEXT_ONLY_NOT_AOI_DATA');
  assert.deepEqual(result.metadata.displayed_levels_m,[50,100,200,500,1000]);
  assert.ok(result.features.some(f=>f.properties._depth===50));
  assert.equal(result.features.length,5);
  assert.ok(result.features.every(f=>f.properties.layer_class==='CONTEXT_ONLY'));
});

test('operator N is a cap on actual native WFS levels; no artificial contours',()=>{
  const result=selectContextContourLevels(published,2);
  assert.equal(result.metadata.requested_levels,2);
  assert.deepEqual(result.metadata.displayed_levels_m,[50,1000]);
  assert.equal(result.features.length,2);
  assert.equal(selectContextContourLevels(published,30).features.length,5);
});

test('invalid/unrelated land geometries are excluded; no fabricated data on empty response',()=>{
  const features={type:'FeatureCollection',features:[
    {type:'Feature',properties:{Elevation:'0'},geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}},
    {type:'Feature',properties:{Elevation:'-100'},geometry:{type:'Polygon',coordinates:[]}},
    {type:'Feature',properties:{foo:'100'},geometry:{type:'Point',coordinates:[0,0]}}
  ]};
  assert.equal(selectContextContourLevels(features,8).features.length,0);
  assert.equal(selectContextContourLevels({type:'FeatureCollection',features:[]},8).features.length,0);
});

test('Taranto is in EMODnet geographic context; outside regional bounds no implicit Europe contour coverage',()=>{
  assert.equal(regionalBathymetryRegion({lng:17.23,lat:40.47}),'EUROPEAN_SEAS');
  assert.equal(regionalBathymetryRegion({lng:120,lat:0}),null);
});
