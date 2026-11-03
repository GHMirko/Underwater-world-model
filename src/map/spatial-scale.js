const EARTH_RADIUS_M = 6371008.8;
const WEB_MERCATOR_METERS_PER_PIXEL_Z0 = 156543.03392804097;
const METERS_PER_DEG_LAT = 111320;

function toRad(value) {
  return value * Math.PI / 180;
}

export function distanceMeters(lon1, lat1, lon2, lat2) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function aoiDimensionsMeters(aoi) {
  if (!aoi) return null;
  const midLat = (aoi.minLat + aoi.maxLat) / 2;
  const midLon = (aoi.minLon + aoi.maxLon) / 2;
  const width = distanceMeters(aoi.minLon, midLat, aoi.maxLon, midLat);
  const height = distanceMeters(midLon, aoi.minLat, midLon, aoi.maxLat);
  return {
    width,
    height,
    area: width * height,
    minDimension: Math.min(width, height),
    maxDimension: Math.max(width, height),
    centerLat: midLat,
    centerLon: midLon
  };
}

export function recommendedZoomForAoi(aoi, targetPixels = 560, maxZoom = 22) {
  const dimensions = aoiDimensionsMeters(aoi);
  if (!dimensions || dimensions.maxDimension <= 0) return 7;
  const desiredMetersPerPixel = dimensions.maxDimension / Math.max(100, targetPixels);
  const latitudeFactor = Math.max(0.05, Math.cos(toRad(dimensions.centerLat)));
  const zoom = Math.log2((WEB_MERCATOR_METERS_PER_PIXEL_Z0 * latitudeFactor) / desiredMetersPerPixel);
  return Math.max(1, Math.min(maxZoom, zoom));
}

export function resolutionAssessment(aoi, nativeResolutionM) {
  const dimensions = aoiDimensionsMeters(aoi);
  if (!dimensions || !Number.isFinite(nativeResolutionM) || nativeResolutionM <= 0) {
    return { status: 'UNKNOWN', cellsAcrossMin: null, cellsAcrossMax: null };
  }
  const cellsAcrossMin = dimensions.minDimension / nativeResolutionM;
  const cellsAcrossMax = dimensions.maxDimension / nativeResolutionM;
  let status = 'ADEQUATE';
  if (cellsAcrossMax < 1) status = 'UNRESOLVED';
  else if (cellsAcrossMin < 4) status = 'COARSE';
  return { status, cellsAcrossMin, cellsAcrossMax };
}

export function expandAoiByMeters(aoi, bufferM) {
  if (!aoi || !Number.isFinite(bufferM) || bufferM <= 0) return { ...aoi };
  const dimensions = aoiDimensionsMeters(aoi);
  const latPad = bufferM / METERS_PER_DEG_LAT;
  const lonMetersPerDegree = METERS_PER_DEG_LAT * Math.max(0.05, Math.cos(toRad(dimensions.centerLat)));
  const lonPad = bufferM / lonMetersPerDegree;
  return {
    minLon: Math.max(-180, aoi.minLon - lonPad),
    maxLon: Math.min(180, aoi.maxLon + lonPad),
    minLat: Math.max(-85, aoi.minLat - latPad),
    maxLat: Math.min(85, aoi.maxLat + latPad)
  };
}

export function formatMeters(value) {
  if (!Number.isFinite(value)) return 'n/a';
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km`;
  if (value >= 100) return `${value.toFixed(0)} m`;
  if (value >= 10) return `${value.toFixed(1)} m`;
  return `${value.toFixed(2)} m`;
}
