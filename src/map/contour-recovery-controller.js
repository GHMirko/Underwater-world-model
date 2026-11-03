import { sampleDepth } from '../data/emodnet.js';
import { state, patchState, subscribeState } from '../state.js';
import { aoiDimensionsMeters } from './spatial-scale.js';
import { assessBathymetryConfidence, buildAdaptiveContours, chooseContourScheme, contourSummary } from './local-contours.js';
import { maplibregl } from './map-core.js';

const NATIVE_GRID_M = 115;
const SOURCE_ID = 'aoi-recovery-contours-source';
const LAYER_ID = 'aoi-recovery-contours-layer';
const MAX_AXIS_SAMPLES = 12;
const MAX_TOTAL_SAMPLES = MAX_AXIS_SAMPLES * MAX_AXIS_SAMPLES;
let generation = 0;
let recoveryKey = null;
let recoveryGeojson = { type: 'FeatureCollection', features: [] };
let markers = [];

function waitForApp() {
  return new Promise(resolve => {
    const tick = () => {
      if (window.__MSO__?.map) resolve(window.__MSO__);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

function depthValue(payload) {
  const value = Number(payload?.avg ?? payload?.depth ?? payload?.value?.avg ?? payload?.value);
  return Number.isFinite(value) ? Math.abs(value) : null;
}

function aoiKey(aoi) {
  if (!aoi) return null;
  return [aoi.minLon, aoi.minLat, aoi.maxLon, aoi.maxLat].map(value => Number(value).toFixed(7)).join(':');
}

function gridShape(aoi) {
  const dimensions = aoiDimensionsMeters(aoi);
  let nx = Math.max(4, Math.min(MAX_AXIS_SAMPLES, Math.ceil(dimensions.width / NATIVE_GRID_M)));
  let ny = Math.max(4, Math.min(MAX_AXIS_SAMPLES, Math.ceil(dimensions.height / NATIVE_GRID_M)));
  while (nx * ny > MAX_TOTAL_SAMPLES) {
    if (nx >= ny && nx > 4) nx -= 1;
    else if (ny > 4) ny -= 1;
    else break;
  }
  return { nx, ny, dimensions };
}

function gridPoints(aoi, nx, ny) {
  const dx = (aoi.maxLon - aoi.minLon) / nx;
  const dy = (aoi.maxLat - aoi.minLat) / ny;
  const points = [];
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      points.push({
        lon: aoi.minLon + (ix + 0.5) * dx,
        lat: aoi.minLat + (iy + 0.5) * dy,
        ix,
        iy
      });
    }
  }
  return points;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { out[index] = await fn(items[index], index); }
      catch { out[index] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

function clearMarkers() {
  for (const marker of markers) marker.remove();
  markers = [];
}

function ensureLayer(map) {
  if (!map.isStyleLoaded()) return false;
  if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: 'geojson', data: recoveryGeojson });
  if (!map.getLayer(LAYER_ID)) {
    map.addLayer({
      id: LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      layout: { visibility: state.bathyMode === 'aoi-adaptive' && state.contours ? 'visible' : 'none' },
      paint: {
        'line-color': ['case', ['==', ['get', 'major'], true], '#ffffff', '#7bd1ef'],
        'line-width': ['case', ['==', ['get', 'major'], true], 2.6, 1.35],
        'line-opacity': 0.9,
        'line-dasharray': ['case', ['==', ['get', 'major'], true], ['literal', [1, 0]], ['literal', [2, 1]]]
      }
    });
  }
  const source = map.getSource(SOURCE_ID);
  if (source) source.setData(recoveryGeojson);
  if (map.getLayer(LAYER_ID)) {
    map.setLayoutProperty(LAYER_ID, 'visibility', state.bathyMode === 'aoi-adaptive' && state.contours ? 'visible' : 'none');
    map.setFilter(LAYER_ID, state.contourDensity === 'major' ? ['==', ['get', 'major'], true] : null);
  }
  return true;
}

function renderLabels(map) {
  clearMarkers();
  if (state.bathyMode !== 'aoi-adaptive' || !state.contours) return;
  const major = recoveryGeojson.features.filter(feature => feature.properties?.major);
  const seen = new Set();
  for (const feature of major) {
    const depth = feature.properties?.depth_m;
    if (!Number.isFinite(depth) || seen.has(depth)) continue;
    seen.add(depth);
    const coords = feature.geometry?.coordinates;
    if (!coords?.length) continue;
    const point = coords[Math.floor(coords.length / 2)];
    const el = document.createElement('div');
    el.className = 'contour-label';
    el.textContent = `${depth} m`;
    el.title = `RECOVERY NUMERIC GRID · ${feature.properties?.confidence ?? 'UNKNOWN'} confidence`;
    markers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(point).addTo(map));
    if (seen.size >= 10) break;
  }
}

function render(map) {
  if (!ensureLayer(map)) return;
  renderLabels(map);
}

function clear(map) {
  generation += 1;
  recoveryKey = null;
  recoveryGeojson = { type: 'FeatureCollection', features: [] };
  clearMarkers();
  if (map.getSource(SOURCE_ID)) map.getSource(SOURCE_ID).setData(recoveryGeojson);
}

async function recover(map, aoi) {
  const key = aoiKey(aoi);
  if (!key || key === recoveryKey) return;
  recoveryKey = key;
  const currentGeneration = ++generation;
  const { nx, ny, dimensions } = gridShape(aoi);
  const points = gridPoints(aoi, nx, ny);
  const status = document.querySelector('#contourStatus');
  if (status) {
    status.textContent = `CONTEXT ONLY · local contour recovery sampling ${nx}×${ny} (${points.length} points)…`;
    status.className = 'status warn';
  }

  const samples = await mapLimit(points, 8, async point => {
    const payload = await sampleDepth(point);
    const depth = depthValue(payload);
    if (!Number.isFinite(depth) || depth <= 0.05) return null;
    return { ...point, depth };
  });
  if (currentGeneration !== generation) return;

  const valid = samples.filter(Boolean);
  if (valid.length < 3) return;
  const depths = valid.map(sample => sample.depth);
  const min = Math.min(...depths);
  const max = Math.max(...depths);
  const scheme = chooseContourScheme(min, max);
  const quality = assessBathymetryConfidence({
    aoiWidthM: dimensions.width,
    aoiHeightM: dimensions.height,
    nativeResolutionM: NATIVE_GRID_M,
    validSamples: valid.length,
    totalSamples: points.length,
    sourceType: 'EMODNET_STANDARD_REST',
    derivation: 'NUMERIC_GRID'
  });
  recoveryGeojson = buildAdaptiveContours({
    samples,
    nx,
    ny,
    scheme,
    metadata: {
      source: 'EModnet Bathymetry REST / bounded recovery grid',
      native_resolution_m: NATIVE_GRID_M,
      confidence: quality.confidence,
      confidence_score: quality.confidence_score,
      coverage_ratio: quality.coverage_ratio,
      estimated_horizontal_uncertainty_m: quality.estimated_horizontal_uncertainty_m,
      fitness_for_use: quality.fitness_for_use
    }
  });

  for (const feature of recoveryGeojson.features) {
    feature.properties.derivation = `RECOVERY_${feature.properties.derivation}`;
    feature.properties.recovery_grid = `${nx}x${ny}`;
  }

  const summary = contourSummary(recoveryGeojson, scheme, quality);
  summary.derivation = recoveryGeojson.features.length ? 'BOUNDED_DENSER_NUMERIC_RECOVERY' : 'NO_LOCAL_CONTOURS';
  summary.recovery_grid = `${nx}x${ny}`;
  summary.recovery_samples = valid.length;
  summary.recovery_total = points.length;

  if (!summary.feature_count) return;

  render(map);
  patchState({ adaptiveContours: summary, bathymetryQuality: quality });
  if (status) {
    status.textContent = `Adaptive isobaths RECOVERED · ${scheme.interval_m} m interval · ${summary.levels_m.length} levels · ${valid.length}/${points.length} samples · confidence ${quality.confidence}`;
    status.className = quality.confidence === 'HIGH' || quality.confidence === 'MEDIUM' ? 'status good' : 'status warn';
  }
}

const app = await waitForApp();
const map = app.map;
map.on('style.load', () => setTimeout(() => render(map), 0));

subscribeState((next, patch) => {
  if (Object.prototype.hasOwnProperty.call(patch, 'aoi') && !next.aoi) clear(map);

  if (
    Object.prototype.hasOwnProperty.call(patch, 'adaptiveContours') &&
    next.bathyMode === 'aoi-adaptive' &&
    next.contours &&
    next.aoi &&
    (!next.adaptiveContours || next.adaptiveContours.feature_count === 0)
  ) {
    recover(map, next.aoi);
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, 'bathyMode') ||
    Object.prototype.hasOwnProperty.call(patch, 'contours') ||
    Object.prototype.hasOwnProperty.call(patch, 'contourDensity') ||
    Object.prototype.hasOwnProperty.call(patch, 'baseMap')
  ) {
    setTimeout(() => render(map), 0);
  }
});
