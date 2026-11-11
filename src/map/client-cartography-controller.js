import { sampleDepth } from '../data/emodnet.js';
import { aoiDimensionsMeters } from './spatial-scale.js';
import { state, patchState, subscribeState } from '../state.js';
import { setBaseMap, maplibregl } from './map-core.js';
import { AOI_ADAPTIVE_PALETTE, renderDepthLegend } from './depth-legend.js';
import { assessBathymetryConfidence, buildAdaptiveContours, chooseContourScheme, contourSummary } from './local-contours.js';

const SOURCE_ID = 'aoi-depth-grid-source';
const LAYER_ID = 'aoi-depth-grid-layer';
const OUTLINE_ID = 'aoi-depth-grid-outline';
const CONTOUR_SOURCE_ID = 'aoi-derived-contours-source';
const CONTOUR_LAYER_ID = 'aoi-derived-contours-layer';
const NATIVE_GRID_M = 115;
let lastGeojson = { type: 'FeatureCollection', features: [] };
let lastContourGeojson = { type: 'FeatureCollection', features: [] };
let lastRange = null;
let lastQuality = null;
let lastContourScheme = null;
let lastSamples = [];
let lastShape = null;
let requestGeneration = 0;
const restoreTimers = new Set();
let contourMarkers = [];

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

function gridShape(aoi) {
  const d = aoiDimensionsMeters(aoi);
  const nx = Math.max(3, Math.min(8, Math.ceil(d.width / NATIVE_GRID_M)));
  const ny = Math.max(3, Math.min(8, Math.ceil(d.height / NATIVE_GRID_M)));
  return { nx, ny };
}

function gridPoints(aoi) {
  const { nx, ny } = gridShape(aoi);
  const dx = (aoi.maxLon - aoi.minLon) / nx;
  const dy = (aoi.maxLat - aoi.minLat) / ny;
  const points = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      points.push({ lon: aoi.minLon + (ix + 0.5) * dx, lat: aoi.minLat + (iy + 0.5) * dy, ix, iy });
    }
  }
  return { points, nx, ny };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { out[index] = await fn(items[index], index); } catch { out[index] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

function adaptiveColorExpression(range = lastRange) {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return '#52b6d8';
  const min = range.min;
  const max = range.max > min ? range.max : min + 0.1;
  const expression = ['interpolate', ['linear'], ['get', 'depth_m']];
  AOI_ADAPTIVE_PALETTE.forEach((color, index) => {
    const value = min + ((max - min) * index) / (AOI_ADAPTIVE_PALETTE.length - 1);
    expression.push(value, color);
  });
  return expression;
}

function currentOpacity() {
  const slider = document.querySelector('#depthOpacity');
  return slider ? Math.max(0, Math.min(1, Number(slider.value) / 100)) : 0.72;
}

function numericGridVisible() {
  return state.bathyMode === 'aoi-adaptive' && Boolean(state.debugBathymetryGrid);
}

function clearContourMarkers() {
  for (const marker of contourMarkers) marker.remove();
  contourMarkers = [];
}

function localContoursVisible() {
  return state.bathyMode !== 'none' && state.contours;
}

function ensureLayer(map) {
  if (!map.isStyleLoaded()) return false;
  if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: 'geojson', data: lastGeojson });
  if (!map.getLayer(LAYER_ID)) {
    map.addLayer({ id: LAYER_ID, type: 'circle', source: SOURCE_ID, layout: { visibility: numericGridVisible() ? 'visible' : 'none' }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 4, 18, 7, 21, 13], 'circle-color': adaptiveColorExpression(), 'circle-opacity': currentOpacity(), 'circle-blur': 0.08, 'circle-stroke-color': 'rgba(255,255,255,0.78)', 'circle-stroke-width': 0.8 } });
  }
  if (!map.getLayer(OUTLINE_ID)) {
    map.addLayer({ id: OUTLINE_ID, type: 'circle', source: SOURCE_ID, layout: { visibility: numericGridVisible() ? 'visible' : 'none' }, paint: { 'circle-radius': 1.8, 'circle-color': '#ffffff', 'circle-opacity': 0.9, 'circle-stroke-color': '#123244', 'circle-stroke-width': 0.8 } });
  }
  if (!map.getSource(CONTOUR_SOURCE_ID)) map.addSource(CONTOUR_SOURCE_ID, { type: 'geojson', data: lastContourGeojson });
  if (!map.getLayer(CONTOUR_LAYER_ID)) {
    map.addLayer({ id: CONTOUR_LAYER_ID, type: 'line', source: CONTOUR_SOURCE_ID, layout: { visibility: localContoursVisible() ? 'visible' : 'none' }, paint: { 'line-color': ['case', ['==', ['get', 'major'], true], '#ffffff', '#8fd4ee'], 'line-width': ['case', ['==', ['get', 'major'], true], 2.4, 1.2], 'line-opacity': ['case', ['==', ['get', 'major'], true], 0.98, 0.82] } });
  }
  return Boolean(map.getLayer(LAYER_ID) && map.getLayer(CONTOUR_LAYER_ID));
}

function renderContourLabels(map) {
  clearContourMarkers();
  if (!localContoursVisible()) return;
  const candidates = lastContourGeojson.features.filter(feature => feature.properties?.major);
  const grouped = new Map();
  for (const feature of candidates) {
    const depth = feature.properties?.depth_m;
    if (!Number.isFinite(depth)) continue;
    if (!grouped.has(depth)) grouped.set(depth, []);
    grouped.get(depth).push(feature);
  }
  for (const [depth, features] of [...grouped.entries()].slice(0, 10)) {
    const feature = features[0];
    const coords = feature?.geometry?.coordinates;
    if (!coords?.length) continue;
    const point = coords[Math.floor(coords.length / 2)];
    const el = document.createElement('div');
    el.className = 'contour-label';
    el.textContent = `${depth} m`;
    el.title = `${feature.properties?.confidence ?? 'UNKNOWN'} confidence · ${feature.properties?.derivation ?? 'derived'}`;
    contourMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(point).addTo(map));
  }
}

function syncLayerAppearance(map) {
  if (!ensureLayer(map)) return false;
  const numericVisibility = numericGridVisible() ? 'visible' : 'none';
  if (map.getLayer(LAYER_ID)) {
    map.setLayoutProperty(LAYER_ID, 'visibility', numericVisibility);
    map.setPaintProperty(LAYER_ID, 'circle-color', adaptiveColorExpression());
    map.setPaintProperty(LAYER_ID, 'circle-opacity', currentOpacity());
  }
  if (map.getLayer(OUTLINE_ID)) map.setLayoutProperty(OUTLINE_ID, 'visibility', numericVisibility);
  if (map.getLayer(CONTOUR_LAYER_ID)) {
    map.setLayoutProperty(CONTOUR_LAYER_ID, 'visibility', localContoursVisible() ? 'visible' : 'none');
    map.setFilter(CONTOUR_LAYER_ID, state.contourDensity === 'major' ? ['==', ['get', 'major'], true] : null);
  }
  return true;
}

function render(map) {
  if (!syncLayerAppearance(map)) return false;
  const source = map.getSource(SOURCE_ID);
  if (source) source.setData(lastGeojson);
  const contourSource = map.getSource(CONTOUR_SOURCE_ID);
  if (contourSource) contourSource.setData(lastContourGeojson);
  renderContourLabels(map);
  return Boolean(source && contourSource && map.getLayer(LAYER_ID) && map.getLayer(CONTOUR_LAYER_ID));
}

function scheduleRender(map) {
  for (const timer of restoreTimers) clearTimeout(timer);
  restoreTimers.clear();
  const tryRender = attempt => {
    if (map.isStyleLoaded()) {
      try { if (render(map)) return; } catch { /* style still settling */ }
    }
    if (attempt >= 12) return;
    const timer = setTimeout(() => { restoreTimers.delete(timer); tryRender(attempt + 1); }, 40 + attempt * 30);
    restoreTimers.add(timer);
  };
  const timer = setTimeout(() => { restoreTimers.delete(timer); tryRender(0); }, 0);
  restoreTimers.add(timer);
}

function renderLegend() {
  const element = document.querySelector('#depthLegend');
  if (!element) return;
  const bathymetryForLegend = state.bathyMode === 'aoi-adaptive' ? (lastRange ?? state.bathymetry) : state.bathymetry;
  renderDepthLegend(element, state.bathyMode, bathymetryForLegend);
}

function renderLocalContourStatus() {
  const status = document.querySelector('#contourStatus');
  if (!status || state.bathyMode === 'none') return;
  if (!state.contours) {
    status.textContent = 'Adaptive isobaths off';
    status.className = 'status';
    return;
  }
  const summary = state.adaptiveContours;
  if (!summary || !lastRange) {
    status.textContent = 'Adaptive isobaths: waiting for numeric AOI bathymetry.';
    status.className = 'status';
    return;
  }
  status.textContent = summary.feature_count
    ? `Adaptive isobaths · ${summary.requested_levels ?? state.contourCount} richieste / ${summary.levels_m.length} disponibili · ${summary.interval_m} m intervallo · confidence ${summary.confidence} · coverage ${(summary.coverage_ratio * 100).toFixed(0)}%`
    : `Adaptive isobaths: no contour crossing in the valid sampled grid · confidence ${summary.confidence}`;
  status.className = summary.confidence === 'HIGH' || summary.confidence === 'MEDIUM' ? 'status good' : 'status warn';
}

function clear(map, status) {
  requestGeneration++;
  lastGeojson = { type: 'FeatureCollection', features: [] };
  lastContourGeojson = { type: 'FeatureCollection', features: [] };
  lastRange = null;
  lastQuality = null;
  lastContourScheme = null;
  lastSamples = [];
  lastShape = null;
  patchState({ bathymetryQuality: null, adaptiveContours: null });
  scheduleRender(map);
  renderLegend();
  renderLocalContourStatus();
  status.textContent = 'AOI REAL bathymetry: define an AOI.';
  status.className = 'status';
}

async function loadAoiGrid(map, aoi, status) {
  const generation = ++requestGeneration;
  const { points, nx, ny } = gridPoints(aoi);
  status.textContent = `AOI REAL bathymetry: sampling ${nx}×${ny} points at native-scale spacing…`;
  status.className = 'status warn';
  const samples = await mapLimit(points, 6, async point => {
    const payload = await sampleDepth(point);
    const depth = depthValue(payload);
    if (!Number.isFinite(depth) || depth <= 0.05) return null;
    return { ...point, depth };
  });
  if (generation !== requestGeneration) return;

  const valid = samples.filter(Boolean);
  lastGeojson = { type: 'FeatureCollection', features: valid.map(sample => ({ type: 'Feature', properties: { depth_m: sample.depth, provenance: 'REAL_EMODNET_REST', native_resolution_m: NATIVE_GRID_M }, geometry: { type: 'Point', coordinates: [sample.lon, sample.lat] } })) };
  if (!valid.length) {
    lastRange = null;
    lastQuality = null;
    lastContourScheme = null;
    lastSamples = [];
    lastShape = null;
    lastContourGeojson = { type: 'FeatureCollection', features: [] };
    patchState({ bathymetryQuality: null, adaptiveContours: null });
    scheduleRender(map);
    renderLegend();
    renderLocalContourStatus();
    status.textContent = 'AOI REAL bathymetry unavailable. No local colour surface or derived isobaths are drawn; context WMS remains optional.';
    status.className = 'status warn';
    return;
  }

  const depths = valid.map(item => item.depth);
  const min = Math.min(...depths);
  const max = Math.max(...depths);
  const dimensions = aoiDimensionsMeters(aoi);
  lastRange = { min, max, samples: valid.length, source: 'REAL_EMODNET_REST' };
  lastQuality = assessBathymetryConfidence({ aoiWidthM: dimensions.width, aoiHeightM: dimensions.height, nativeResolutionM: NATIVE_GRID_M, validSamples: valid.length, totalSamples: points.length, sourceType: 'EMODNET_STANDARD_REST', derivation: 'NUMERIC_GRID' });
  lastSamples = valid;
  lastShape = { nx, ny };
  lastContourScheme = chooseContourScheme(min, max, state.contourCount);
  lastContourGeojson = buildAdaptiveContours({ samples, nx, ny, scheme: lastContourScheme, metadata: { source: 'EModnet Bathymetry REST / standard DTM', native_resolution_m: NATIVE_GRID_M, confidence: lastQuality.confidence, confidence_score: lastQuality.confidence_score, coverage_ratio: lastQuality.coverage_ratio, estimated_horizontal_uncertainty_m: lastQuality.estimated_horizontal_uncertainty_m, fitness_for_use: lastQuality.fitness_for_use } });
  const summary = contourSummary(lastContourGeojson, lastContourScheme, lastQuality);
  patchState({ bathymetryQuality: lastQuality, adaptiveContours: summary });
  scheduleRender(map);
  renderLegend();
  renderLocalContourStatus();
  status.textContent = `AOI REAL bathymetry · ${valid.length}/${points.length} samples · adaptive ${min.toFixed(1)}–${max.toFixed(1)} m · native ~${NATIVE_GRID_M} m · confidence ${lastQuality.confidence}`;
  status.className = lastQuality.confidence === 'HIGH' || lastQuality.confidence === 'MEDIUM' ? 'status good' : 'status warn';
}

function rebuildContoursFromCachedSamples(map) {
  if (!lastRange || !lastQuality || !lastShape || !lastSamples.length) return;
  lastContourScheme = chooseContourScheme(lastRange.min, lastRange.max, state.contourCount);
  lastContourGeojson = buildAdaptiveContours({
    samples: lastSamples, nx: lastShape.nx, ny: lastShape.ny, scheme: lastContourScheme,
    metadata: {
      source: 'EModnet Bathymetry REST / standard DTM',
      native_resolution_m: NATIVE_GRID_M,
      confidence: lastQuality.confidence,
      confidence_score: lastQuality.confidence_score,
      coverage_ratio: lastQuality.coverage_ratio,
      estimated_horizontal_uncertainty_m: lastQuality.estimated_horizontal_uncertainty_m,
      fitness_for_use: lastQuality.fitness_for_use
    }
  });
  if (state.bathymetryGridSource !== 'EMODNET_WCS') {
    patchState({ bathymetryQuality: lastQuality,
      adaptiveContours: contourSummary(lastContourGeojson, lastContourScheme, lastQuality) });
  }
  scheduleRender(map);
  renderLocalContourStatus();
}

function syncContourUi(app) {
  const adaptive = state.bathyMode !== 'none';
  const checkbox = document.querySelector('#contours');
  const density = document.querySelector('#contourDensity');
  if (checkbox) { checkbox.disabled = false; checkbox.title = adaptive ? 'Derived locally from best available numeric bathymetry; confidence is shown explicitly.' : ''; }
  if (density) density.disabled = false;
  // Context WFS/WMS contours are not authoritative for the selected AOI.
  // Keep them suppressed in every source-selection mode.
  if (app.contours.visible) app.contours.setVisible(false);
  renderLocalContourStatus();
}

function configureClientUi(app) {
  const { map, layers } = app;
  const select = document.querySelector('#baseMap');
  if (select) {
    [...select.options].forEach(option => { if (!['minimal', 'satellite'].includes(option.value)) option.remove(); });
    if (!['minimal', 'satellite'].includes(state.baseMap)) { patchState({ baseMap: 'minimal' }); setBaseMap(map, 'minimal'); }
    select.value = state.baseMap;
  }
  const bathySelect = document.querySelector('#bathyMode');
  if (bathySelect) {
    bathySelect.innerHTML = `<option value="aoi-adaptive">AOI REAL · isobate numeriche</option><option value="emodnet-multicolour">EMODnet (sorgente, nessun raster sulla terra)</option><option value="emodnet-rainbow">EMODnet Rainbow (solo riferimento)</option><option value="gebco-global">GEBCO (solo riferimento globale)</option><option value="chart-relief">Chart Relief (solo riferimento)</option><option value="none">None</option>`;
    bathySelect.value = state.bathyMode;
  }
  layers.setBathymetry(state.bathyMode);
  syncContourUi(app);
  renderLegend();
  const sourceStatus = document.querySelector('#bathySourceStatus');
  if (sourceStatus && !document.querySelector('#aoiDepthGridStatus')) {
    const status = document.createElement('div');
    status.id = 'aoiDepthGridStatus';
    status.className = 'status';
    status.textContent = 'AOI REAL bathymetry: define an AOI.';
    sourceStatus.insertAdjacentElement('afterend', status);
  }
}

const app = await waitForApp();
const map = app.map;
configureClientUi(app);
const status = document.querySelector('#aoiDepthGridStatus');
window.__MSO__.getLocalContours = () => lastContourGeojson;
window.__MSO__.getBathymetryQuality = () => lastQuality;
map.on('style.load', () => scheduleRender(map));
ensureLayer(map);
render(map);
const opacitySlider = document.querySelector('#depthOpacity');
if (opacitySlider) opacitySlider.addEventListener('input', () => syncLayerAppearance(map));

subscribeState((next, patch) => {
  if (Object.prototype.hasOwnProperty.call(patch, 'aoi')) { if (!next.aoi) clear(map, status); else loadAoiGrid(map, next.aoi, status); }
  if (Object.prototype.hasOwnProperty.call(patch, 'bathyMode')) { syncContourUi(app); scheduleRender(map); renderLegend(); }
  if (Object.prototype.hasOwnProperty.call(patch, 'debugBathymetryGrid')) scheduleRender(map);
  if (Object.prototype.hasOwnProperty.call(patch, 'contourCount')) rebuildContoursFromCachedSamples(map);
  if (Object.prototype.hasOwnProperty.call(patch, 'contours') || Object.prototype.hasOwnProperty.call(patch, 'contourDensity')) {
    if (next.bathyMode !== 'none') { scheduleRender(map); renderLocalContourStatus(); }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'bathymetry') && next.bathyMode === 'aoi-adaptive') renderLegend();
});

if (state.aoi) loadAoiGrid(map, state.aoi, status);
