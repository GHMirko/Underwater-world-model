/**
 * Nearest measured sound-speed profile for the AOI Bellhop3D workflow.
 *
 * No nearest profile is guessed: candidates must contain actual measured
 * sound-speed samples and provenance, never metadata-only station listings.
 * Screening thresholds are conservative UI defaults and NOT oceanographic
 * acceptance standards. A selected cast is not itself a TL/range prediction.
 */
export const DEFAULT_SVP_POLICY = Object.freeze({
  maxDistanceKm: 50,
  maxAgeHours: 72,
  maxFutureHours: 0,
  minimumDepthCoverageRatio: 0.8,
  maxTopSampleDepthM: 10,
  minimumValidSamples: 3
});

export const SVP_DISCOVERY_SOURCES = Object.freeze([
  Object.freeze({
    id: 'COPERNICUS_MED_INSITU',
    provider: 'Copernicus Marine In Situ TAC',
    product: 'INSITU_MED_PHYBGCWAV_DISCRETE_MYNRT_013_035',
    catalog_url: 'https://data.marine.copernicus.eu/product/INSITU_MED_PHYBGCWAV_DISCRETE_MYNRT_013_035/description',
    data_hint: 'Measured profiles with sound velocity (if available) or co-located T/S/pressure for validated derivation.',
    status: 'DISCOVERY_BACKEND_REQUIRED',
    note: 'Catalog presence does not prove a cast at the requested AOI/time.'
  }),
  Object.freeze({
    id: 'EMODNET_PHYSICS_SVP',
    provider: 'EMODnet Physics',
    catalog_url: 'https://prod-erddap.emodnet-physics.eu/erddap/index.html',
    data_hint: 'Sound-velocity profile catalogue and physics profile datasets; inspect actual coverage and variables.',
    status: 'DISCOVERY_BACKEND_REQUIRED',
    note: 'Metadata records alone are NOT a usable numeric SVP.'
  }),
  Object.freeze({
    id: 'LOCAL_SVP_CTD',
    provider: 'Mission hydrographic / CTD / sound velocity profiler',
    catalog_url: null,
    data_hint: 'Operator-provided measured SVP file with positions, dates, sound speed and depth samples.',
    status: 'LOCAL_PROFILE_IMPORT_AVAILABLE',
    note: 'Selected only after sample-level QC, depth coverage, distance and time checks.'
  })
]);

export const SVP_CANDIDATE_EXAMPLE_SCHEMA = Object.freeze({
  schema: 'svp-candidates/0.1',
  profiles: [
    {
      id: 'observed-cast-id',
      latitude: null,
      longitude: null,
      observed_at: 'ISO8601 UTC',
      source: 'measured provider / survey identifier',
      samples: [{ depth_m: null, sound_speed_m_s: null }],
      note: 'Add at least 3 actual depth/speed rows; example values are intentionally null.'
    }
  ]
});

export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return NaN;
  const toRad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * toRad / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
    Math.sin((lon2 - lon1) * toRad / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export function referencePointForSvp(aoi, sourcePosition = null) {
  if (sourcePosition) {
    if (!Number.isFinite(sourcePosition.latitude) || !Number.isFinite(sourcePosition.longitude))
      throw new Error('Source position requires valid latitude and longitude');
    return { latitude: sourcePosition.latitude, longitude: sourcePosition.longitude, kind: 'SOURCE_POSITION' };
  }
  if (!aoi || ![aoi.minLon, aoi.maxLon, aoi.minLat, aoi.maxLat].every(Number.isFinite))
    throw new Error('AOI is required for SVP matching');
  return {
    latitude: (aoi.minLat + aoi.maxLat) / 2,
    longitude: (aoi.minLon + aoi.maxLon) / 2,
    kind: 'AOI_CENTER_PENDING_SOURCE_POSITION'
  };
}

function parseTime(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function assessSvpCandidate(candidate, {
  referencePoint,
  simulationTime,
  requiredDepthM,
  policy = DEFAULT_SVP_POLICY
}) {
  const reasons = [];
  const latitude = Number(candidate?.latitude);
  const longitude = Number(candidate?.longitude);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180) reasons.push('INVALID_POSITION');
  const observedMs = parseTime(candidate?.observed_at);
  const simulatedMs = parseTime(simulationTime);
  if (observedMs === null || simulatedMs === null) reasons.push('INVALID_TIME');
  if (!candidate?.id || typeof candidate.id !== 'string') reasons.push('MISSING_CAST_ID');
  if (!candidate?.source || typeof candidate.source !== 'string') reasons.push('MISSING_PROVENANCE');

  const samples = Array.isArray(candidate?.samples) ? candidate.samples : [];
  const validSamples = samples.map(row => ({
    depth_m: Number(row?.depth_m),
    sound_speed_m_s: Number(row?.sound_speed_m_s)
  })).filter(row => Number.isFinite(row.depth_m) && row.depth_m >= 0 &&
    Number.isFinite(row.sound_speed_m_s) && row.sound_speed_m_s >= 1350 && row.sound_speed_m_s <= 1650
  ).sort((a, b) => a.depth_m - b.depth_m);
  if (validSamples.length < policy.minimumValidSamples) reasons.push('INSUFFICIENT_VALID_SAMPLES');
  if (validSamples.some((row, index) => index > 0 && row.depth_m <= validSamples[index - 1].depth_m))
    reasons.push('DUPLICATE_DEPTH_LEVELS');

  const topDepthM = validSamples.length ? validSamples[0].depth_m : null;
  const bottomDepthM = validSamples.length ? validSamples.at(-1).depth_m : null;
  if (topDepthM === null || topDepthM > policy.maxTopSampleDepthM) reasons.push('MISSING_NEAR_SURFACE');
  if (!Number.isFinite(requiredDepthM) || requiredDepthM <= 0) reasons.push('INVALID_REQUIRED_DEPTH');
  const depthCoverageRatio = bottomDepthM !== null && Number.isFinite(requiredDepthM) && requiredDepthM > 0
    ? Math.min(1, bottomDepthM / requiredDepthM) : 0;
  if (depthCoverageRatio < policy.minimumDepthCoverageRatio) reasons.push('INSUFFICIENT_DEPTH_COVERAGE');

  const distanceKm = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? haversineDistanceKm(referencePoint.latitude, referencePoint.longitude, latitude, longitude) : null;
  const ageHours = observedMs !== null && simulatedMs !== null
    ? (simulatedMs - observedMs) / 3600000 : null;
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm > policy.maxDistanceKm)
    reasons.push('OUTSIDE_DISTANCE_LIMIT');
  if (ageHours === null || ageHours > policy.maxAgeHours || ageHours < -policy.maxFutureHours)
    reasons.push('OUTSIDE_TEMPORAL_WINDOW');

  return {
    id: candidate?.id ?? null,
    source: candidate?.source ?? null,
    observed_at: candidate?.observed_at ?? null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    distance_km: distanceKm,
    age_hours: ageHours,
    top_sample_depth_m: topDepthM,
    bottom_sample_depth_m: bottomDepthM,
    depth_coverage_ratio: depthCoverageRatio,
    valid_samples: validSamples.length,
    status: reasons.length ? 'REJECTED' : 'ELIGIBLE',
    reasons,
    // Return numeric samples of the selected cast so the next stage can build
    // a validated SSP. Do not modify original observations or extrapolate.
    samples: validSamples
  };
}

export function selectNearestMeasuredSvp({
  aoi,
  sourcePosition = null,
  simulationTime,
  requiredDepthM,
  candidates = [],
  policy = DEFAULT_SVP_POLICY
}) {
  if (!Array.isArray(candidates)) throw new Error('SVP candidates must be an array');
  if (!Number.isFinite(Number(requiredDepthM)) || Number(requiredDepthM) <= 0)
    throw new Error('Positive required water depth is needed for SVP selection');
  const ref = referencePointForSvp(aoi, sourcePosition);
  const evaluations = candidates.map(c => assessSvpCandidate(c, {
    referencePoint: ref,
    simulationTime,
    requiredDepthM: Number(requiredDepthM),
    policy
  }));
  const viable = evaluations.filter(c => c.status === 'ELIGIBLE').sort((a, b) =>
    a.distance_km - b.distance_km ||
    Math.abs(a.age_hours) - Math.abs(b.age_hours) ||
    b.depth_coverage_ratio - a.depth_coverage_ratio
  );

  return {
    schema: 'nearest-svp-selection/0.1',
    reference_point: ref,
    simulation_time_utc: simulationTime,
    target_water_depth_m: Number(requiredDepthM),
    policy: { ...policy },
    evaluated_profiles: evaluations,
    selected_cast: viable[0] ?? null,
    selection_status: viable.length ? 'MEASURED_SVP_SELECTED_PENDING_VALIDATION' : 'NO_ELIGIBLE_MEASURED_SVP',
    fallback: viable.length ? null : 'DERIVE_MODEL_SVP_FROM_COPERNICUS_T_S_PENDING_VALIDATION',
    note: viable.length
      ? 'Nearest eligible measured cast, not yet extrapolated or validated for the full propagation domain.'
      : 'No measured SVP passes distance/time/depth QC. Do not silently use a remote/stale profile.'
  };
}

export function makeSvpForecastAdaptationPlan(selection) {
  const cast = selection?.selected_cast;
  return {
    schema: 'svp-forecast-adaptation/0.1',
    mode: cast ? 'NEAREST_OBSERVED_PROFILE_AS_LOCAL_ANCHOR' : 'MODEL_DERIVED_SVP_FALLBACK_PENDING_VALIDATION',
    source_cast_id: cast?.id ?? null,
    source_cast_distance_km: cast?.distance_km ?? null,
    method: cast
      ? 'Use observed c(z) as local anchor. Compare with concurrent background-model SSP at cast location, calculate depth-dependent delta-c(z), propagate correction only inside a validated spatial/temporal radius. If spatial variability is unresolved, use a single range-independent SSP with explicit uncertainty.'
      : 'Obtain and validate numerical T/S/pressure, derive c(z) from an approved seawater equation. Do not claim a measured local SVP.',
    delta_c_formula: 'delta_c(z)=c_measured_at_cast(z,t_obs)-c_model_at_cast(z,t_obs)',
    corrected_field_formula: 'c_corrected(x,y,z,t)=c_model(x,y,z,t)+w(x,y,t)*delta_c(z)',
    weight_policy: 'NOT_SPECIFIED_REQUIRES_SPATIOTEMPORAL_VALIDATION',
    boundary_extrapolation: 'PROHIBITED_WITHOUT_DECLARED_MODEL_AND_QA',
    bellhop_run: 'NOT_RUN',
    transmission_loss: 'NOT_COMPUTED',
    propagation_range: 'NOT_COMPUTED',
    detection_range: 'UNDEFINED_WITHOUT_SENSOR_AND_DETECTION_CRITERION',
    note: 'Never rescale nominal range from one scalar sound-speed value. Re-run Bellhop3D TL on the updated environment, then apply sensor-specific acoustic budget and detection criterion.'
  };
}
