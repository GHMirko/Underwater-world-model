import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldModelPackage } from '../src/data/world-model-package.js';

const state = {
  mission: 'ASW',
  aoi: { minLon: 9.85, minLat: 44.08, maxLon: 9.87, maxLat: 44.10 },
  bathymetryGrid: {
    source: 'REAL_EMODNET_WCS_GEOTIFF', nx: 12, ny: 8, samples: 78, total: 96,
    min: 0.5, max: 36.4, mean: 12.2, water_mask_applied: true, coastal_cells: 7, masked_land_cells: 11
  },
  bathymetryQuality: {
    confidence: 'MEDIUM', confidence_score: 0.67, coverage_ratio: 0.8125,
    native_resolution_m: 115, estimated_horizontal_uncertainty_m: 57.5,
    vertical_uncertainty_m: null, fitness_for_use: ['MISSION_PLANNING', 'PREDICTOR_BACKGROUND'],
    caution: 'Do not use as sole source for close-proximity bottom or obstacle avoidance.'
  },
  adaptiveContours: {
    derivation: 'EMODNET_WCS_NUMERIC_GRID', interval_m: 5, levels_m: [2, 5, 10, 15, 20, 25, 30, 35],
    feature_count: 14, confidence: 'MEDIUM'
  }
};

const environmentalRequest = {
  schema: 'environmental-data-request/0.3',
  geometry: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
  time: { start: '2026-11-03T15:00:00.000Z', end: '2026-11-04T15:00:00.000Z' },
  depth_m: { min: 0, max: 500 },
  spatial_profile: { target_analysis_grid_m: 25 },
  requested_variables: ['bathymetry', 'temperature', 'salinity'],
  package_plan: { gridded: 'world_model.nc' },
  validation: { environmental_state_real: false },
  derived_products: [{ id: 'sound_speed', status: 'PLANNED' }],
  source_jobs: [
    {
      id: 'emodnet-bathymetry', provider: 'EMODnet Bathymetry', service: 'WCS',
      request_url: 'https://ows.emodnet-bathymetry.eu/wcs?service=wcs&request=getcoverage',
      native_horizontal_resolution_m: 115, source_output: { format: 'geotiff' },
      normalization_target: { format: 'netcdf', file: 'world_model.nc', variable: 'bathymetry' },
      provenance: 'EMODnet harmonised DTM'
    },
    {
      id: 'copernicus-temperature', provider: 'Copernicus Marine', execution: 'BACKEND_REQUIRED',
      variables: ['thetao'], subset: { bbox: [9.85, 44.08, 9.87, 44.10] }, output: { format: 'netcdf' },
      native_horizontal_resolution_m: 4200, provenance: 'Copernicus Mediterranean physics'
    }
  ]
};

test('World Model Package keeps analytical bathymetry separate from display surface', () => {
  const pkg = buildWorldModelPackage({ state, environmentalRequest });
  const bathy = pkg.layers.bathymetry;
  assert.equal(pkg.schema, 'underwater-world-model-aoi-package/0.1');
  assert.equal(bathy.analytical_source.authoritative_for_predictors, true);
  assert.equal(bathy.analytical_source.request_url, environmentalRequest.source_jobs[0].request_url);
  assert.equal(bathy.derived_layers.display_surface.layer_class, 'DISPLAY_DERIVED');
  assert.equal(bathy.derived_layers.display_surface.predictor_input, false);
  assert.equal(bathy.standardization.preferred_gridded_exchange, 'NetCDF-CF');
  assert.equal(bathy.derived_layers.contours.predictor_input, true);
});

test('World Model Package exposes extraction jobs and predictor contracts', () => {
  const pkg = buildWorldModelPackage({ state, environmentalRequest });
  assert.equal(pkg.extraction_contract.source_jobs.length, 2);
  assert.equal(pkg.predictor_interfaces.find(item => item.id === 'sound_speed').status, 'PLANNED');
  assert.ok(pkg.predictor_interfaces.find(item => item.id === 'acoustic_propagation').inputs.includes('bathymetry'));
  assert.equal(pkg.optimizer_interface.uncertainty_aware, true);
  assert.equal(pkg.optimizer_interface.hard_constraints_are_feasibility_gates, true);
});
