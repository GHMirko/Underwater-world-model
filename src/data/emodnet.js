const REST_BASE = 'https://rest.emodnet-bathymetry.eu';

export function samplePoints(aoi) {
  const xs = [aoi.minLon, (aoi.minLon + aoi.maxLon) / 2, aoi.maxLon];
  const ys = [aoi.minLat, (aoi.minLat + aoi.maxLat) / 2, aoi.maxLat];
  return xs.flatMap(lon => ys.map(lat => ({ lon, lat })));
}

async function fetchJsonWithTimeout(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function sampleDepth(point) {
  const geom = encodeURIComponent(`POINT(${point.lon} ${point.lat})`);
  const candidates = [
    `${REST_BASE}/depth_sample?geom=${geom}`,
    `${REST_BASE}/depth/point?geom=${geom}`
  ];

  let lastError;
  for (const url of candidates) {
    try {
      return await fetchJsonWithTimeout(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('EMODnet depth sample unavailable');
}

function standardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export async function sampleAoiBathymetry(aoi) {
  const settled = await Promise.allSettled(samplePoints(aoi).map(sampleDepth));
  const valid = settled
    .filter(result => result.status === 'fulfilled')
    .map(result => Math.abs(Number(result.value.avg)))
    .filter(Number.isFinite);

  if (valid.length < 3) {
    throw new Error(`Insufficient EMODnet samples: ${valid.length}/9`);
  }

  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const sd = standardDeviation(valid);

  return {
    provenance: 'REAL',
    source: 'EMODnet Bathymetry REST',
    samples: valid.length,
    mean,
    min,
    max,
    sd,
    complexity: Math.min(1, sd / Math.max(1, mean))
  };
}
