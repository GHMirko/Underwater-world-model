import { sampleDepth } from '../data/emodnet.js';
import { aoiDimensionsMeters } from './spatial-scale.js';
import { state, patchState, subscribeState } from '../state.js';
import { setBaseMap } from './map-core.js';

const SOURCE_ID = 'aoi-depth-grid-source';
const LAYER_ID = 'aoi-depth-grid-layer';
const OUTLINE_ID = 'aoi-depth-grid-outline';
const NATIVE_GRID_M = 115;
let lastGeojson = { type: 'FeatureCollection', features: [] };
let requestGeneration = 0;

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

function ensureLayer(map) {
  if (!map.isStyleLoaded()) return;
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: lastGeojson });
  }
  if (!map.getLayer(LAYER_ID)) {
    map.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 12, 2, 16, 26, 18, 104, 21, 832],
        'circle-color': [
          'interpolate', ['linear'], ['get', 'depth_m'],
          0, '#d9f3ff',
          5, '#a9dff3',
          15, '#62b6dc',
          30, '#2d83bd',
          60, '#155c93',
          120, '#073d6b'
        ],
        'circle-opacity': 0.58,
        'circle-blur': 0.18,
        'circle-stroke-color': 'rgba(255,255,255,0.45)',
        'circle-stroke-width': 0.5
      }
    });
  }
  if (!map.getLayer(OUTLINE_ID)) {
    map.addLayer({
      id: OUTLINE_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 2.5,
        'circle-color': '#ffffff',
        'circle-opacity': 0.9,
        'circle-stroke-color': '#123244',
        'circle-stroke-width': 1
      }
    });
  }
}

function render(map) {
  ensureLayer(map);
  const source = map.getSource(SOURCE_ID);
  if (source) source.setData(lastGeojson);
}

function clear(map, status) {
  requestGeneration++;
  lastGeojson = { type: 'FeatureCollection', features: [] };
  render(map);
  status.textContent = 'AOI bathymetry grid: define an AOI.';
  status.className = 'status';
}

async function loadAoiGrid(map, aoi, status) {
  const generation = ++requestGeneration;
  const { points, nx, ny } = gridPoints(aoi);
  status.textContent = `AOI bathymetry grid: sampling ${nx}×${ny} points at native-scale spacing…`;
  status.className = 'status warn';

  const samples = await mapLimit(points, 6, async point => {
    const payload = await sampleDepth(point);
    const depth = depthValue(payload);
    // Zero/invalid values are omitted. This is deliberate: the numeric AOI
    // overlay must never paint a synthetic bathymetry patch over land.
    if (!Number.isFinite(depth) || depth <= 0.05) return null;
    return { ...point, depth };
  });
  if (generation !== requestGeneration) return;

  const valid = samples.filter(Boolean);
  lastGeojson = {
    type: 'FeatureCollection',
    features: valid.map(sample => ({
      type: 'Feature',
      properties: { depth_m: sample.depth, provenance: 'REAL_EMODNET_REST', native_resolution_m: NATIVE_GRID_M },
      geometry: { type: 'Point', coordinates: [sample.lon, sample.lat] }
    }))
  };
  render(map);

  if (!valid.length) {
    status.textContent = 'AOI bathymetry grid unavailable. WMS/visual layers remain independent from the land basemap.';
    status.className = 'status warn';
    return;
  }
  const depths = valid.map(item => item.depth);
  const min = Math.min(...depths);
  const max = Math.max(...depths);
  status.textContent = `AOI REAL bathymetry · ${valid.length}/${points.length} samples · ${min.toFixed(1)}–${max.toFixed(1)} m · native source ~${NATIVE_GRID_M} m`;
  status.className = 'status good';
}

function configureClientUi(map) {
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
  const firstBadge = document.querySelector('.header .badge');
  if (firstBadge) firstBadge.textContent = 'GitHub v0.14 Client Cartography';

  const sourceStatus = document.querySelector('#bathySourceStatus');
  if (sourceStatus && !document.querySelector('#aoiDepthGridStatus')) {
    const status = document.createElement('div');
    status.id = 'aoiDepthGridStatus';
    status.className = 'status';
    status.textContent = 'AOI bathymetry grid: define an AOI.';
    sourceStatus.insertAdjacentElement('afterend', status);
  }

  const mapNote = document.querySelector('.panel .data-note');
  if (mapNote) mapNote.textContent = 'Background/land and sea data are separate. Client basemaps: Minimal or Satellite. Bathymetry and isobaths are independent sea-data layers; the AOI numeric grid uses REAL EMODnet depth samples where available.';
}

const app = await waitForApp();
const map = app.map;
configureClientUi(map);
const status = document.querySelector('#aoiDepthGridStatus');

map.on('style.load', () => render(map));
ensureLayer(map);

subscribeState((next, patch) => {
  if (Object.prototype.hasOwnProperty.call(patch, 'aoi')) {
    if (!next.aoi) clear(map, status);
    else loadAoiGrid(map, next.aoi, status);
  }
});

if (state.aoi) loadAoiGrid(map, state.aoi, status);
