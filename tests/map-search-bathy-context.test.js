import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticContextBathymetry, regionalBathymetryRegion, contextDisplayDescription } from '../src/map/bathymetry-context.js';
import { visualBathymetryStack, gebcoWms } from '../src/map/config.js';
import { parseCoordinateCenter, normalizePhotonPlaces, placeSearchUrl, lookupPlaces } from '../src/map/place-search.js';

test('AOI visual context uses GEBCO global outside EMODnet regions, EMODnet when candidate coverage exists', () => {
  assert.equal(automaticContextBathymetry({lng:119.2,lat:0}), 'gebco-global');
  assert.equal(automaticContextBathymetry({lng:15.0,lat:44.1}), 'emodnet-multicolour');
  assert.equal(automaticContextBathymetry({lng:-65,lat:15}), 'emodnet-multicolour');
  assert.equal(automaticContextBathymetry({lng:145,lat:35}), 'gebco-global');
  assert.equal(automaticContextBathymetry({lng:375,lat:44}), 'emodnet-multicolour', 'wrapped longitude normalized');
  assert.equal(regionalBathymetryRegion({lng:118,lat:1}), null);
  assert.deepEqual(visualBathymetryStack('aoi-adaptive',{lng:118,lat:1}),['gebco-global','aoi-adaptive']);
  assert.deepEqual(visualBathymetryStack('aoi-adaptive',{lng:15,lat:42}),['emodnet-multicolour','aoi-adaptive']);
  assert.deepEqual(visualBathymetryStack('aoi-adaptive'), ['emodnet-multicolour','aoi-adaptive']);
});

test('global context is explicitly a visual WMS, not validated numeric bathymetry', () => {
  const info = contextDisplayDescription('aoi-adaptive',{lng:118,lat:1});
  assert.equal(info.provider,'GEBCO');
  assert.equal(info.numerical,false);
  assert.equal(info.status,'GLOBAL_WMS_CANDIDATE');
  assert.ok(gebcoWms().includes('gebco_latest_2'));
});

test('coordinates can navigate to a location without a remote geocoder', () => {
  const p=parseCoordinateCenter('44.103, 9.83');
  assert.equal(p.latitude,44.103);
  assert.equal(p.longitude,9.83);
  assert.equal(parseCoordinateCenter('120, 10'),null,'latitude is first');
  assert.equal(parseCoordinateCenter('foo'),null);
});

test('Photon results are normalized and invalid coordinates discarded', () => {
  const places=normalizePhotonPlaces({features:[
    {properties:{name:'La Spezia',country:'Italia',osm_value:'city',osm_id:123},geometry:{coordinates:[9.83,44.105]}},
    {properties:{name:'invalid'},geometry:{coordinates:[NaN,120]}}
  ]});
  assert.equal(places.length,1);
  assert.match(places[0].label,/La Spezia/);
  assert.equal(places[0].latitude,44.105);
  assert.equal(places[0].zoom,11);
});

test('geocoding is explicit, URL-encoded, and does not submit on typing', async () => {
  const url=placeSearchUrl('Golfo della Spezia');
  assert.match(url,/q=Golfo\+della\+Spezia/);
  assert.match(url,/limit=5/);
  await assert.rejects(async()=>lookupPlaces('x'),/almeno 2/);
  const places=await lookupPlaces('9.83, 44.10',{fetchImpl:()=>{throw Error('must not use network')}});
  assert.equal(places.length,1);
  assert.equal(places[0].latitude,9.83);
});
