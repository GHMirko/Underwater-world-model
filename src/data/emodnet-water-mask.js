export function buildEmodnetWaterMaskUrl(aoi, width = 512, height = null) {
  const spanLon = Math.max(1e-9, Number(aoi.maxLon) - Number(aoi.minLon));
  const spanLat = Math.max(1e-9, Number(aoi.maxLat) - Number(aoi.minLat));
  const resolvedHeight = height ?? Math.max(128, Math.min(768, Math.round(width * spanLat / spanLon)));
  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version: '1.1.1',
    layers: 'emodnet:mean_multicolour',
    styles: '',
    format: 'image/png',
    transparent: 'true',
    tiled: 'false',
    width: String(width),
    height: String(resolvedHeight),
    srs: 'EPSG:4326',
    bbox: `${aoi.minLon},${aoi.minLat},${aoi.maxLon},${aoi.maxLat}`
  });
  return {
    url: `https://ows.emodnet-bathymetry.eu/wms?${params.toString()}`,
    width,
    height: resolvedHeight,
    bbox: [Number(aoi.minLon), Number(aoi.minLat), Number(aoi.maxLon), Number(aoi.maxLat)]
  };
}

export function alphaAt(mask, lon, lat) {
  if (!mask?.alpha || !mask.width || !mask.height || !Array.isArray(mask.bbox)) return 0;
  const [minLon, minLat, maxLon, maxLat] = mask.bbox;
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return 0;
  const x = Math.max(0, Math.min(mask.width - 1, Math.round(((lon - minLon) / (maxLon - minLon)) * (mask.width - 1))));
  const y = Math.max(0, Math.min(mask.height - 1, Math.round(((maxLat - lat) / (maxLat - minLat)) * (mask.height - 1))));
  return mask.alpha[y * mask.width + x] ?? 0;
}

export function waterFractionForCell(mask, cell, subdivisions = 3) {
  if (!mask) return 1;
  const n = Math.max(2, Math.min(5, Math.round(subdivisions)));
  let wet = 0;
  let total = 0;
  for (let iy = 0; iy < n; iy += 1) {
    const lat = cell.south + ((iy + 0.5) / n) * (cell.north - cell.south);
    for (let ix = 0; ix < n; ix += 1) {
      const lon = cell.west + ((ix + 0.5) / n) * (cell.east - cell.west);
      if (alphaAt(mask, lon, lat) >= 24) wet += 1;
      total += 1;
    }
  }
  return total ? wet / total : 0;
}

export function applyWaterMaskToGrid(grid, mask, {
  minimumWaterFraction = 0.34,
  fullWaterFraction = 0.82
} = {}) {
  if (!grid?.cells?.length || !grid?.samples?.length || !mask) {
    return { ...grid, water_mask_applied: false, coastal_cells: 0, masked_land_cells: 0 };
  }

  const sampleByKey = new Map(grid.samples.map(sample => [`${sample.ix}:${sample.iy}`, sample]));
  const samples = [];
  const cells = [];
  let coastalCells = 0;
  let maskedLandCells = 0;

  for (const cell of grid.cells) {
    const fraction = waterFractionForCell(mask, cell, 3);
    if (fraction < minimumWaterFraction) {
      maskedLandCells += 1;
      continue;
    }
    const sample = sampleByKey.get(`${cell.ix}:${cell.iy}`);
    if (!sample) continue;
    const coastalUncertain = fraction < fullWaterFraction;
    if (coastalUncertain) coastalCells += 1;
    const enriched = {
      ...sample,
      water_fraction: Number(fraction.toFixed(3)),
      coastal_uncertain: coastalUncertain,
      shallow_water: sample.depth <= 5
    };
    samples.push(enriched);
    cells.push({
      ...cell,
      lon: sample.lon,
      lat: sample.lat,
      water_fraction: enriched.water_fraction,
      coastal_uncertain: coastalUncertain,
      shallow_water: enriched.shallow_water
    });
  }

  if (!samples.length) throw new Error('EMODnet water mask removed all WCS cells from the AOI');
  const depths = samples.map(sample => sample.depth);
  return {
    ...grid,
    samples,
    cells,
    valid_cells: samples.length,
    min: Math.min(...depths),
    max: Math.max(...depths),
    mean: depths.reduce((sum, value) => sum + value, 0) / depths.length,
    water_mask_applied: true,
    coastal_cells: coastalCells,
    masked_land_cells: maskedLandCells,
    water_mask_source: 'EMODNET_MEAN_MULTICOLOUR_NO_LAND_ALPHA'
  };
}

export async function fetchEmodnetWaterMask(aoi, { width = 512, timeoutMs = 12000, signal = null } = {}) {
  const request = buildEmodnetWaterMaskUrl(aoi, width);
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', relayAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request.url, { signal: controller.signal, headers: { Accept: 'image/png' } });
    if (!response.ok) throw new Error(`EMODnet water-mask WMS HTTP ${response.status}`);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(request.width, request.height)
      : Object.assign(document.createElement('canvas'), { width: request.width, height: request.height });
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas context unavailable for EMODnet water mask');
    context.clearRect(0, 0, request.width, request.height);
    context.drawImage(bitmap, 0, 0, request.width, request.height);
    const rgba = context.getImageData(0, 0, request.width, request.height).data;
    const alpha = new Uint8ClampedArray(request.width * request.height);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) alpha[p] = rgba[i + 3];
    bitmap.close?.();
    return { width: request.width, height: request.height, bbox: request.bbox, alpha, source: 'EMODNET_MEAN_MULTICOLOUR_NO_LAND_ALPHA' };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', relayAbort);
  }
}
