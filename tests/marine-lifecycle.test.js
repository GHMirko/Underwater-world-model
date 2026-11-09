import test from 'node:test';
import assert from 'node:assert/strict';
import { LayerManager } from '../src/map/layer-manager.js';

function fakeMap() {
  const sources = new Map(), layers = new Map();
  const events = new Map();
  let sourceCreates = 0, layerCreates = 0;
  return {
    isStyleLoaded: () => true,
    getLayer: id => layers.get(id) ?? null,
    getSource: id => sources.get(id) ?? null,
    addSource(id, value) { sources.set(id, value); sourceCreates++; },
    addLayer(value) { layers.set(value.id, value); layerCreates++; },
    removeLayer(id) { layers.delete(id); },
    removeSource(id) { sources.delete(id); },
    setPaintProperty() {},
    on(name, handler) { events.set(name, handler); },
    off(name) { events.delete(name); },
    stats: () => ({ sourceCreates, layerCreates })
  };
}

test('v0.22 same requested marine mode does not recreate bathymetry layers', () => {
  const map = fakeMap();
  const manager = new LayerManager(map);
  manager.setBathymetry('aoi-adaptive');
  const initial = map.getSource('bathymetry-fallback-source');
  assert.ok(initial, 'visual context should exist without AOI numeric data');
  const initialCount = map.stats();
  manager.setBathymetry('aoi-adaptive');
  manager.restore();
  assert.equal(map.getSource('bathymetry-fallback-source'), initial);
  assert.deepEqual(map.stats(), initialCount);
  manager.setBathymetry('emodnet-rainbow');
  const rainbow = map.getSource('bathymetry-source');
  assert.ok(rainbow);
  const count = map.stats();
  manager.setBathymetry('emodnet-rainbow');
  assert.equal(map.getSource('bathymetry-source'), rainbow);
  assert.deepEqual(map.stats(), count);
  manager.setBathymetry('none');
  assert.equal(map.getLayer('bathymetry-layer'), null);
  manager.destroy();
});
