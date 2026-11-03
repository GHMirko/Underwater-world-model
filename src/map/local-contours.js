const NICE_INTERVALS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function chooseContourScheme(minDepth, maxDepth, targetLines = 8) {
  const min = Number(minDepth);
  const max = Number(maxDepth);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { interval_m: null, major_interval_m: null, levels: [] };
  }
  const span = max - min;
  const raw = span / Math.max(3, targetLines);
  const interval = NICE_INTERVALS.find(value => value >= raw) ?? NICE_INTERVALS.at(-1);
  const majorInterval = interval < 1 ? interval * 5 : interval < 10 ? interval * 5 : interval * 5;
  const first = Math.ceil(min / interval) * interval;
  const levels = [];
  for (let value = first; value <= max + interval * 1e-6 && levels.length < 40; value += interval) {
    const rounded = Number(value.toFixed(interval < 1 ? 2 : interval < 10 ? 1 : 0));
    const majorRatio = rounded / majorInterval;
    const major = Math.abs(majorRatio - Math.round(majorRatio)) < 1e-6;
    levels.push({ depth_m: rounded, major });
  }
  return { interval_m: interval, major_interval_m: majorInterval, levels };
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
        if (![p00, p10, p11, p01].every(point => point && Number.isFinite(point.depth))) continue;

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
            properties: {
              depth_m: level,
              major: Boolean(levelInfo.major),
              layer_class: 'DERIVED',
              derivation: 'MARCHING_SQUARES_NUMERIC_GRID',
              source: metadata.source ?? 'UNKNOWN',
              native_resolution_m: metadata.native_resolution_m ?? null,
              confidence: metadata.confidence ?? 'UNKNOWN',
              confidence_score: metadata.confidence_score ?? null,
              coverage_ratio: metadata.coverage_ratio ?? null,
              estimated_horizontal_uncertainty_m: metadata.estimated_horizontal_uncertainty_m ?? null,
              fitness_for_use: Array.isArray(metadata.fitness_for_use) ? metadata.fitness_for_use.join(',') : metadata.fitness_for_use ?? null,
              valid_until: metadata.valid_until ?? null
            },
            geometry: { type: 'LineString', coordinates: [edges[a], edges[b]] }
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
  return {
    feature_count: features.length,
    levels_m: levels,
    interval_m: scheme?.interval_m ?? null,
    major_interval_m: scheme?.major_interval_m ?? null,
    confidence: quality?.confidence ?? 'UNKNOWN',
    confidence_score: quality?.confidence_score ?? null,
    coverage_ratio: quality?.coverage_ratio ?? null,
    fitness_for_use: quality?.fitness_for_use ?? [],
    derivation: 'MARCHING_SQUARES_NUMERIC_GRID'
  };
}
