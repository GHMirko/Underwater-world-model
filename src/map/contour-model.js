const DEPTHS = new Set([50, 100, 200, 500, 1000, 2000, 5000]);

export function contourThreshold(zoom) {
  if (zoom < 5) return Infinity;
  if (zoom < 6.2) return 1000;
  if (zoom < 7.6) return 500;
  if (zoom < 9) return 200;
  if (zoom < 10.5) return 100;
  return 50;
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
