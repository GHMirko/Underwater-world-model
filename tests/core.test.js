import test from 'node:test';
import assert from 'node:assert/strict';
import { aoiToGeoJSON } from '../src/map/aoi-controller.js';
import { BATHYMETRY, contourFamilyForBathymetry } from '../src/map/config.js';
import { contourThreshold, filterContours } from '../src/map/contour-model.js';
import { chartReliefExpression, legendModel } from '../src/map/depth-legend.js';
import { aoiDimensionsMeters, expandAoiByMeters, recommendedZoomForAoi, resolutionAssessment } from '../src/map/spatial-scale.js';
import { buildCopernicusPython, buildEmodnetBathymetryUrl, buildEnvironmentalRequest, estimateBathymetryCells } from '../src/data/environmental-request.js';
import { ENVIRONMENT_VARIABLES } from '../src/data/source-registry.js';
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

test('viewer bathymetry separates AOI numeric mode from context WMS and source-matches contours', () => {
  assert.deepEqual(Object.keys(BATHYMETRY), ['aoi-adaptive', 'chart-relief', 'emodnet-rainbow', 'emodnet-multicolour', 'none']);
  assert.equal(BATHYMETRY['aoi-adaptive'].numeric, true);
  assert.equal(contourFamilyForBathymetry('aoi-adaptive'), 'none');
  assert.equal(contourFamilyForBathymetry('chart-relief'), 'seascape');
  assert.equal(contourFamilyForBathymetry('emodnet-rainbow'), 'emodnet');
  assert.equal(contourFamilyForBathymetry('emodnet-multicolour'), 'emodnet');
  assert.equal(contourFamilyForBathymetry('none'), 'none');
  const expression = chartReliefExpression();
  assert.equal(expression.at(-1), 'rgba(0,0,0,0)');
});

test('AOI adaptive legend uses real min-max as quantitative colour limits', () => {
  const legend = legendModel('aoi-adaptive', { min: 3.4, max: 21.1 });
  assert.equal(legend.quantitative, true);
  assert.equal(legend.ticks[0], '3.4');
  assert.equal(legend.ticks.at(-1), '21.1');
  assert.match(legend.range, /3\.4–21\.1 m/);
  assert.equal(legendModel('aoi-adaptive', null), null);
});

test('chart relief legend remains quantitative context and reports AOI reference range', () => {
  const legend = legendModel('chart-relief', { min: 42.2, max: 1180.8 });
  assert.equal(legend.quantitative, true);
  assert.equal(legend.ticks[0], '0');
  assert.match(legend.range, /42–1181 m/);
});

test('environment registry maps Mediterranean 3D hourly temperature salinity and currents', () => {
  assert.equal(ENVIRONMENT_VARIABLES.temperature.datasetId, 'cmems_mod_med_phy-tem_anfc_4.2km-3D_PT1H-m');
  assert.equal(ENVIRONMENT_VARIABLES.salinity.datasetId, 'cmems_mod_med_phy-sal_anfc_4.2km-3D_PT1H-m');
  assert.equal(ENVIRONMENT_VARIABLES.currents.datasetId, 'cmems_mod_med_phy-cur_anfc_4.2km-3D_PT1H-m');
  assert.deepEqual(ENVIRONMENT_VARIABLES.currents.variables, ['uo', 'vo']);
  assert.equal(ENVIRONMENT_VARIABLES.currents.nativeHorizontalResolutionM, 4200);
  assert.equal(ENVIRONMENT_VARIABLES.bathymetry.nativeHorizontalResolutionM, 115);
});

test('environmental request resolves source jobs and plans sound speed only from T and S', () => {
  const request = buildEnvironmentalRequest({
    aoi: { minLon: 15, maxLon: 16, minLat: 38, maxLat: 39 },
    startDatetime: '2026-10-28T16:00',
    endDatetime: '2026-10-29T16:00',
    minDepth: 0,
    maxDepth: 500,
    analysisGridM: 25,
    variables: ['temperature', 'salinity', 'currents', 'bathymetry', 'seabed_substrate']
  });
  assert.equal(request.source_jobs.length, 5);
  assert.deepEqual(request.bbox, [15, 38, 16, 39]);
  assert.equal(request.spatial_profile.target_analysis_grid_m, 25);
  assert.equal(request.package_plan.gridded, 'environment.nc');
  assert.equal(request.package_plan.seabedVector, 'seabed.geojson');
  assert.equal(request.derived_products[0].id, 'sound_speed');
  assert.equal(request.validation.environmental_state_real, false);
});

test('EMODnet bathymetry job is a numeric WCS subset and grid estimate is bounded', () => {
  const aoi = { minLon: 15, maxLon: 15.1, minLat: 38, maxLat: 38.1 };
  const url = buildEmodnetBathymetryUrl(aoi);
  assert.match(url, /coverage=emodnet%3Amean/);
  assert.match(url, /BBOX=15%2C38%2C15.1%2C38.1/);
  const grid = estimateBathymetryCells(aoi);
  assert.ok(grid.cells > 0);
  assert.ok(grid.cells < 20000);
});

test('generated Copernicus worker script contains no credentials and uses resolved datasets', () => {
  const request = buildEnvironmentalRequest({
    aoi: { minLon: 15, maxLon: 16, minLat: 38, maxLat: 39 },
    startDatetime: '2026-10-28T16:00',
    endDatetime: '2026-10-29T16:00',
    minDepth: 0,
    maxDepth: 300,
    variables: ['temperature', 'salinity', 'currents']
  });
  const script = buildCopernicusPython(request);
  assert.match(script, /copernicusmarine\.subset/);
  assert.match(script, /cmems_mod_med_phy-tem_anfc_4\.2km-3D_PT1H-m/);
  assert.doesNotMatch(script.toLowerCase(), /password|username|token/);
});

test('400 m micro-AOI recommends zoom beyond 16 and exposes source resolution limits', () => {
  const aoi = { minLon: 15, maxLon: 15.0047, minLat: 40, maxLat: 40.0036 };
  const dimensions = aoiDimensionsMeters(aoi);
  assert.ok(dimensions.width > 350 && dimensions.width < 450);
  assert.ok(dimensions.height > 350 && dimensions.height < 450);
  assert.ok(recommendedZoomForAoi(aoi) > 16);
  assert.equal(resolutionAssessment(aoi, 4200).status, 'UNRESOLVED');
  assert.equal(resolutionAssessment(aoi, 115).status, 'COARSE');
});

test('micro-AOI Copernicus jobs fetch context while preserving target AOI and target grid', () => {
  const aoi = { minLon: 15, maxLon: 15.0047, minLat: 40, maxLat: 40.0036 };
  const request = buildEnvironmentalRequest({
    aoi,
    startDatetime: '2026-10-28T16:00',
    endDatetime: '2026-10-29T16:00',
    minDepth: 0,
    maxDepth: 300,
    analysisGridM: 20,
    variables: ['temperature', 'bathymetry']
  });
  const temperature = request.source_jobs.find(job => job.id === 'copernicus-temperature');
  assert.equal(temperature.spatial_adequacy.status, 'UNRESOLVED');
  assert.ok(temperature.context_buffer_m > 4000);
  assert.ok(temperature.subset.bbox[0] < aoi.minLon);
  assert.ok(temperature.subset.bbox[2] > aoi.maxLon);
  assert.deepEqual(temperature.subset.target_aoi_bbox, request.bbox);
  assert.equal(request.spatial_profile.target_analysis_grid_m, 20);
  const expanded = expandAoiByMeters(aoi, 1000);
  assert.ok(expanded.minLon < aoi.minLon && expanded.maxLat > aoi.maxLat);
});
