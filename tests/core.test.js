import test from 'node:test';
import assert from 'node:assert/strict';
import { aoiToGeoJSON } from '../src/map/aoi-controller.js';
import { contourThreshold, filterContours } from '../src/map/contour-model.js';
import { chartReliefExpression, legendModel } from '../src/map/depth-legend.js';
import { ASSETS, areaKm2, combinations, dominates, optimize } from '../src/optimizer/core.js';

test('AOI converts to a closed polygon', () => {
  const geo = aoiToGeoJSON({ minLon: 10, maxLon: 11, minLat: 40, maxLat: 41 });
  const ring = geo.features[0].geometry.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  assert.equal(ring.length, 5);
});

test('AOI area is positive', () => {
  assert.ok(areaKm2({ minLon: 10, maxLon: 11, minLat: 40, maxLat: 41 }) > 9000);
});

test('combination count is 2^n - 1', () => {
  assert.equal(combinations(ASSETS.slice(0, 4)).length, 15);
});

test('Pareto dominance respects min/max directions', () => {
  const a = { metrics: { coverage: 90, time: 5, energy: 4, cost: 3, robustness: 90 } };
  const b = { metrics: { coverage: 80, time: 6, energy: 5, cost: 4, robustness: 80 } };
  assert.equal(dominates(a, b), true);
  assert.equal(dominates(b, a), false);
});

test('optimizer returns ranked candidates without live bathymetry', () => {
  const ranked = optimize({
    aoi: { minLon: 10, maxLon: 10.5, minLat: 40, maxLat: 40.5 },
    bathymetry: null,
    selectedAssetIds: ASSETS.map(asset => asset.id),
    mission: 'ASW',
    maxDepth: 500
  });
  assert.ok(ranked.length > 0);
  assert.ok(ranked[0].score >= ranked.at(-1).score);
});

test('adaptive contour threshold becomes finer with zoom', () => {
  assert.equal(contourThreshold(5.5), 1000);
  assert.equal(contourThreshold(8), 200);
  assert.equal(contourThreshold(11), 50);
});

test('contour filter keeps only depths allowed at current zoom', () => {
  const fc = {
    type: 'FeatureCollection',
    features: [50, 200, 500, 1000].map(depth => ({
      type: 'Feature',
      properties: { Depth: depth },
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
    }))
  };
  const filtered = filterContours(fc, 8);
  assert.deepEqual(filtered.features.map(feature => feature.properties._depth), [200, 500, 1000]);
});

test('chart relief elevation stops are strictly ascending', () => {
  const expression = chartReliefExpression();
  const elevations = [];
  for (let i = 3; i < expression.length; i += 2) elevations.push(expression[i]);
  for (let i = 1; i < elevations.length; i += 1) assert.ok(elevations[i] > elevations[i - 1]);
});

test('chart relief legend is quantitative and reports real AOI range', () => {
  const legend = legendModel('chart-relief', { min: 42.2, max: 1180.8 });
  assert.equal(legend.quantitative, true);
  assert.equal(legend.ticks[0], '0');
  assert.match(legend.range, /42–1181 m/);
});
