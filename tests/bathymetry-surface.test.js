import test from 'node:test';
import assert from 'node:assert/strict';
import { colorForDepth, interpolateBathymetrySurface } from '../src/map/bathymetry-surface.js';

test('adaptive display colour is bounded by AOI min/max', () => {
  const shallow = colorForDepth(0, 0, 40);
  const middle = colorForDepth(20, 0, 40);
  const deep = colorForDepth(40, 0, 40);
  assert.equal(shallow.length, 3);
  assert.equal(middle.length, 3);
  assert.equal(deep.length, 3);
  assert.notDeepEqual(shallow, deep);
});

test('numeric grid becomes a continuous RGBA display surface without changing analytical source', () => {
  const samples = [];
  for (let iy = 0; iy < 3; iy += 1) {
    for (let ix = 0; ix < 3; ix += 1) samples.push({ ix, iy, lon: ix + 0.5, lat: 2.5 - iy, depth: 2 + ix * 4 + iy * 3 });
  }
  const surface = interpolateBathymetrySurface({ nx: 3, ny: 3, samples, bbox: [0, 0, 3, 3], min: 2, max: 16 }, { width: 128, height: 128 });
  assert.equal(surface.width, 128);
  assert.equal(surface.height, 128);
  assert.equal(surface.rgba.length, 128 * 128 * 4);
  assert.ok(surface.rendered_pixels > 10000);
  assert.equal(surface.derivation, 'DISPLAY_INTERPOLATION_FROM_NUMERIC_GRID');
  assert.equal(surface.analytical_source_unchanged, true);
});

test('missing coastal support remains transparent instead of inventing a full bathymetry tile', () => {
  const samples = [
    { ix: 0, iy: 0, lon: 0.5, lat: 1.5, depth: 2 },
    { ix: 1, iy: 0, lon: 1.5, lat: 1.5, depth: 4 },
    { ix: 0, iy: 1, lon: 0.5, lat: 0.5, depth: 3 }
  ];
  const surface = interpolateBathymetrySurface({ nx: 2, ny: 2, samples, bbox: [0, 0, 2, 2], min: 2, max: 4 }, { width: 128, height: 128 });
  const transparent = Array.from({ length: 128 * 128 }, (_, index) => surface.rgba[index * 4 + 3]).filter(alpha => alpha === 0).length;
  assert.ok(transparent > 0);
  assert.ok(surface.uncertain_pixels > 0);
});
