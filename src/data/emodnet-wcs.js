import { fromArrayBuffer } from 'geotiff';

export const EMODNET_STANDARD_RESOLUTION_DEG = 1 / 960;
export const EMODNET_STANDARD_RESOLUTION_M = 115;

export function buildEmodnetWcsUrl(aoi, resolution = EMODNET_STANDARD_RESOLUTION_DEG) {
  const params = new URLSearchParams({
    service: 'WCS',
    version: '1.0.0',
    request: 'GetCoverage',
    coverage: 'emodnet:mean',
    crs: 'EPSG:4326',
    BBOX: `${aoi.minLon},${aoi.minLat},${aoi.maxLon},${aoi.maxLat}`,
    format: 'image/tiff',
    interpolation: 'nearest',
    resx: String(resolution),
    resy: String(resolution)
  });
  return `https://ows.emodnet-bathymetry.eu/wcs?${params.toString()}`;
}

function finiteDepth(value, noData) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (Number.isFinite(noData) && Math.abs(numeric - noData) < 1e-9) return null;
  // EMODnet DTM convention is positive-down depth. Do not use abs(): doing so
  // can silently turn an opposite-sign/topographic value into plausible water depth.
  // Zero is retained because LAT/intertidal/shallow-water cells can legitimately
  // approach 0 m and are separated from land by the explicit no-land water mask.
  return numeric >= 0 && numeric < 12000 ? numeric : null;
}

export function rasterToBathymetryGrid({ values, width, height, bbox, noData = NaN }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error('EMODnet WCS raster dimensions are invalid');
  }
  if (!values || values.length < width * height) throw new Error('EMODnet WCS raster payload is incomplete');
  const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite) || minLon >= maxLon || minLat >= maxLat) {
    throw new Error('EMODnet WCS georeferencing is invalid');
  }

  const dx = (maxLon - minLon) / width;
  const dy = (maxLat - minLat) / height;
  const samples = [];
  const cells = [];

  for (let iy = 0; iy < height; iy += 1) {
    const north = maxLat - iy * dy;
    const south = north - dy;
    for (let ix = 0; ix < width; ix += 1) {
      const raw = values[iy * width + ix];
      const depth = finiteDepth(raw, noData);
      if (!Number.isFinite(depth)) continue;
      const west = minLon + ix * dx;
      const east = west + dx;
      const lon = (west + east) / 2;
      const lat = (south + north) / 2;
      samples.push({ lon, lat, ix, iy, depth });
      cells.push({ west, east, south, north, depth, ix, iy });
    }
  }

  if (!samples.length) throw new Error('EMODnet WCS returned no valid water-depth cells');
  const depths = samples.map(sample => sample.depth);
  return {
    nx: width,
    ny: height,
    samples,
    cells,
    total_cells: width * height,
    valid_cells: samples.length,
    min: Math.min(...depths),
    max: Math.max(...depths),
    mean: depths.reduce((sum, value) => sum + value, 0) / depths.length,
    bbox: [minLon, minLat, maxLon, maxLat]
  };
}

export async function fetchEmodnetWcsGrid(aoi, { timeoutMs = 15000, signal = null } = {}) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', relayAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildEmodnetWcsUrl(aoi), {
      signal: controller.signal,
      headers: { Accept: 'image/tiff,application/geotiff,application/octet-stream;q=0.8' }
    });
    if (!response.ok) throw new Error(`EModnet WCS HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer.byteLength) throw new Error('EModnet WCS returned an empty GeoTIFF');
    const tiff = await fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const bbox = image.getBoundingBox();
    const noDataRaw = image.getGDALNoData?.();
    const noData = noDataRaw == null ? NaN : Number(noDataRaw);
    const raster = await image.readRasters({ samples: [0], interleave: true });
    return rasterToBathymetryGrid({ values: raster, width, height, bbox, noData });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', relayAbort);
  }
}
