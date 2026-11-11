import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmodnetWcsUrl, rasterToBathymetryGrid } from '../src/data/emodnet-wcs.js';
import { buildAdaptiveContours, chooseContourScheme } from '../src/map/local-contours.js';

const AOI = { minLon: 9.85, minLat: 44.08, maxLon: 9.87, maxLat: 44.10 };

test('EMODnet WCS URL requests the numeric mean-depth GeoTIFF for the AOI', () => {
  const url = new URL(buildEmodnetWcsUrl(AOI));
  assert.equal(url.hostname, 'ows.emodnet-bathymetry.eu');
  assert.equal(url.searchParams.get('service'), 'WCS');
  assert.equal(url.searchParams.get('request'), 'GetCoverage');
  assert.equal(url.searchParams.get('coverage'), 'emodnet:mean');
  assert.equal(url.searchParams.get('format'), 'image/tiff');
  assert.equal(url.searchParams.get('BBOX'), '9.85,44.08,9.87,44.1');
});

test('GeoTIFF raster cells become georeferenced numeric bathymetry samples', () => {
  const grid = rasterToBathymetryGrid({
    values: new Float32Array([
      4, 8, 12,
      6, -9999, 18,
      9, 15, 24
    ]),
    width: 3,
    height: 3,
    bbox: [9.0, 44.0, 9.003, 44.003],
    noData: -9999
  });
  assert.equal(grid.nx, 3);
  assert.equal(grid.ny, 3);
  assert.equal(grid.total_cells, 9);
  assert.equal(grid.valid_cells, 8);
  assert.equal(grid.min, 4);
  assert.equal(grid.max, 24);
  assert.ok(Math.abs(grid.samples[0].lon - 9.0005) < 1e-9);
  assert.ok(Math.abs(grid.samples[0].lat - 44.0025) < 1e-9);
  assert.equal(grid.samples.at(-1).depth, 24);
});

test('positive-down semantics retain zero-depth shallow cells and reject opposite-sign values', () => {
  const grid = rasterToBathymetryGrid({
    values: new Float32Array([
      0, 0.4, 1.8,
      -3, -9999, 6,
      2, 4, 8
    ]),
    width: 3,
    height: 3,
    bbox: [9.0, 44.0, 9.003, 44.003],
    noData: -9999
  });
  assert.ok(grid.samples.some(sample => sample.depth === 0));
  assert.ok(grid.samples.some(sample => Math.abs(sample.depth - 0.4) < 1e-6));
  assert.ok(!grid.samples.some(sample => sample.depth === 3));
});

test('shallow WCS grid can derive local contours below the official 50 m contour product', () => {
  const grid = rasterToBathymetryGrid({
    values: new Float32Array([
      3, 7, 12, 16,
      4, 9, 14, 19,
      6, 11, 17, 23,
      8, 13, 20, 28
    ]),
    width: 4,
    height: 4,
    bbox: [9.0, 44.0, 9.004, 44.004]
  });
  const scheme = chooseContourScheme(grid.min, grid.max);
  const contours = buildAdaptiveContours({ samples: grid.samples, nx: grid.nx, ny: grid.ny, scheme, metadata: { source: 'test' } });
  assert.ok(scheme.levels.some(level => level.depth_m < 50));
  assert.ok(contours.features.length > 0);
  assert.ok(contours.features.every(feature => feature.properties.depth_m < 50));
});

test('wide shallow AOI respects operator-selected count rather than adding undocumented extra levels', () => {
  const scheme = chooseContourScheme(0.2, 52.8, 8);
  assert.equal(scheme.requested_levels, 8);
  assert.equal(scheme.levels.length, 8);
  assert.ok(scheme.levels.every(level => level.depth_m > 0.2 && level.depth_m < 52.8));
  assert.ok(scheme.levels.some(level => level.shallow_priority));
});
