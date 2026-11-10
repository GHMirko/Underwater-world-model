/**
 * Presentation-only geographic coverage routing.
 * Never confuses a WMS context image with downloaded numerical bathymetry.
 *
 * Regional EMODnet bathymetry DTM coverage approximation:
 * Europe: 36W–43E, 15N–90N, plus regional Caribbean 70W–60W, 11N–19N.
 * This is a bounding box gate only, not proof of local numerical coverage.
 */
export const EMODNET_REGIONAL_BOUNDS = Object.freeze([
  Object.freeze({ id: 'EUROPEAN_SEAS', west: -36, south: 15, east: 43, north: 90 }),
  Object.freeze({ id: 'CARIBBEAN_REGIONAL', west: -70, south: 11, east: -60, north: 19 })
]);

export function normalizeMapCenter(center) {
  const lon = center?.lng ?? center?.lon ?? center?.longitude;
  const lat = center?.lat ?? center?.latitude;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  // MapLibre may return unwrapped longitude after several world rotations.
  const longitude = ((lon + 180) % 360 + 360) % 360 - 180;
  return { longitude, latitude: lat };
}

export function regionalBathymetryRegion(center) {
  const loc = normalizeMapCenter(center);
  if (!loc) return null;
  return EMODNET_REGIONAL_BOUNDS.find(region =>
    loc.longitude >= region.west && loc.longitude <= region.east &&
    loc.latitude >= region.south && loc.latitude <= region.north
  )?.id ?? null;
}

export function automaticContextBathymetry(center) {
  // Default to global when the geographic focus cannot be validated.
  return regionalBathymetryRegion(center) ? 'emodnet-multicolour' : 'gebco-global';
}

export function contextDisplayDescription(mode, center) {
  const effective = mode === 'aoi-adaptive' ? automaticContextBathymetry(center) : mode;
  if (effective === 'emodnet-multicolour' || effective === 'emodnet-rainbow') {
    return {
      provider: 'EMODnet',
      title: 'EMODnet regional bathymetry · context only',
      status: regionalBathymetryRegion(center) ? 'REGIONAL_COVERAGE_CANDIDATE' : 'OUTSIDE_REGIONAL_COVERAGE',
      numerical: false
    };
  }
  if (effective === 'gebco-global') {
    return {
      provider: 'GEBCO',
      title: 'GEBCO 2026 global shaded relief · context only',
      status: 'GLOBAL_WMS_CANDIDATE',
      numerical: false
    };
  }
  return { provider: null, title: 'Bathymetry disabled', status: 'OFF', numerical: false };
}
