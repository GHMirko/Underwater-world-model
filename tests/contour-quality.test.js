import test from 'node:test';
import assert from 'node:assert/strict';
import { contourDisplayAssessment, stitchContourSegments } from '../src/map/contour-quality.js';

test('low-coverage contour fragments are not promoted to an operational local layer', () => {
  const assessment = contourDisplayAssessment({
    feature_count: 3,
    levels_m: [10, 20, 30],
    coverage_ratio: 0.23
  });
  assert.equal(assessment.ready, false);
  assert.match(assessment.reason, /coverage 23%/);
});

test('adequately supported local contours pass the display gate', () => {
  const assessment = contourDisplayAssessment({
    feature_count: 5,
    levels_m: [10, 20, 30],
    coverage_ratio: 0.72
  });
  assert.equal(assessment.ready, true);
});

test('adjacent marching-square segments at the same depth are stitched into a continuous polyline', () => {
  const input = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { depth_m: 20, major: true, source: 'TEST', confidence: 'MEDIUM' }, geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] } },
      { type: 'Feature', properties: { depth_m: 20, major: true, source: 'TEST', confidence: 'MEDIUM' }, geometry: { type: 'LineString', coordinates: [[2, 2], [3, 2.5]] } },
      { type: 'Feature', properties: { depth_m: 20, major: true, source: 'TEST', confidence: 'MEDIUM' }, geometry: { type: 'LineString', coordinates: [[3, 2.5], [4, 3]] } }
    ]
  };
  const output = stitchContourSegments(input);
  assert.equal(output.features.length, 1);
  assert.deepEqual(output.features[0].geometry.coordinates, [[1, 1], [2, 2], [3, 2.5], [4, 3]]);
  assert.equal(output.features[0].properties.stitched, true);
});
