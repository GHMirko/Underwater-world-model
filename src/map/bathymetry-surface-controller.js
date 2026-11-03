import { state, patchState, subscribeState } from '../state.js';
import { interpolateBathymetrySurface } from './bathymetry-surface.js';

const WCS_SOURCE = 'aoi-wcs-grid-source';
const SURFACE_SOURCE = 'aoi-bathymetry-surface-source';
const SURFACE_LAYER = 'aoi-bathymetry-surface-layer';
const DEBUG_LAYERS = ['aoi-wcs-grid-layer', 'aoi-wcs-coastal-layer', 'aoi-depth-grid-layer', 'aoi-depth-grid-outline'];
let surfaceUrl = null;
let surfaceMeta = null;
let scheduled = null;
let generation = 0;

function waitForApp() {
  return new Promise(resolve => {
    const tick = () => {
      if (window.__MSO__?.map) resolve(window.__MSO__);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

function surfaceStatusElement() {
  let element = document.querySelector('#surfaceStatus');
  if (element) return element;
  const anchor = document.querySelector('#contourStatus');
  if (!anchor) return null;
  element = document.createElement('div');
  element.id = 'surfaceStatus';
  element.className = 'status';
  element.textContent = 'Display surface: waiting for numeric AOI bathymetry.';
  anchor.insertAdjacentElement('afterend', element);
  return element;
}

function currentOpacity() {
  const slider = document.querySelector('#depthOpacity');
  const requested = slider ? Number(slider.value) / 100 : 0.72;
  return Math.max(0.12, Math.min(0.78, requested * 0.82));
}

function sourceFeaturesToGrid(features) {
  const summary = state.bathymetryGrid;
  const aoi = state.aoi;
  if (!summary || !aoi || !Number.isInteger(summary.nx) || !Number.isInteger(summary.ny)) return null;
  const byKey = new Map();
  for (const feature of features ?? []) {
    const props = feature.properties ?? {};
    const ix = Number(props.ix);
    const iy = Number(props.iy);
    const depth = Number(props.depth_m);
    if (!Number.isInteger(ix) || !Number.isInteger(iy) || !Number.isFinite(depth)) continue;
    const key = `${ix}:${iy}`;
    if (byKey.has(key)) continue;
    let lon = null;
    let lat = null;
    const geometry = feature.geometry;
    if (geometry?.type === 'Point') {
      [lon, lat] = geometry.coordinates ?? [];
    } else if (geometry?.type === 'Polygon') {
      const ring = geometry.coordinates?.[0] ?? [];
      if (ring.length) {
        const lons = ring.map(coord => Number(coord[0])).filter(Number.isFinite);
        const lats = ring.map(coord => Number(coord[1])).filter(Number.isFinite);
        if (lons.length && lats.length) {
          lon = (Math.min(...lons) + Math.max(...lons)) / 2;
          lat = (Math.min(...lats) + Math.max(...lats)) / 2;
        }
      }
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    byKey.set(key, {
      ix, iy, lon, lat, depth,
      coastal_uncertain: Boolean(props.coastal_uncertain),
      water_fraction: Number.isFinite(Number(props.water_fraction)) ? Number(props.water_fraction) : 1
    });
  }
  const samples = [...byKey.values()];
  if (samples.length < 4) return null;
  return {
    nx: summary.nx,
    ny: summary.ny,
    samples,
    bbox: [aoi.minLon, aoi.minLat, aoi.maxLon, aoi.maxLat],
    min: Number(summary.min),
    max: Number(summary.max)
  };
}

function surfaceToDataUrl(surface) {
  const canvas = document.createElement('canvas');
  canvas.width = surface.width;
  canvas.height = surface.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable for display bathymetry surface');
  const image = context.createImageData(surface.width, surface.height);
  image.data.set(surface.rgba);
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function coordinatesFor(bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return [[minLon, maxLat], [maxLon, maxLat], [maxLon, minLat], [minLon, minLat]];
}

function removeSurface(map) {
  if (map.getLayer(SURFACE_LAYER)) map.removeLayer(SURFACE_LAYER);
  if (map.getSource(SURFACE_SOURCE)) map.removeSource(SURFACE_SOURCE);
  surfaceUrl = null;
  surfaceMeta = null;
}

function ensureSurface(map) {
  if (!surfaceUrl || !surfaceMeta || !map.isStyleLoaded()) return false;
  const coordinates = coordinatesFor(surfaceMeta.bbox);
  const existing = map.getSource(SURFACE_SOURCE);
  if (existing && typeof existing.updateImage === 'function') {
    existing.updateImage({ url: surfaceUrl, coordinates });
  } else if (!existing) {
    map.addSource(SURFACE_SOURCE, { type: 'image', url: surfaceUrl, coordinates });
  }
  if (!map.getLayer(SURFACE_LAYER)) {
    const before = map.getLayer('aoi-readable-contours-casing') ? 'aoi-readable-contours-casing'
      : map.getLayer('aoi-derived-contours-layer') ? 'aoi-derived-contours-layer'
        : undefined;
    map.addLayer({
      id: SURFACE_LAYER,
      type: 'raster',
      source: SURFACE_SOURCE,
      layout: { visibility: 'visible' },
      paint: { 'raster-opacity': currentOpacity(), 'raster-resampling': 'linear', 'raster-fade-duration': 0 }
    }, before);
  }
  map.setLayoutProperty(SURFACE_LAYER, 'visibility', state.bathyMode === 'aoi-adaptive' ? 'visible' : 'none');
  map.setPaintProperty(SURFACE_LAYER, 'raster-opacity', currentOpacity());
  if (map.getLayer('aoi-line')) map.moveLayer('aoi-line');
  return true;
}

function applyDebugVisibility(map) {
  const visible = state.bathyMode === 'aoi-adaptive' && state.debugBathymetryGrid ? 'visible' : 'none';
  for (const id of DEBUG_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible);
  }
}

function buildFromMap(map) {
  if (state.bathymetryGridSource !== 'EMODNET_WCS' || state.bathyMode !== 'aoi-adaptive') {
    if (map.getLayer(SURFACE_LAYER)) map.setLayoutProperty(SURFACE_LAYER, 'visibility', 'none');
    applyDebugVisibility(map);
    return;
  }
  if (!map.getSource(WCS_SOURCE)) return;
  const features = map.querySourceFeatures(WCS_SOURCE);
  const grid = sourceFeaturesToGrid(features);
  if (!grid) return;
  const surface = interpolateBathymetrySurface(grid, { width: 560 });
  if (!surface.rendered_pixels) return;
  surfaceUrl = surfaceToDataUrl(surface);
  surfaceMeta = surface;
  ensureSurface(map);
  applyDebugVisibility(map);
  const status = surfaceStatusElement();
  if (status) {
    const uncertainty = surface.rendered_pixels ? Math.round(100 * surface.uncertain_pixels / surface.rendered_pixels) : 0;
    status.textContent = `Display surface · continuous AOI colour map · ${surface.min.toFixed(1)}–${surface.max.toFixed(1)} m · ${uncertainty}% interpolated/coastal pixels · DATA grid unchanged`;
    status.className = 'status good';
  }
}

function schedule(map, delay = 100) {
  clearTimeout(scheduled);
  const token = ++generation;
  scheduled = setTimeout(() => {
    if (token !== generation || !map.isStyleLoaded()) return;
    try {
      buildFromMap(map);
      if (surfaceUrl) ensureSurface(map);
      applyDebugVisibility(map);
    } catch (error) {
      const status = surfaceStatusElement();
      if (status) {
        status.textContent = `Display surface unavailable: ${error?.message ?? 'render failed'} · numeric data layer remains available.`;
        status.className = 'status warn';
      }
    }
  }, delay);
}

const app = await waitForApp();
const map = app.map;
surfaceStatusElement();

const debug = document.querySelector('#debugBathymetryGrid');
if (debug) {
  debug.checked = Boolean(state.debugBathymetryGrid);
  debug.addEventListener('change', event => {
    patchState({ debugBathymetryGrid: event.target.checked });
    applyDebugVisibility(map);
  });
}

const opacity = document.querySelector('#depthOpacity');
if (opacity) opacity.addEventListener('input', () => schedule(map, 20));

subscribeState((next, patch) => {
  if (
    Object.prototype.hasOwnProperty.call(patch, 'bathymetryGridSource') ||
    Object.prototype.hasOwnProperty.call(patch, 'bathymetryGrid') ||
    Object.prototype.hasOwnProperty.call(patch, 'bathyMode') ||
    Object.prototype.hasOwnProperty.call(patch, 'baseMap') ||
    Object.prototype.hasOwnProperty.call(patch, 'aoi') ||
    Object.prototype.hasOwnProperty.call(patch, 'debugBathymetryGrid')
  ) schedule(map);
  if (!next.aoi) {
    try { removeSurface(map); } catch { /* style may be changing */ }
    const status = surfaceStatusElement();
    if (status) {
      status.textContent = 'Display surface: waiting for numeric AOI bathymetry.';
      status.className = 'status';
    }
  }
});

map.on('style.load', () => schedule(map, 120));
map.on('idle', () => {
  applyDebugVisibility(map);
  if (state.bathymetryGridSource === 'EMODNET_WCS' && state.bathyMode === 'aoi-adaptive') {
    if (!surfaceUrl) schedule(map, 30);
    else if (!map.getLayer(SURFACE_LAYER)) schedule(map, 30);
  }
});

schedule(map, 150);
