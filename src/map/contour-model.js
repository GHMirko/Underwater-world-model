const DEPTHS = new Set([5, 10, 20, 30, 40, 50, 100, 200, 300, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000]);

export function contourThreshold(zoom) {
  if (zoom < 5) return Infinity;
  if (zoom < 6.2) return 1000;
  if (zoom < 7.6) return 500;
  if (zoom < 9) return 200;
  if (zoom < 10.5) return 100;
  if (zoom < 12) return 50;
  if (zoom < 14) return 20;
  if (zoom < 16) return 10;
  return 5;
}

function depthFromProperties(properties = {}) {
  const preferred = ['Elevation', 'elevation', 'Depth', 'depth', 'Contour', 'contour', 'value', 'VALUE'];
  for (const key of preferred) {
    const value = Math.abs(Number(properties[key]));
    if (Number.isFinite(value) && DEPTHS.has(value)) return value;
  }
  for (const value of Object.values(properties)) {
    const depth = Math.abs(Number(value));
    if (Number.isFinite(depth) && DEPTHS.has(depth)) return depth;
  }
  return NaN;
}

export function filterContours(featureCollection, zoom) {
  const threshold = contourThreshold(zoom);
  return {
    type: 'FeatureCollection',
    features: (featureCollection?.features ?? []).flatMap(feature => {
      const depth = depthFromProperties(feature.properties);
      if (!Number.isFinite(depth) || depth < threshold) return [];
      return [{ ...feature, properties: { ...feature.properties, _depth: depth } }];
    })
  };
}


/**
 * Context-only published EMODnet isolines, never an AOI numeric extraction.
 * Preserve only levels actually returned by WFS. Unlike the old zoom cutoff,
 * do not discard coastal 50/100 m levels just because the operator is
 * browsing at regional zoom. N is a cap, not a request to invent new depths.
 */
export function selectContextContourLevels(collection, targetLevels = 8) {
  const count = Math.max(2, Math.min(30, Number.isFinite(Number(targetLevels))
    ? Math.round(Number(targetLevels)) : 8));
  const valid = (collection?.features ?? []).flatMap(feature => {
    const depth = depthFromProperties(feature.properties);
    if (!Number.isFinite(depth) || depth <= 0) return [];
    if (!['LineString','MultiLineString'].includes(feature?.geometry?.type)) return [];
    return [{ ...feature, properties: { ...feature.properties, _depth: depth,
      source: 'EMODNET_CONTOUR_WFS', layer_class: 'CONTEXT_ONLY' } }];
  });
  const levels = [...new Set(valid.map(feature => feature.properties._depth))].sort((a,b)=>a-b);
  const selected = levels.length <= count ? levels : Array.from({length:count},(_,i)=>
    levels[Math.round(i * (levels.length - 1)/(count-1))]);
  const keep = new Set(selected);
  return {
    type: 'FeatureCollection',
    features: valid.filter(feature=>keep.has(feature.properties._depth)),
    metadata: {
      role: 'CONTEXT_ONLY_NOT_AOI_DATA',
      source: 'EMODNET_CONTOUR_WFS',
      requested_levels: count,
      displayed_levels_m: selected,
      native_levels_m: levels,
      no_interpolation: true
    }
  };
}
