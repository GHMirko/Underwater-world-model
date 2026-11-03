import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdaptiveContours, chooseContourScheme } from '../src/map/local-contours.js';

test('three valid corners can produce a conservative sparse-grid contour', () => {
  const samples = [
    { ix: 0, iy: 0, lon: 10.0, lat: 40.0, depth: 5 },
    { ix: 1, iy: 0, lon: 10.01, lat: 40.0, depth: 15 },
    null,
    { ix: 0, iy: 1, lon: 10.0, lat: 40.01, depth: 20 }
  ];
  const scheme = { interval_m: 5, major_interval_m: 25, levels: [{ depth_m: 10, major: false }] };
  const result = buildAdaptiveContours({
    samples,
    nx: 2,
    ny: 2,
    scheme,
    metadata: { source: 'TEST', confidence: 'LOW', native_resolution_m: 115 }
  });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.depth_m, 10);
  assert.equal(result.features[0].properties.derivation, 'TRIANGULATED_SPARSE_NUMERIC_GRID');
  assert.equal(result.features[0].geometry.coordinates.length, 2);
});

test('adaptive scheme remains bounded for shallow water', () => {
  const scheme = chooseContourScheme(3.4, 21.1);
  assert.ok(scheme.interval_m > 0);
  assert.ok(scheme.levels.length >= 3);
  assert.ok(scheme.levels.length <= 40);
});
