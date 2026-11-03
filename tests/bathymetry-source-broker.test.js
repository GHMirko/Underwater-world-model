import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBathymetryDiscoveryPlan } from '../src/data/bathymetry-source-broker.js';

test('European micro-AOI keeps EMODnet standard as executable baseline while exposing higher-resolution discovery', () => {
  const plan = buildBathymetryDiscoveryPlan(
    { minLon: 9.84, minLat: 44.08, maxLon: 9.87, maxLat: 44.10 },
    { targetGridM: 25, estimatedMinDepthM: 0, estimatedMaxDepthM: 40 }
  );
  assert.equal(plan.recommended_strategy.current_executable_baseline, 'EMODNET_STANDARD_DTM');
  assert.ok(plan.recommended_strategy.primary_numeric_candidates.includes('EMODNET_HR_DTM'));
  assert.ok(plan.candidates.some(item => item.id === 'LIGURIA_PTAMC_BATHY' && item.applicability === 'POTENTIAL_COVERAGE_TEST'));
  assert.ok(plan.candidates.some(item => item.id === 'ENC_S57_S101' && item.use_class === 'CONSTRAINT'));
  assert.ok(plan.candidates.some(item => item.id === 'SENTINEL2_SDB' && item.use_class === 'CONDITIONAL'));
});

test('global AOI outside EMODnet coverage falls back to GEBCO while retaining global discovery paths', () => {
  const plan = buildBathymetryDiscoveryPlan(
    { minLon: 139.70, minLat: 35.50, maxLon: 139.90, maxLat: 35.70 },
    { targetGridM: 50 }
  );
  assert.equal(plan.recommended_strategy.current_executable_baseline, 'GEBCO_2026');
  assert.equal(plan.candidates.some(item => item.id === 'EMODNET_STANDARD_DTM'), false);
  assert.ok(plan.candidates.some(item => item.id === 'IHO_DCDB_CSB'));
  assert.ok(plan.candidates.some(item => item.id === 'SENTINEL2_SDB'));
  assert.ok(plan.candidates.some(item => item.id === 'NATIONAL_REGIONAL_OPEN_HR'));
});

test('France and Netherlands expose national high-resolution candidates without claiming coverage is already validated', () => {
  const france = buildBathymetryDiscoveryPlan({ minLon: 5.0, minLat: 43.0, maxLon: 5.2, maxLat: 43.2 });
  const nl = buildBathymetryDiscoveryPlan({ minLon: 4.2, minLat: 52.0, maxLon: 4.4, maxLat: 52.2 });
  const litto = france.candidates.find(item => item.id === 'SHOM_LITTO3D');
  const rws = nl.candidates.find(item => item.id === 'RIJKSWATERSTAAT_BATHY_1M');
  assert.ok(litto);
  assert.equal(litto.availability, 'DISCOVERY_REQUIRED');
  assert.ok(rws);
  assert.equal(rws.availability, 'DISCOVERY_REQUIRED');
});

test('analysis grid never upgrades source resolution and SDB remains conditional', () => {
  const plan = buildBathymetryDiscoveryPlan(
    { minLon: 12.0, minLat: 42.0, maxLon: 12.01, maxLat: 42.01 },
    { targetGridM: 2 }
  );
  assert.equal(plan.policy.never_infer_resolution_from_analysis_grid, true);
  const sdb = plan.candidates.find(item => item.id === 'SENTINEL2_SDB');
  assert.equal(sdb.availability, 'DERIVATION_REQUIRED');
  assert.equal(sdb.predictor, 'WITH_UNCERTAINTY');
  assert.ok(sdb.conditions.includes('clear_water'));
});
