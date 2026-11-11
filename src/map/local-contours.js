// Requested contour levels are derived from the native numeric AOI
// min/max. They never imply new spatial information or a finer DTM.
export function normalizeContourCount(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 2 || number > 30)
    throw new Error('Numero di isobate: scegliere un intero da 2 a 30');
  return number;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function chooseContourScheme(minDepth, maxDepth, targetLines = 8) {
  const requested = normalizeContourCount(targetLines);
  const min = Number(minDepth);
  const max = Number(maxDepth);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min)
    return { interval_m: null, major_interval_m: null, requested_levels: requested, levels: [] };

  // Sample evenly across observed range, avoiding extreme end-points.
  // Use full floating-point depth to retain distinct levels in shallow AOIs.
  const interval = (max - min) / (requested + 1);
  const levels = Array.from({ length: requested }, (_, index) => {
    const depth = Number((min + interval * (index + 1)).toPrecision(12));
    return {
      depth_m: depth,
      major: index % 5 === 0 || index === requested - 1,
      shallow_priority: depth <= 5
    };
  });
  return {
    interval_m: Number(interval.toPrecision(8)),
    major_interval_m: Number((interval * 5).toPrecision(8)),
    requested_levels: requested,
    levels
  };
}

export function assessBathymetryConfidence({
  aoiWidthM,
  aoiHeightM,
  nativeResolutionM,
  validSamples,
  totalSamples,
  sourceType = 'EMODNET_STANDARD_DTM',
  derivation = 'NUMERIC_GRID'
}) {
  const coverageRatio = totalSamples > 0 ? clamp01(validSamples / totalSamples) : 0;
  const minDimension = Math.max(1, Math.min(Number(aoiWidthM) || 1, Number(aoiHeightM) || 1));
  const resolution = Number.isFinite(nativeResolutionM) && nativeResolutionM > 0 ? nativeResolutionM : minDimension;
  const cellsAcrossShortSide = minDimension / resolution;

  const sourceScore = sourceType.includes('HR') ? 0.95 : sourceType.includes('STANDARD') || sourceType.includes('REST') ? 0.68 : sourceType.includes('RENDERED') ? 0.25 : 0.5;
  const derivationScore = derivation === 'NUMERIC_GRID' ? 0.9 : derivation === 'RENDERED_INFERENCE' ? 0.25 : 0.55;
  const resolutionScore = clamp01(cellsAcrossShortSide / 6);
  const score = clamp01(0.35 * sourceScore + 0.25 * derivationScore + 0.25 * coverageRatio + 0.15 * resolutionScore);

  let confidence = 'VERY_LOW';
  if (score >= 0.78) confidence = 'HIGH';
  else if (score >= 0.56) confidence = 'MEDIUM';
  else if (score >= 0.34) confidence = 'LOW';

  let fitnessForUse;
  if (confidence === 'HIGH' && resolution <= 25) {
    fitnessForUse = ['MISSION_PLANNING', 'PREDICTOR', 'LOCAL_NAVIGATION_SUPPORT'];
  } else if (confidence === 'HIGH' || confidence === 'MEDIUM') {
    fitnessForUse = ['MISSION_PLANNING', 'PREDICTOR_BACKGROUND', 'PREDICTOR_WITH_UNCERTAINTY'];
  } else if (confidence === 'LOW') {
    fitnessForUse = ['SITUATIONAL_AWARENESS', 'COARSE_PLANNING', 'PREDICTOR_SENSITIVITY_ONLY'];
  } else {
    fitnessForUse = ['VISUAL_REFERENCE', 'REACQUIRE_DATA_TRIGGER'];
  }

  return {
    confidence,
    confidence_score: Number(score.toFixed(2)),
    coverage_ratio: Number(coverageRatio.toFixed(3)),
    cells_across_short_side: Number(cellsAcrossShortSide.toFixed(2)),
    native_resolution_m: resolution,
    estimated_horizontal_uncertainty_m: Number((resolution / 2).toFixed(1)),
    vertical_uncertainty_m: null,
    uncertainty_note: 'Horizontal uncertainty is a conservative scale proxy derived from native grid spacing; vertical uncertainty requires source metadata.',
    fitness_for_use: fitnessForUse,
    caution: confidence === 'HIGH' && resolution <= 25
      ? 'Use within mission safety envelope and source validity.'
      : 'Do not use as sole source for close-proximity bottom or obstacle avoidance.'
  };
}

function interpolatePoint(a, b, level) {
  const denominator = b.depth - a.depth;
  const t = Math.abs(denominator) < 1e-12 ? 0.5 : clamp01((level - a.depth) / denominator);
  return [a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t];
}

function segmentPairs(caseIndex, centerHigh) {
  const lookup = {
    1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]],
    6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[2, 0]],
    11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]]
  };
  if (caseIndex === 5) return centerHigh ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
  if (caseIndex === 10) return centerHigh ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]];
  return lookup[caseIndex] ?? [];
}

function propertySet(levelInfo, metadata, derivation) {
  return {
    depth_m: levelInfo.depth_m,
    major: Boolean(levelInfo.major),
    shallow_priority: Boolean(levelInfo.shallow_priority),
    layer_class: 'DERIVED',
    derivation,
    source: metadata.source ?? 'UNKNOWN',
    native_resolution_m: metadata.native_resolution_m ?? null,
    confidence: metadata.confidence ?? 'UNKNOWN',
    confidence_score: metadata.confidence_score ?? null,
    coverage_ratio: metadata.coverage_ratio ?? null,
    estimated_horizontal_uncertainty_m: metadata.estimated_horizontal_uncertainty_m ?? null,
    fitness_for_use: Array.isArray(metadata.fitness_for_use) ? metadata.fitness_for_use.join(',') : metadata.fitness_for_use ?? null,
    valid_until: metadata.valid_until ?? null,
    coastal_mask: metadata.coastal_mask ?? null
  };
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;
}

function triangleCrossing(points, level) {
  const intersections = [];
  const edges = [[0, 1], [1, 2], [2, 0]];
  for (const [ia, ib] of edges) {
    const a = points[ia];
    const b = points[ib];
    const da = a.depth - level;
    const db = b.depth - level;
    if (Math.abs(da) < 1e-12 && Math.abs(db) < 1e-12) continue;
    if ((da <= 0 && db >= 0) || (da >= 0 && db <= 0)) {
      const point = interpolatePoint(a, b, level);
      if (!intersections.some(existing => samePoint(existing, point))) intersections.push(point);
    }
  }
  return intersections.length >= 2 ? [intersections[0], intersections[1]] : null;
}

export function buildAdaptiveContours({ samples, nx, ny, scheme, metadata = {} }) {
  if (!Array.isArray(samples) || nx < 2 || ny < 2 || !scheme?.levels?.length) {
    return { type: 'FeatureCollection', features: [] };
  }
  const grid = Array.from({ length: ny }, () => Array(nx).fill(null));
  for (const sample of samples) {
    if (!sample || !Number.isInteger(sample.ix) || !Number.isInteger(sample.iy)) continue;
    if (sample.ix >= 0 && sample.ix < nx && sample.iy >= 0 && sample.iy < ny) grid[sample.iy][sample.ix] = sample;
  }

  const features = [];
  for (const levelInfo of scheme.levels) {
    const level = levelInfo.depth_m;
    for (let iy = 0; iy < ny - 1; iy += 1) {
      for (let ix = 0; ix < nx - 1; ix += 1) {
        const p00 = grid[iy][ix];
        const p10 = grid[iy][ix + 1];
        const p11 = grid[iy + 1][ix + 1];
        const p01 = grid[iy + 1][ix];
        const corners = [p00, p10, p11, p01];
        const validCorners = corners.filter(point => point && Number.isFinite(point.depth));

        if (validCorners.length === 4) {
          const caseIndex = (p00.depth >= level ? 1 : 0)
            | (p10.depth >= level ? 2 : 0)
            | (p11.depth >= level ? 4 : 0)
            | (p01.depth >= level ? 8 : 0);
          if (caseIndex === 0 || caseIndex === 15) continue;

          const edges = [
            interpolatePoint(p00, p10, level),
            interpolatePoint(p10, p11, level),
            interpolatePoint(p11, p01, level),
            interpolatePoint(p01, p00, level)
          ];
          const centerDepth = (p00.depth + p10.depth + p11.depth + p01.depth) / 4;
          for (const [a, b] of segmentPairs(caseIndex, centerDepth >= level)) {
            features.push({
              type: 'Feature',
              properties: propertySet(levelInfo, metadata, 'MARCHING_SQUARES_NUMERIC_GRID'),
              geometry: { type: 'LineString', coordinates: [edges[a], edges[b]] }
            });
          }
          continue;
        }

        // Coastal/no-data cells often retain three trustworthy water samples but
        // not a complete square. Triangulating only those observed vertices gives
        // a conservative local contour without synthesising a fourth land/no-data
        // depth. This is explicitly tagged as sparse-grid derivation.
        if (validCorners.length === 3) {
          const segment = triangleCrossing(validCorners, level);
          if (!segment) continue;
          features.push({
            type: 'Feature',
            properties: propertySet(levelInfo, metadata, 'TRIANGULATED_SPARSE_NUMERIC_GRID'),
            geometry: { type: 'LineString', coordinates: segment }
          });
        }
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

export function contourSummary(featureCollection, scheme, quality) {
  const features = featureCollection?.features ?? [];
  const levels = [...new Set(features.map(feature => feature.properties?.depth_m).filter(Number.isFinite))].sort((a, b) => a - b);
  const derivations = [...new Set(features.map(feature => feature.properties?.derivation).filter(Boolean))];
  return {
    feature_count: features.length,
    levels_m: levels,
    requested_levels: scheme?.requested_levels ?? scheme?.levels?.length ?? null,
    available_levels: levels.length,
    interval_m: scheme?.interval_m ?? null,
    major_interval_m: scheme?.major_interval_m ?? null,
    confidence: quality?.confidence ?? 'UNKNOWN',
    confidence_score: quality?.confidence_score ?? null,
    coverage_ratio: quality?.coverage_ratio ?? null,
    fitness_for_use: quality?.fitness_for_use ?? [],
    derivation: derivations.length === 1 ? derivations[0] : derivations.length > 1 ? 'MIXED_NUMERIC_GRID_CONTOURS' : 'NO_LOCAL_CONTOURS'
  };
}
