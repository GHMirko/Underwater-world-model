import test from 'node:test';
import assert from 'node:assert/strict';
import { maxBathymetryDisplayZoom, bathymetryDisplayPolicy } from '../src/map/bathymetry-detail-policy.js';

const microAoi = { minLon: 9.86, maxLon: 9.865, minLat: 44.08, maxLat: 44.083 };

test('GEBCO display cap is stricter than EMODnet standard at the same latitude', () => {
  assert.ok(maxBathymetryDisplayZoom(463, 44) < maxBathymetryDisplayZoom(115, 44));
});

test('display cap grows with actually acquired HR resolution', () => {
  const standard = bathymetryDisplayPolicy({ bathyMode: 'aoi-adaptive', aoi: microAoi }, 17, 44);
  const hr = bathymetryDisplayPolicy({
    bathyMode: 'aoi-adaptive', aoi: microAoi,
    bathymetryGridSource: 'LOCAL_MBES',
    bathymetryQuality: { native_resolution_m: 2 }
  }, 17, 44);
  assert.equal(standard.limited, true);
  assert.equal(standard.spatialAdequacy, 'COARSE');
  assert.ok(hr.zoomLimit > standard.zoomLimit);
  assert.equal(hr.limited, false);
  assert.equal(hr.sourceStatus, 'ACQUIRED_NUMERIC_GRID');
});

test('discovered HR footprint alone MUST NOT raise display cap', () => {
  const state = {
    bathyMode: 'aoi-adaptive', aoi: microAoi,
    bathymetrySource: { status: 'HR_SELECTED', native_horizontal_resolution_m: 1 }
  };
  const result = bathymetryDisplayPolicy(state, 17, 44);
  assert.equal(result.sourceStatus, 'CONTEXT_ESTIMATE');
  assert.equal(result.resolutionM, 115);
  assert.equal(result.limited, true);
});

test('map navigation remains unrestricted by the display-only policy', () => {
  const result = bathymetryDisplayPolicy({ bathyMode: 'aoi-adaptive', aoi: microAoi }, 21, 44);
  assert.equal(result.limited, true);
  assert.ok(result.zoomLimit < 21);
  // No mutation of map, AOI, numeric raster or mission state by this pure policy.
});

test('display disabled when no bathymetry selected', () => {
  assert.equal(bathymetryDisplayPolicy({ bathyMode: 'none' }, 21, 44).enabled, false);
});

test('unverified context gets a fixed cap, not invented native spacing', () => {
  const result = bathymetryDisplayPolicy({ bathyMode: 'chart-relief' }, 15, 44);
  assert.equal(result.sourceStatus, 'UNKNOWN_CONTEXT');
  assert.equal(result.resolutionM, null);
  assert.equal(result.zoomLimit, 13);
  assert.equal(result.limited, true);
});
