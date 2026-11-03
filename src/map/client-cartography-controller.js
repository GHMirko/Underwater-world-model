import { sampleDepth } from '../data/emodnet.js';
import { aoiDimensionsMeters } from './spatial-scale.js';
import { state, patchState, subscribeState } from '../state.js';
import { setBaseMap } from './map-core.js';
import { AOI_ADAPTIVE_PALETTE, renderDepthLegend } from './depth-legend.js';

const SOURCE_ID = 'aoi-depth-grid-source';
const LAYER_ID = 'aoi-depth-grid-layer';
const OUTLINE_ID = 'aoi-depth-grid-outline';
const NATIVE_GRID_M = 115;
let lastGeojson = { type: 'FeatureCollection', features: [] };
let lastRange = null;
let requestGeneration = 0;
const restoreTimers = new Set();

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
      points.push({
        lon: aoi.minLon + (ix + 0.5) * dx,
        lat: aoi.minLat + (iy + 0.5) * dy,
        ix,
        iy
      });
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
      try { out[index] = await fn(items[index], index); }
      catch { out[index] = null; }
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

function ensureLayer(map) {
  if (!map.isStyleLoaded()) return false;
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: lastGeojson });
  }
  if (!map.getLayer(LAYER_ID)) {
    map.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      layout: { visibility: state.bathyMode === 'aoi-adaptive' ? 'visible' : 'none' },
      paint: {
        // Deliberately modest footprint: samples indicate native bathymetry cells
        // without bleeding large synthetic patches across piers/coastline.
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 4, 18, 7, 21, 13],
        'circle-color': adaptiveColorExpression(),
        'circle-opacity': currentOpacity(),
        'circle-blur': 0.08,
        'circle-stroke-color': 'rgba(255,255,255,0.78)',
        'circle-stroke-width': 0.8
      }
    });
  }
  if (!map.getLayer(OUTLINE_ID)) {
    map.addLayer({
      id: OUTLINE_ID,
      type: 'circle',
      source: SOURCE_ID,
      layout: { visibility: state.bathyMode === 'aoi-adaptive' ? 'visible' : 'none' },
      paint: {
        'circle-radius': 1.8,
        'circle-color': '#ffffff',
        'circle-opacity': 0.9,
        'circle-stroke-color': '#123244',
        'circle-stroke-width': 0.8
      }
    });
  }
  return Boolean(map.getLayer(LAYER_ID));
}

function syncLayerAppearance(map) {
  if (!ensureLayer(map)) return false;
  const visible = state.bathyMode === 'aoi-adaptive' ? 'visible' : 'none';
  if (map.getLayer(LAYER_ID)) {
    map.setLayoutProperty(LAYER_ID, 'visibility', visible);
    map.setPaintProperty(LAYER_ID, 'circle-color', adaptiveColorExpression());
    map.setPaintProperty(LAYER_ID, 'circle-opacity', currentOpacity());
  }
  if (map.getLayer(OUTLINE_ID)) map.setLayoutProperty(OUTLINE_ID, 'visibility', visible);
  return true;
}

function render(map) {
  if (!syncLayerAppearance(map)) return false;
  const source = map.getSource(SOURCE_ID);
  if (source) source.setData(lastGeojson);
  return Boolean(source && map.getLayer(LAYER_ID));
}

function scheduleRender(map) {
  for (const timer of restoreTimers) clearTimeout(timer);
  restoreTimers.clear();

  const tryRender = attempt => {
    if (map.isStyleLoaded()) {
      try {
        if (render(map)) return;
      } catch {
        // The style graph can still be settling immediately after setStyle().
      }
    }
    if (attempt >= 12) return;
    const timer = setTimeout(() => {
      restoreTimers.delete(timer);
      tryRender(attempt + 1);
    }, 40 + attempt * 30);
    restoreTimers.add(timer);
  };

  const timer = setTimeout(() => {
    restoreTimers.delete(timer);
    tryRender(0);
  }, 0);
  restoreTimers.add(timer);
}

function renderLegend() {
  const element = document.querySelector('#depthLegend');
  if (!element) return;
  const bathymetryForLegend = state.bathyMode === 'aoi-adaptive'
    ? (lastRange ?? state.bathymetry)
    : state.bathymetry;
  renderDepthLegend(element, state.bathyMode, bathymetryForLegend);
}

function clear(map, status) {
  requestGeneration++;
  lastGeojson = { type: 'FeatureCollection', features: [] };
  lastRange = null;
  scheduleRender(map);
  renderLegend();
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
    // Land/no-data/zero values are omitted. The local numeric overlay therefore
    // never deliberately colours a land cell simply to make the map look full.
    if (!Number.isFinite(depth) || depth <= 0.05) return null;
    return { ...point, depth };
  });
  if (generation !== requestGeneration) return;

  const valid = samples.filter(Boolean);
  lastGeojson = {
    type: 'FeatureCollection',
    features: valid.map(sample => ({
      type: 'Feature',
      properties: {
        depth_m: sample.depth,
        provenance: 'REAL_EMODNET_REST',
        native_resolution_m: NATIVE_GRID_M
      },
      geometry: { type: 'Point', coordinates: [sample.lon, sample.lat] }
    }))
  };

  if (!valid.length) {
    lastRange = null;
    scheduleRender(map);
    renderLegend();
    status.textContent = 'AOI REAL bathymetry unavailable. No local colour surface is drawn; context WMS remains optional.';
    status.className = 'status warn';
    return;
  }

  const depths = valid.map(item => item.depth);
  const min = Math.min(...depths);
  const max = Math.max(...depths);
  lastRange = { min, max, samples: valid.length, source: 'REAL_EMODNET_REST' };
  scheduleRender(map);
  renderLegend();
  status.textContent = `AOI REAL bathymetry · ${valid.length}/${points.length} samples · adaptive ${min.toFixed(1)}–${max.toFixed(1)} m · native source ~${NATIVE_GRID_M} m`;
  status.className = 'status good';
}

function syncContourUi(app) {
  const adaptive = state.bathyMode === 'aoi-adaptive';
  const checkbox = document.querySelector('#contours');
  const density = document.querySelector('#contourDensity');
  if (checkbox) {
    checkbox.disabled = adaptive;
    checkbox.title = adaptive ? 'Local isobaths will be derived from the selected numeric/HR bathymetry grid.' : '';
  }
  if (density) density.disabled = adaptive;
  app.contours.setBathymetryMode(state.bathyMode);
  app.contours.setVisible(!adaptive && state.contours);
}

function configureClientUi(app) {
  const { map, layers } = app;
  const select = document.querySelector('#baseMap');
  if (select) {
    [...select.options].forEach(option => {
      if (!['minimal', 'satellite'].includes(option.value)) option.remove();
    });
    if (!['minimal', 'satellite'].includes(state.baseMap)) {
      patchState({ baseMap: 'minimal' });
      setBaseMap(map, 'minimal');
    }
    select.value = state.baseMap;
  }

  const bathySelect = document.querySelector('#bathyMode');
  if (bathySelect) {
    bathySelect.innerHTML = `
      <option value="aoi-adaptive">AOI REAL · adaptive min/max</option>
      <option value="emodnet-multicolour">EMODnet Multicolour · context WMS</option>
      <option value="emodnet-rainbow">EMODnet Rainbow · context WMS</option>
      <option value="chart-relief">Chart Relief · context only</option>
      <option value="none">None</option>`;
    bathySelect.value = state.bathyMode;
  }
  layers.setBathymetry(state.bathyMode);
  syncContourUi(app);
  renderLegend();

  const firstBadge = document.querySelector('.header .badge');
  if (firstBadge) firstBadge.textContent = 'GitHub v0.15 Adaptive Bathymetry';

  const sourceStatus = document.querySelector('#bathySourceStatus');
  if (sourceStatus && !document.querySelector('#aoiDepthGridStatus')) {
    const status = document.createElement('div');
    status.id = 'aoiDepthGridStatus';
    status.className = 'status';
    status.textContent = 'AOI REAL bathymetry: define an AOI.';
    sourceStatus.insertAdjacentElement('afterend', status);
  }

  const mapNote = document.querySelector('.panel .data-note');
  if (mapNote) mapNote.textContent = 'Background/land and sea data are separate. AOI REAL is the default local bathymetry: its colour scale follows sampled min/max. EMODnet/Seascape WMS products are optional context only.';
}

const app = await waitForApp();
const map = app.map;
configureClientUi(app);
const status = document.querySelector('#aoiDepthGridStatus');

map.on('style.load', () => scheduleRender(map));
ensureLayer(map);
render(map);

const opacitySlider = document.querySelector('#depthOpacity');
if (opacitySlider) opacitySlider.addEventListener('input', () => syncLayerAppearance(map));

subscribeState((next, patch) => {
  if (Object.prototype.hasOwnProperty.call(patch, 'aoi')) {
    if (!next.aoi) clear(map, status);
    else loadAoiGrid(map, next.aoi, status);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'baseMap')) {
    // patchState(baseMap) is emitted immediately before setStyle(). Keep a
    // bounded delayed restore alive across the style replacement.
    scheduleRender(map);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'bathyMode')) {
    syncContourUi(app);
    scheduleRender(map);
    renderLegend();
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'bathymetry') && next.bathyMode === 'aoi-adaptive') {
    renderLegend();
  }
});

if (state.aoi) loadAoiGrid(map, state.aoi, status);
