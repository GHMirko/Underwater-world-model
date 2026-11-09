import test from 'node:test';
import assert from 'node:assert/strict';
import {
  independentMapStyle, switchLandBasemap,
  LAND_LAYER_IDS, SEA_BACKGROUND_LAYER_ID, SEA_COASTLINE_SOURCE_ID
} from '../src/map/land-sea-style.js';

test('land and sea presentation have separate permanent sources and layers', () => {
  const style = independentMapStyle();
  assert.equal(style.version, 8);
  assert.equal(style.layers[1].id, LAND_LAYER_IDS.minimal);
  assert.equal(style.layers[2].id, LAND_LAYER_IDS.satellite);
  assert.equal(style.layers[3].id, SEA_BACKGROUND_LAYER_ID);
  assert.equal(style.sources[SEA_COASTLINE_SOURCE_ID].type, 'vector');
  assert.equal(style.layers[3]['source-layer'], 'water');
  assert.equal(style.layers[3].layout.visibility, 'none', 'unavailable external coastline must never block the map');
  assert.equal(style.layers[1].layout.visibility, 'visible');
  assert.equal(style.layers[2].layout.visibility, 'none');
  assert.equal(independentMapStyle('satellite').layers[2].layout.visibility, 'visible');
});

test('land switch mutates only land visibility; never sea layers or map style', () => {
  const style = independentMapStyle();
  const landState = new Map(style.layers.slice(1, 3).map(l => [l.id, l.layout.visibility]));
  const changed = [];
  const map = {
    isStyleLoaded: () => true,
    getLayer: id => style.layers.find(l => l.id === id) ?? (id === 'marine-unchanged' ? {} : null),
    getLayoutProperty: id => landState.get(id),
    setLayoutProperty: (id, prop, value) => {
      assert.equal(prop, 'visibility');
      changed.push(id);
      landState.set(id, value);
    },
    setStyle: () => { throw new Error('setStyle must not be called'); },
    addSource: () => { throw new Error('sources must stay mounted'); },
    removeSource: () => { throw new Error('sources must stay mounted'); }
  };

  assert.equal(switchLandBasemap(map, 'satellite'), true);
  assert.deepEqual(changed, [LAND_LAYER_IDS.minimal, LAND_LAYER_IDS.satellite]);
  assert.equal(landState.get(LAND_LAYER_IDS.satellite), 'visible');
  assert.equal(landState.get(LAND_LAYER_IDS.minimal), 'none');
  changed.length = 0;
  assert.equal(switchLandBasemap(map, 'satellite'), true);
  assert.deepEqual(changed, [], 'same selection is idempotent');
  assert.equal(switchLandBasemap(map, 'minimal'), true);
  assert.equal(landState.get(LAND_LAYER_IDS.satellite), 'none');
  assert.equal(landState.get(LAND_LAYER_IDS.minimal), 'visible');
  assert.equal(style.layers[3].paint['fill-color'], '#b9d8eb');
});

test('unknown land selection degrades to minimal without touching marine data', () => {
  const style = independentMapStyle('does-not-exist');
  assert.equal(style.layers[1].layout.visibility, 'visible');
  assert.equal(style.layers[2].layout.visibility, 'none');
});

test('land switching before the land layers are mounted does not change marine renderer', () => {
  const map = {
    isStyleLoaded: () => false,
    getLayer: () => null,
    setStyle: () => { throw new Error('should not reset style'); }
  };
  assert.equal(switchLandBasemap(map, 'satellite'), false);
});
