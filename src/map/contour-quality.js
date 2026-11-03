function pointKey(point, decimals = 7) {
  return `${Number(point?.[0]).toFixed(decimals)},${Number(point?.[1]).toFixed(decimals)}`;
}

function sameEndpoint(a, b) {
  return pointKey(a) === pointKey(b);
}

function mergeIntoChain(chain, segment) {
  const first = chain[0];
  const last = chain[chain.length - 1];
  const a = segment[0];
  const b = segment[segment.length - 1];

  if (sameEndpoint(last, a)) return [...chain, ...segment.slice(1)];
  if (sameEndpoint(last, b)) return [...chain, ...segment.slice(0, -1).reverse()];
  if (sameEndpoint(first, b)) return [...segment.slice(0, -1), ...chain];
  if (sameEndpoint(first, a)) return [...segment.slice(1).reverse(), ...chain];
  return null;
}

export function stitchContourSegments(featureCollection) {
  const features = featureCollection?.features ?? [];
  const groups = new Map();

  for (const feature of features) {
    const coords = feature?.geometry?.type === 'LineString' ? feature.geometry.coordinates : null;
    if (!coords || coords.length < 2) continue;
    const p = feature.properties ?? {};
    const key = [p.depth_m, Boolean(p.major), p.source ?? '', p.confidence ?? ''].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature);
  }

  const stitched = [];
  for (const group of groups.values()) {
    const remaining = group.map(feature => ({
      properties: { ...(feature.properties ?? {}) },
      coordinates: feature.geometry.coordinates.map(point => [...point])
    }));

    while (remaining.length) {
      const seed = remaining.shift();
      let chain = seed.coordinates;
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < remaining.length; i += 1) {
          const merged = mergeIntoChain(chain, remaining[i].coordinates);
          if (!merged) continue;
          chain = merged;
          remaining.splice(i, 1);
          changed = true;
          break;
        }
      }
      stitched.push({
        type: 'Feature',
        properties: { ...seed.properties, stitched: true, stitched_vertices: chain.length },
        geometry: { type: 'LineString', coordinates: chain }
      });
    }
  }

  return { type: 'FeatureCollection', features: stitched };
}

export function contourDisplayAssessment(summary, options = {}) {
  const minCoverage = Number.isFinite(options.minCoverage) ? options.minCoverage : 0.45;
  const minLevels = Number.isFinite(options.minLevels) ? options.minLevels : 2;
  const minFeatures = Number.isFinite(options.minFeatures) ? options.minFeatures : 2;
  const coverage = Number(summary?.coverage_ratio ?? 0);
  const levels = Array.isArray(summary?.levels_m) ? summary.levels_m.length : 0;
  const features = Number(summary?.feature_count ?? 0);

  const reasons = [];
  if (coverage < minCoverage) reasons.push(`coverage ${(coverage * 100).toFixed(0)}% < ${(minCoverage * 100).toFixed(0)}%`);
  if (levels < minLevels) reasons.push(`${levels} contour levels < ${minLevels}`);
  if (features < minFeatures) reasons.push(`${features} contour features < ${minFeatures}`);

  const ready = reasons.length === 0;
  return {
    ready,
    coverage_ratio: coverage,
    levels,
    features,
    min_coverage: minCoverage,
    reason: ready ? 'local contour layer accepted' : reasons.join(' · ')
  };
}
