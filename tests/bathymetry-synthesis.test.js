import test from 'node:test';
import assert from 'node:assert/strict';
import { createBathymetryWorldModel, summarizeBathymetryWorldModel } from '../src/data/bathymetry-synthesis.js';

const aoi = { minLon: 9.85, minLat: 44.08, maxLon: 9.852, maxLat: 44.082 };

test('higher-quality local evidence wins while retaining lower-quality supporting sources', () => {
  const model = createBathymetryWorldModel({
    aoi,
    targetGridM: 50,
    evidence: [
      {
        lon: 9.851, lat: 44.081, depth_m: 12.2, source_id: 'EMODNET_STANDARD_DTM',
        source_class: 'HARMONISED_DTM', native_resolution_m: 115, confidence_score: 0.55,
        vertical_datum: 'LAT_OR_MSL_PRODUCT'
      },
      {
        lon: 9.851, lat: 44.081, depth_m: 11.8, source_id: 'LOCAL_MBES',
        source_class: 'SURVEY', native_resolution_m: 1, confidence_score: 0.95,
        horizontal_uncertainty_m: 2, vertical_uncertainty_m: 0.3, vertical_datum: 'CHART_DATUM'
      }
    ]
  });
  const populated = model.cells.filter(cell => Number.isFinite(cell.depth_m));
  assert.ok(populated.length > 0);
  const near = populated.sort((a, b) => Math.hypot(a.lon - 9.851, a.lat - 44.081) - Math.hypot(b.lon - 9.851, b.lat - 44.081))[0];
  assert.equal(near.source_id, 'LOCAL_MBES');
  assert.ok(near.supporting_sources.some(item => item.source_id === 'EMODNET_STANDARD_DTM'));
  assert.equal(model.contracts.target_grid_is_computational_not_native_resolution, true);
});

test('hydrographic constraint does not invent numeric depth when no numeric evidence exists', () => {
  const model = createBathymetryWorldModel({
    aoi,
    targetGridM: 50,
    evidence: [],
    constraints: [{
      source_id: 'ENC_DEPARE',
      type: 'DEPTH_AREA',
      bbox: [9.85, 44.08, 9.852, 44.082],
      min_depth_m: 5,
      max_depth_m: 10,
      vertical_datum: 'CHART_DATUM'
    }]
  });
  assert.equal(model.populated_cells, 0);
  assert.ok(model.cells.every(cell => cell.depth_m === null));
  assert.ok(model.cells.every(cell => cell.derivation === 'CONSTRAINT_ONLY_NO_NUMERIC_DEPTH'));
  assert.ok(model.cells.every(cell => cell.depth_bounds_m.min === 5 && cell.depth_bounds_m.max === 10));
});

test('constraint conflict degrades confidence and is machine-readable', () => {
  const model = createBathymetryWorldModel({
    aoi,
    targetGridM: 80,
    evidence: [{
      lon: 9.851, lat: 44.081, depth_m: 3,
      source_id: 'SDB', source_class: 'SATELLITE_DERIVED_BATHYMETRY',
      native_resolution_m: 10, confidence_score: 0.65, vertical_datum: 'MSL_ESTIMATED'
    }],
    constraints: [{
      source_id: 'ENC_DEPARE', bbox: [9.85, 44.08, 9.852, 44.082],
      min_depth_m: 8, max_depth_m: 15, vertical_datum: 'CHART_DATUM'
    }]
  });
  const conflict = model.cells.find(cell => cell.flags.includes('CONSTRAINT_CONFLICT'));
  assert.ok(conflict);
  assert.equal(conflict.predictor_eligible, false);
  assert.ok(conflict.confidence_score < 0.38);
  const summary = summarizeBathymetryWorldModel(model);
  assert.ok(summary.constraint_conflicts > 0);
});

test('coarse source on a fine computational grid retains native resolution and close-navigation caution', () => {
  const model = createBathymetryWorldModel({
    aoi,
    targetGridM: 20,
    evidence: [{
      lon: 9.851, lat: 44.081, depth_m: 20,
      source_id: 'EMODNET_STANDARD_DTM', source_class: 'HARMONISED_DTM',
      native_resolution_m: 115, confidence_score: 0.6, vertical_datum: 'LAT_OR_MSL_PRODUCT'
    }]
  });
  const populated = model.cells.find(cell => Number.isFinite(cell.depth_m));
  assert.ok(populated);
  assert.equal(populated.native_resolution_m, 115);
  assert.ok(populated.fitness_for_use.includes('NOT_SOLE_SOURCE_FOR_CLOSE_PROXIMITY_NAVIGATION'));
});
