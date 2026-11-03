const ROLE_WEIGHT = Object.freeze({
  SURVEY: 100,
  REGIONAL_HR_DTM: 92,
  COMPOSITE_HR_DTM: 90,
  HYDROGRAPHIC_SURFACE: 88,
  SATELLITE_DERIVED_BATHYMETRY: 68,
  SOUNDINGS: 62,
  HARMONISED_DTM: 58,
  GLOBAL_TERRAIN_MODEL: 35
});

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function dimensionsMeters(aoi) {
  const lat = ((aoi.minLat + aoi.maxLat) / 2) * Math.PI / 180;
  return {
    width: Math.max(1, (aoi.maxLon - aoi.minLon) * 111320 * Math.cos(lat)),
    height: Math.max(1, (aoi.maxLat - aoi.minLat) * 110540)
  };
}

function distanceMeters(a, b) {
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (a.lon - b.lon) * 111320 * Math.cos(lat);
  const dy = (a.lat - b.lat) * 110540;
  return Math.hypot(dx, dy);
}

function sourceWeight(evidence) {
  const base = Number.isFinite(evidence.priority_score)
    ? evidence.priority_score
    : ROLE_WEIGHT[evidence.source_class] ?? 50;
  const confidence = clamp01(evidence.confidence_score ?? 0.5) * 20;
  const resolution = Number.isFinite(evidence.native_resolution_m)
    ? Math.max(-12, 8 - Math.log2(Math.max(1, evidence.native_resolution_m)))
    : 0;
  return base + confidence + resolution;
}

function confidenceLabel(score) {
  if (score >= 0.82) return 'HIGH';
  if (score >= 0.62) return 'MEDIUM';
  if (score >= 0.38) return 'LOW';
  return 'VERY_LOW';
}

function fitnessForCell(cell) {
  if (!Number.isFinite(cell.depth_m)) return ['CONSTRAINT_AWARENESS_ONLY'];
  const fitness = ['SITUATIONAL_AWARENESS'];
  if (cell.confidence_score >= 0.38) fitness.push('MISSION_PLANNING_WITH_MARGIN');
  if (cell.confidence_score >= 0.55) fitness.push('PREDICTOR_BACKGROUND');
  if (cell.confidence_score >= 0.78 && (cell.native_resolution_m ?? Infinity) <= 20) {
    fitness.push('LOCAL_NAVIGATION_SUPPORT');
  }
  if ((cell.native_resolution_m ?? Infinity) > 50) {
    fitness.push('NOT_SOLE_SOURCE_FOR_CLOSE_PROXIMITY_NAVIGATION');
  }
  return fitness;
}

function contains(constraint, lon, lat) {
  if (Array.isArray(constraint.bbox) && constraint.bbox.length === 4) {
    return lon >= constraint.bbox[0] && lon <= constraint.bbox[2] && lat >= constraint.bbox[1] && lat <= constraint.bbox[3];
  }
  return false;
}

function normalizeEvidence(evidence) {
  const depth = Number(evidence.depth_m);
  if (!Number.isFinite(depth) || depth < 0) return null;
  const lon = Number(evidence.lon);
  const lat = Number(evidence.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return {
    ...evidence,
    lon,
    lat,
    depth_m: depth,
    confidence_score: clamp01(evidence.confidence_score ?? 0.5),
    native_resolution_m: Number.isFinite(Number(evidence.native_resolution_m)) ? Number(evidence.native_resolution_m) : null,
    horizontal_uncertainty_m: Number.isFinite(Number(evidence.horizontal_uncertainty_m))
      ? Number(evidence.horizontal_uncertainty_m)
      : null,
    vertical_uncertainty_m: Number.isFinite(Number(evidence.vertical_uncertainty_m))
      ? Number(evidence.vertical_uncertainty_m)
      : null
  };
}

export function createBathymetryWorldModel({
  aoi,
  targetGridM = 25,
  evidence = [],
  constraints = []
}) {
  if (!aoi) throw new Error('AOI is required');
  const gridM = Number(targetGridM);
  if (!Number.isFinite(gridM) || gridM <= 0) throw new Error('targetGridM must be positive');

  const dimensions = dimensionsMeters(aoi);
  const nx = Math.max(1, Math.ceil(dimensions.width / gridM));
  const ny = Math.max(1, Math.ceil(dimensions.height / gridM));
  const dx = (aoi.maxLon - aoi.minLon) / nx;
  const dy = (aoi.maxLat - aoi.minLat) / ny;
  const normalizedEvidence = evidence.map(normalizeEvidence).filter(Boolean);
  const cells = [];

  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const lon = aoi.minLon + (ix + 0.5) * dx;
      const lat = aoi.minLat + (iy + 0.5) * dy;
      const localConstraints = constraints.filter(item => contains(item, lon, lat));
      const candidates = normalizedEvidence
        .map(item => {
          const distance_m = distanceMeters({ lon, lat }, item);
          const influence = Math.max(
            gridM * 1.5,
            Number.isFinite(item.native_resolution_m) ? item.native_resolution_m * 1.5 : gridM * 2
          );
          return { item, distance_m, influence, rank: sourceWeight(item) - distance_m / Math.max(influence, 1) };
        })
        .filter(candidate => candidate.distance_m <= candidate.influence)
        .sort((a, b) => b.rank - a.rank);

      const primary = candidates[0] ?? null;
      const bounds = localConstraints.reduce((acc, item) => {
        const min = Number(item.min_depth_m);
        const max = Number(item.max_depth_m);
        if (Number.isFinite(min)) acc.min = acc.min == null ? min : Math.max(acc.min, min);
        if (Number.isFinite(max)) acc.max = acc.max == null ? max : Math.min(acc.max, max);
        return acc;
      }, { min: null, max: null });

      let confidence = primary?.item.confidence_score ?? 0;
      const flags = [];
      if (primary && bounds.min != null && primary.item.depth_m < bounds.min) flags.push('CONSTRAINT_CONFLICT');
      if (primary && bounds.max != null && primary.item.depth_m > bounds.max) flags.push('CONSTRAINT_CONFLICT');
      if (flags.includes('CONSTRAINT_CONFLICT')) confidence *= 0.55;

      const derivation = primary
        ? (primary.distance_m <= gridM * 0.55 ? 'DIRECT_OR_CELL_NEAREST_EVIDENCE' : 'NEAREST_EVIDENCE_RESAMPLING')
        : (localConstraints.length ? 'CONSTRAINT_ONLY_NO_NUMERIC_DEPTH' : 'NO_DATA');

      const cell = {
        ix,
        iy,
        lon,
        lat,
        depth_m: primary?.item.depth_m ?? null,
        source_id: primary?.item.source_id ?? null,
        source_class: primary?.item.source_class ?? null,
        native_resolution_m: primary?.item.native_resolution_m ?? null,
        vertical_datum: primary?.item.vertical_datum ?? null,
        derivation,
        horizontal_uncertainty_m: primary
          ? Math.max(primary.distance_m, primary.item.horizontal_uncertainty_m ?? 0, (primary.item.native_resolution_m ?? 0) / 2)
          : null,
        vertical_uncertainty_m: primary?.item.vertical_uncertainty_m ?? null,
        confidence_score: confidence,
        confidence: confidenceLabel(confidence),
        depth_bounds_m: bounds,
        supporting_sources: candidates.slice(1, 5).map(candidate => ({
          source_id: candidate.item.source_id,
          source_class: candidate.item.source_class,
          distance_m: candidate.distance_m,
          confidence_score: candidate.item.confidence_score
        })),
        constraints: localConstraints.map(item => ({
          source_id: item.source_id ?? null,
          type: item.type ?? 'HYDROGRAPHIC_CONSTRAINT',
          min_depth_m: Number.isFinite(Number(item.min_depth_m)) ? Number(item.min_depth_m) : null,
          max_depth_m: Number.isFinite(Number(item.max_depth_m)) ? Number(item.max_depth_m) : null,
          vertical_datum: item.vertical_datum ?? null
        })),
        flags,
        predictor_eligible: Boolean(primary) && confidence >= 0.38
      };
      cell.fitness_for_use = fitnessForCell(cell);
      cells.push(cell);
    }
  }

  const populated = cells.filter(cell => Number.isFinite(cell.depth_m));
  const confidenceCounts = cells.reduce((acc, cell) => {
    acc[cell.confidence] = (acc[cell.confidence] ?? 0) + 1;
    return acc;
  }, {});

  return {
    schema: 'bathymetry-world-model-grid/0.1',
    aoi: { ...aoi },
    target_grid_m: gridM,
    nx,
    ny,
    total_cells: cells.length,
    populated_cells: populated.length,
    coverage_ratio: cells.length ? populated.length / cells.length : 0,
    source_ids: [...new Set(populated.map(cell => cell.source_id).filter(Boolean))],
    confidence_counts: confidenceCounts,
    cells,
    contracts: {
      target_grid_is_computational_not_native_resolution: true,
      no_numeric_depth_is_created_from_constraints_by_default: true,
      per_cell_lineage_required: true,
      predictor_consumes_only_predictor_eligible_cells: true,
      display_layers_are_derived_from_this_grid: true
    }
  };
}

export function summarizeBathymetryWorldModel(model) {
  const cells = model?.cells ?? [];
  const conflicts = cells.filter(cell => cell.flags?.includes('CONSTRAINT_CONFLICT')).length;
  const predictorEligible = cells.filter(cell => cell.predictor_eligible).length;
  return {
    schema: model?.schema ?? null,
    grid: model ? `${model.nx}x${model.ny}` : null,
    target_grid_m: model?.target_grid_m ?? null,
    coverage_ratio: model?.coverage_ratio ?? 0,
    source_ids: model?.source_ids ?? [],
    predictor_eligible_cells: predictorEligible,
    constraint_conflicts: conflicts,
    confidence_counts: model?.confidence_counts ?? {}
  };
}
