import test from 'node:test';
import assert from 'node:assert/strict';
import { ACOUSTIC_ENVIRONMENT_INPUTS, buildBellhop3dEnvironmentInventory } from '../src/data/bellhop3d-environment.js';
import { buildCopernicusPython } from '../src/data/environmental-request.js';

const mediterranean = { minLon: 15, maxLon: 15.0047, minLat: 40, maxLat: 40.0036 };

function makePlan(aoi = mediterranean, propagationBufferM = 5000) {
  return buildBellhop3dEnvironmentInventory({
    aoi,
    startDatetime: '2026-11-09T10:00:00Z',
    endDatetime: '2026-11-09T12:00:00Z',
    minDepth: 0,
    maxDepth: 300,
    analysisGridM: 25,
    propagationBufferM
  });
}

test('Bellhop3D requires environmental sources beyond the existing bathymetry viewer', () => {
  const ids = ACOUSTIC_ENVIRONMENT_INPUTS.map(item => item.id);
  for (const id of [
    'bathymetry', 'temperature', 'salinity', 'sound_speed', 'seabed_substrate',
    'bottom_geoacoustics', 'surface_boundary', 'sea_level', 'waves', 'currents',
    'insitu_ctd_svp', 'volume_absorption'
  ]) assert.ok(ids.includes(id), id);
});

test('data packages cover propagation domain around micro-AOI, not only the visualization', () => {
  const plan = makePlan();
  assert.equal(plan.readiness.status, 'NOT_READY');
  assert.equal(plan.readiness.completed_and_validated_inputs.length, 0);
  assert.equal(plan.propagation_domain.buffer_m, 5000);
  assert.ok(plan.propagation_domain.domain_bbox[0] < plan.original_aoi.minLon);
  assert.ok(plan.propagation_domain.domain_bbox[2] > plan.original_aoi.maxLon);
  assert.ok(plan.propagation_domain.domain_bbox[3] > plan.original_aoi.maxLat);
  assert.equal(plan.environmental_request.source_jobs.length, 7);
  assert.ok(plan.inventory.every(item => item.data_status === 'NOT_ACQUIRED'));
  assert.ok(plan.derived_workflow.every(item => !['COMPUTED', 'RUN'].includes(item.status)));
  assert.equal(plan.environmental_request.validation.environmental_state_real, false);
});

test('Copernicus water-column source is coarse within a 400 m AOI; requested grid cannot upgrade it', () => {
  const plan = makePlan(mediterranean, 0);
  assert.ok(plan.readiness.blocking_gates.includes('DEFINE_SOURCE_RECEIVER_PROPAGATION_DOMAIN'));
  const t = plan.inventory.find(x => x.id === 'temperature');
  assert.equal(t.native_horizontal_resolution_m, 4200);
  assert.equal(plan.environmental_request.spatial_profile.target_analysis_grid_m, 25);
  assert.notEqual(t.validation_status, 'VALIDATED');
});

test('wave and sea level Copernicus downloads are 2D surface series and never pass depth arguments', () => {
  const plan = makePlan();
  const ssh = plan.environmental_request.source_jobs.find(j => j.id === 'copernicus-sea_level');
  const waves = plan.environmental_request.source_jobs.find(j => j.id === 'copernicus-waves');
  assert.equal(ssh.dataset_id, 'cmems_mod_med_phy-ssh_anfc_4.2km-2D_PT1H-m');
  assert.equal(waves.dataset_id, 'cmems_mod_med_wav_anfc_4.2km_PT1H-i');
  assert.deepEqual(waves.variables, ['VHM0', 'VTM02', 'VMDR']);
  assert.equal(ssh.subset.minimum_depth, undefined);
  assert.equal(waves.subset.minimum_depth, undefined);
  const script = buildCopernicusPython(plan.environmental_request);
  const waveBlock = script.split('dataset_id="cmems_mod_med_wav_anfc_4.2km_PT1H-i"')[1].split(')')[0];
  assert.ok(!waveBlock.includes('minimum_depth='));
  assert.ok(script.includes("minimum_depth=0, maximum_depth=300"));
});

test('outside Mediterranean, no invalid regional waves/SSH jobs are presented as executable', () => {
  const plan = makePlan({ minLon: 139.7, maxLon: 139.8, minLat: 35.5, maxLat: 35.6 });
  const waveJob = plan.environmental_request.source_jobs.find(j => j.id === 'copernicus-waves');
  assert.equal(waveJob.execution, 'REGIONAL_SOURCE_NOT_APPLICABLE');
  assert.equal(waveJob.dataset_id, null);
  assert.equal(plan.inventory.find(i => i.id === 'waves').acquisition_status, 'SOURCE_UNRESOLVED');
  assert.ok(plan.readiness.unresolved_source_jobs.includes('copernicus-waves'));
  const script = buildCopernicusPython(plan.environmental_request);
  assert.ok(!script.includes('cmems_mod_med_wav_anfc'));
});

test('time and propagation buffer are validated rather than guessed', () => {
  assert.throws(() => makePlan(mediterranean, -5), /non-negative/);
  assert.throws(() => makePlan(mediterranean, 1000001), /guardrail/);
  assert.throws(() => buildBellhop3dEnvironmentInventory({
    aoi: mediterranean, startDatetime: '2026-11-10', endDatetime: '2026-11-09'
  }), /End time/);
  assert.throws(() => buildBellhop3dEnvironmentInventory({
    aoi: null, startDatetime: '2026-11-09', endDatetime: '2026-11-10'
  }), /AOI/);
});
