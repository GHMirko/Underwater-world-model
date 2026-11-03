import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmodnetWaterMaskUrl, alphaAt, waterFractionForCell, applyWaterMaskToGrid } from '../src/data/emodnet-water-mask.js';

test('water-mask URL uses EMODnet no-land multicolour WMS with transparency', () => {
  const { url } = buildEmodnetWaterMaskUrl({ minLon: 9.85, minLat: 44.08, maxLon: 9.87, maxLat: 44.10 }, 256, 256);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('layers'), 'emodnet:mean_multicolour');
  assert.equal(parsed.searchParams.get('transparent'), 'true');
  assert.equal(parsed.searchParams.get('format'), 'image/png');
});

test('alpha mask maps north-up geographic coordinates to pixels', () => {
  const mask = {
    width: 2,
    height: 2,
    bbox: [0, 0, 2, 2],
    alpha: new Uint8ClampedArray([255, 0, 0, 255])
  };
  assert.equal(alphaAt(mask, 0, 2), 255);
  assert.equal(alphaAt(mask, 2, 2), 0);
  assert.equal(alphaAt(mask, 0, 0), 0);
  assert.equal(alphaAt(mask, 2, 0), 255);
});

test('coastal mask removes land-dominated cells and flags mixed cells', () => {
  const mask = {
    width: 3,
    height: 3,
    bbox: [0, 0, 3, 3],
    alpha: new Uint8ClampedArray([
      255, 255, 0,
      255, 255, 0,
      0,   0,   0
    ])
  };
  const grid = {
    nx: 3,
    ny: 1,
    total_cells: 3,
    valid_cells: 3,
    bbox: [0, 0, 3, 1],
    samples: [
      { lon: 0.5, lat: 0.5, ix: 0, iy: 0, depth: 1.2 },
      { lon: 1.5, lat: 0.5, ix: 1, iy: 0, depth: 3.0 },
      { lon: 2.5, lat: 0.5, ix: 2, iy: 0, depth: 8.0 }
    ],
    cells: [
      { west: 0, east: 1, south: 0, north: 1, ix: 0, iy: 0, depth: 1.2 },
      { west: 1, east: 2, south: 0, north: 1, ix: 1, iy: 0, depth: 3.0 },
      { west: 2, east: 3, south: 0, north: 1, ix: 2, iy: 0, depth: 8.0 }
    ]
  };
  const fraction = waterFractionForCell(mask, grid.cells[0], 3);
  assert.ok(fraction >= 0 && fraction <= 1);
  const masked = applyWaterMaskToGrid(grid, mask, { minimumWaterFraction: 0.1, fullWaterFraction: 0.95 });
  assert.equal(masked.water_mask_applied, true);
  assert.ok(masked.valid_cells < grid.valid_cells);
  assert.ok(masked.cells.some(cell => cell.shallow_water));
  assert.ok(masked.masked_land_cells >= 1);
});
