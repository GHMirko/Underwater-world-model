import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectNearestMeasuredSvp,
  makeSvpForecastAdaptationPlan,
  haversineDistanceKm
} from '../src/data/nearest-svp.js';
import { buildBellhop3dEnvironmentInventory } from '../src/data/bellhop3d-environment.js';

const aoi = { minLon: 15, maxLon: 15.01, minLat: 40, maxLat: 40.01 };
const time = '2026-11-09T12:00:00Z';
const samples = [
  { depth_m: 0, sound_speed_m_s: 1508 },
  { depth_m: 25, sound_speed_m_s: 1505 },
  { depth_m: 50, sound_speed_m_s: 1502 },
  { depth_m: 100, sound_speed_m_s: 1503 }
];
function cast(id, lat, lon, observed, s = samples) {
  return { id, latitude: lat, longitude: lon, observed_at: observed, samples: s, source: 'measured survey' };
}
function select(candidates, requiredDepthM = 100) {
  return selectNearestMeasuredSvp({ aoi, simulationTime: time, requiredDepthM, candidates });
}

test('nearest eligible measured SVP is selected by geographic distance, not upload order', () => {
  const candidates = [
    cast('far', 40.2, 15.12, '2026-11-09T11:00:00Z'),
    cast('near', 40.006, 15.004, '2026-11-09T10:00:00Z'),
    cast('mid', 40.05, 15.04, '2026-11-09T10:00:00Z')
  ];
  const result = select(candidates);
  assert.equal(result.selection_status, 'MEASURED_SVP_SELECTED_PENDING_VALIDATION');
  assert.equal(result.selected_cast.id, 'near');
  assert.ok(result.selected_cast.distance_km < 1);
  assert.equal(result.selected_cast.depth_coverage_ratio, 1);
  assert.ok(haversineDistanceKm(40, 15, 40, 15) < 0.001);
});

test('nearest stale or incomplete cast is rejected in favour of an eligible cast', () => {
  const result = select([
    cast('stale', 40.005, 15.005, '2026-10-15T10:00:00Z'),
    cast('shallow', 40.006, 15.006, '2026-11-09T11:00:00Z', samples.slice(0, 2)),
    cast('valid', 40.05, 15.05, '2026-11-09T11:00:00Z')
  ]);
  assert.equal(result.selected_cast.id, 'valid');
  assert.ok(result.evaluated_profiles.find(c => c.id === 'stale').reasons.includes('OUTSIDE_TEMPORAL_WINDOW'));
  assert.ok(result.evaluated_profiles.find(c => c.id === 'shallow').reasons.includes('INSUFFICIENT_DEPTH_COVERAGE'));
});

test('no nearby valid SVP does not invent observations or acoustic range', () => {
  const result = select([cast('remote', 50, 15, '2026-11-09T11:00:00Z')]);
  assert.equal(result.selected_cast, null);
  assert.equal(result.selection_status, 'NO_ELIGIBLE_MEASURED_SVP');
  const plan = makeSvpForecastAdaptationPlan(result);
  assert.equal(plan.mode, 'MODEL_DERIVED_SVP_FALLBACK_PENDING_VALIDATION');
  assert.equal(plan.transmission_loss, 'NOT_COMPUTED');
  assert.equal(plan.propagation_range, 'NOT_COMPUTED');
  assert.equal(plan.detection_range, 'UNDEFINED_WITHOUT_SENSOR_AND_DETECTION_CRITERION');
});

test('local observation anchors a correction plan without inventing a radius of influence', () => {
  const result = select([cast('local', 40.006, 15.004, '2026-11-09T11:00:00Z')]);
  const plan = makeSvpForecastAdaptationPlan(result);
  assert.equal(plan.source_cast_id, 'local');
  assert.equal(plan.weight_policy, 'NOT_SPECIFIED_REQUIRES_SPATIOTEMPORAL_VALIDATION');
  assert.equal(plan.bellhop_run, 'NOT_RUN');
  assert.match(plan.corrected_field_formula, /delta_c/);
});

test('bad coordinates, missing profile points and future casts are not accepted', () => {
  const bad = {
    ...cast('bad', 40.006, 15.004, '2026-11-10T11:00:00Z'),
    samples: [{ depth_m: null, sound_speed_m_s: 1500 }, { depth_m: 10, sound_speed_m_s: 1502 }]
  };
  const result = select([bad, cast('broken', null, null, '2026-11-09T11:00:00Z')]);
  assert.equal(result.selected_cast, null);
  assert.ok(result.evaluated_profiles[0].reasons.includes('OUTSIDE_TEMPORAL_WINDOW'));
  assert.ok(result.evaluated_profiles[1].reasons.includes('INVALID_POSITION'));
});

test('Bellhop environment manifest carries selected cast and blocks TL until physical gates pass', () => {
  const manifest = buildBellhop3dEnvironmentInventory({
    aoi, startDatetime: '2026-11-09T00:00:00Z', endDatetime: '2026-11-09T23:00:00Z',
    svpSimulationTime: time,
    svpRequiredDepthM: 100,
    svpCandidates: [cast('cast-1', 40.006, 15.004, '2026-11-09T11:00:00Z')],
    maxDepth: 150
  });
  assert.equal(manifest.nearest_svp.selected_cast.id, 'cast-1');
  assert.equal(manifest.svp_forecast_adaptation.bellhop_run, 'NOT_RUN');
  assert.ok(manifest.readiness.blocking_gates.includes('VALIDATE_NEAREST_MEASURED_SVP_AND_APPLICABILITY_TO_DOMAIN'));
  assert.equal(Date.parse(manifest.time.simulation_snapshots[0]), Date.parse(time));
  assert.equal(manifest.readiness.status, 'NOT_READY');
});

test('simulation snapshot outside data request window is rejected', () => {
  assert.throws(() => buildBellhop3dEnvironmentInventory({
    aoi, startDatetime: '2026-11-09T00:00:00Z', endDatetime: '2026-11-09T12:00:00Z',
    svpSimulationTime: '2026-11-11T00:00:00Z'
  }), /must fall within/);
});
