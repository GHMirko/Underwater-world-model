import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATHYMETRY,
  contourFamilyForBathymetry,
  emodnetHrBathymetryDiscoveryWfs,
  gebcoWms,
  visualBathymetryStack
} from '../src/map/config.js';

test('chart relief keeps a sea-only EMODnet visual gap-fill underneath', () => {
  assert.deepEqual(visualBathymetryStack('chart-relief'), ['emodnet-multicolour', 'chart-relief']);
  assert.equal(BATHYMETRY['emodnet-multicolour'].provider, 'emodnet');
  assert.equal(contourFamilyForBathymetry('chart-relief'), 'seascape');
});

test('direct EMODnet mode is not silently mixed with another bathymetry', () => {
  assert.deepEqual(visualBathymetryStack('emodnet-multicolour'), ['emodnet-multicolour']);
  assert.deepEqual(visualBathymetryStack('emodnet-rainbow'), ['emodnet-rainbow']);
  assert.deepEqual(visualBathymetryStack('none'), []);
});

test('HR bathymetry discovery targets the official EMODnet HR footprint layer', () => {
  const url = emodnetHrBathymetryDiscoveryWfs({ minLon: 9.8, minLat: 44.0, maxLon: 9.81, maxLat: 44.01 });
  assert.match(url, /typeName=emodnet:hr_bathymetry_area/);
  assert.match(url, /bbox=9.8,44,9.81,44.01,EPSG:4326/);
});


test('GEBCO global context uses current GEBCO_Latest WMS layer family', () => {
  assert.equal(BATHYMETRY['gebco-global'].provider, 'gebco');
  assert.equal(BATHYMETRY['gebco-global'].layer, 'GEBCO_Latest_2');
  const url = gebcoWms();
  assert.match(url, /wms\.gebco\.net\/mapserv/);
  assert.match(url, /GEBCO_Latest_2/);
  assert.match(url, /EPSG%3A3857|EPSG:3857/);
});
