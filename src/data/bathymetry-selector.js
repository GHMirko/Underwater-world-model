import { aoiDimensionsMeters, resolutionAssessment } from '../map/spatial-scale.js';

const HR_WFS = 'https://ows.emodnet-bathymetry.eu/wfs';
const STANDARD_RESOLUTION_M = 115;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function buildHrBathymetryDiscoveryUrl(aoi, maxFeatures = 500) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.1.0',
    request: 'GetFeature',
    typeName: 'emodnet:hr_bathymetry_area',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    maxFeatures: String(maxFeatures),
    bbox: `${aoi.minLon},${aoi.minLat},${aoi.maxLon},${aoi.maxLat},EPSG:4326`
  });
  return `${HR_WFS}?${params.toString()}`;
}

function visitCoordinates(node, fn) {
  if (!Array.isArray(node)) return;
  if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) {
    fn(Number(node[0]), Number(node[1]));
    return;
  }
  for (const child of node) visitCoordinates(child, fn);
}

export function geometryBbox(geometry) {
  if (!geometry?.coordinates) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  visitCoordinates(geometry.coordinates, (lon, lat) => {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  });
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

export function bboxCoverageRatio(sourceBbox, aoi) {
  if (!sourceBbox || !aoi) return 0;
  const west = Math.max(sourceBbox.minLon, aoi.minLon);
  const east = Math.min(sourceBbox.maxLon, aoi.maxLon);
  const south = Math.max(sourceBbox.minLat, aoi.minLat);
  const north = Math.min(sourceBbox.maxLat, aoi.maxLat);
  if (west >= east || south >= north) return 0;
  const overlap = aoiDimensionsMeters({ minLon: west, maxLon: east, minLat: south, maxLat: north }).area;
  const target = aoiDimensionsMeters(aoi).area;
  return target > 0 ? clamp01(overlap / target) : 0;
}

function flattenPropertyStrings(properties = {}) {
  return Object.entries(properties).flatMap(([key, value]) => {
    if (value == null) return [];
    if (typeof value === 'object') return [[key, JSON.stringify(value)]];
    return [[key, String(value)]];
  });
}

function arcMinuteResolution(text) {
  const match = String(text).match(/1\s*\/\s*(32|64|128|256|512)\s*(?:arc\s*)?(?:min(?:ute)?s?)?/i);
  if (!match) return null;
  return 1852 / Number(match[1]);
}

function metricResolution(text) {
  const candidates = [...String(text).matchAll(/(?:resolution|grid|cell(?:size)?)[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(m|met(?:er|re)s?)/ig)]
    .map(match => Number(match[1]))
    .filter(value => Number.isFinite(value) && value > 0 && value < 10000);
  return candidates.length ? Math.min(...candidates) : null;
}

export function inferResolutionM(properties = {}) {
  const values = flattenPropertyStrings(properties);
  const preferred = values.filter(([key]) => /resol|grid|cell|spacing|arc/i.test(key));
  for (const [, value] of [...preferred, ...values]) {
    const arc = arcMinuteResolution(value);
    if (arc) return arc;
    const metric = metricResolution(value);
    if (metric) return metric;
  }
  return null;
}

export function inferLinks(properties = {}) {
  const links = [];
  for (const [key, value] of flattenPropertyStrings(properties)) {
    const urls = value.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
    for (const url of urls) {
      links.push({ key, url: url.replace(/[),.;]+$/, '') });
    }
  }
  const score = ({ key, url }) => {
    const text = `${key} ${url}`.toLowerCase();
    if (/download|file|geotiff|tiff|netcdf|xyz|ascii/.test(text)) return 3;
    if (/metadata|catalog|sextant|product/.test(text)) return 2;
    return 1;
  };
  links.sort((a, b) => score(b) - score(a));
  return {
    download_url: links.find(link => /download|file|geotiff|tiff|netcdf|xyz|ascii/i.test(`${link.key} ${link.url}`))?.url ?? null,
    metadata_url: links.find(link => /metadata|catalog|sextant|product/i.test(`${link.key} ${link.url}`))?.url ?? links[0]?.url ?? null,
    all: links
  };
}

function candidateName(feature, index) {
  const props = feature?.properties ?? {};
  const entry = Object.entries(props).find(([key, value]) => /title|name|dataset|product|identifier|id/i.test(key) && value != null && String(value).trim());
  return entry ? String(entry[1]) : `EMODnet HR-DTM candidate ${index + 1}`;
}

export function normalizeHrCandidate(feature, aoi, index = 0) {
  const bbox = geometryBbox(feature?.geometry);
  const coverage_ratio = bboxCoverageRatio(bbox, aoi);
  const resolution_m = inferResolutionM(feature?.properties);
  const links = inferLinks(feature?.properties);
  return {
    id: feature?.id ?? feature?.properties?.id ?? `hr-${index + 1}`,
    name: candidateName(feature, index),
    coverage_ratio,
    full_coverage: coverage_ratio >= 0.95,
    native_horizontal_resolution_m: resolution_m,
    download_url: links.download_url,
    metadata_url: links.metadata_url,
    bbox,
    properties: feature?.properties ?? {}
  };
}

export function selectBestHrCandidate(featureCollection, aoi) {
  const candidates = (featureCollection?.features ?? [])
    .map((feature, index) => normalizeHrCandidate(feature, aoi, index))
    .filter(candidate => candidate.coverage_ratio > 0)
    .sort((a, b) => {
      if (a.full_coverage !== b.full_coverage) return a.full_coverage ? -1 : 1;
      const ar = Number.isFinite(a.native_horizontal_resolution_m) ? a.native_horizontal_resolution_m : Infinity;
      const br = Number.isFinite(b.native_horizontal_resolution_m) ? b.native_horizontal_resolution_m : Infinity;
      if (ar !== br) return ar - br;
      return b.coverage_ratio - a.coverage_ratio;
    });
  return { candidates, best: candidates[0] ?? null };
}

export function standardBathymetrySelection(aoi, reason = 'No suitable HR-DTM resolved') {
  return {
    status: 'STANDARD_FALLBACK',
    selected_source: 'EMODNET_STANDARD_DTM',
    provider: 'EMODnet Bathymetry',
    native_horizontal_resolution_m: STANDARD_RESOLUTION_M,
    spatial_adequacy: resolutionAssessment(aoi, STANDARD_RESOLUTION_M),
    reason,
    hr_candidates: 0,
    primary: null
  };
}

export function resolveBathymetrySelection(featureCollection, aoi) {
  const { candidates, best } = selectBestHrCandidate(featureCollection, aoi);
  if (!best) return standardBathymetrySelection(aoi, 'No HR-DTM footprint intersects the AOI');

  if (!best.full_coverage) {
    return {
      ...standardBathymetrySelection(aoi, 'HR-DTM footprint is only partial; standard DTM remains the complete-coverage source'),
      status: 'HR_PARTIAL_STANDARD_FALLBACK',
      hr_candidates: candidates.length,
      primary: best
    };
  }

  const resolution = best.native_horizontal_resolution_m;
  const hasDownload = Boolean(best.download_url);
  return {
    status: hasDownload ? 'HR_SELECTED' : 'HR_CANDIDATE_METADATA_REQUIRED',
    selected_source: hasDownload ? 'EMODNET_HR_DTM' : 'EMODNET_STANDARD_DTM',
    provider: 'EMODnet Bathymetry',
    native_horizontal_resolution_m: hasDownload && Number.isFinite(resolution) ? resolution : STANDARD_RESOLUTION_M,
    spatial_adequacy: resolutionAssessment(aoi, hasDownload && Number.isFinite(resolution) ? resolution : STANDARD_RESOLUTION_M),
    reason: hasDownload
      ? 'Full AOI coverage and direct HR-DTM link resolved'
      : 'Full HR-DTM footprint found, but a direct data-download link was not resolved from WFS properties; standard DTM remains executable fallback',
    hr_candidates: candidates.length,
    primary: best
  };
}

export async function discoverBathymetrySource(aoi, { timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(buildHrBathymetryDiscoveryUrl(aoi), {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HR WFS HTTP ${response.status}`);
    const featureCollection = await response.json();
    return {
      ...resolveBathymetrySelection(featureCollection, aoi),
      discovery: 'LIVE_WFS',
      discovery_url: buildHrBathymetryDiscoveryUrl(aoi)
    };
  } catch (error) {
    return {
      ...standardBathymetrySelection(aoi, `HR discovery unavailable: ${error.name === 'AbortError' ? 'timeout' : error.message}`),
      discovery: 'UNAVAILABLE',
      discovery_url: buildHrBathymetryDiscoveryUrl(aoi)
    };
  } finally {
    clearTimeout(timer);
  }
}
