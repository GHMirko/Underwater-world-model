import { state, subscribeState } from '../state.js';
import { stitchContourSegments } from './contour-quality.js';
import { maplibregl } from './map-core.js';

const GRID_LAYER = 'aoi-wcs-grid-layer';
const COASTAL_LAYER = 'aoi-wcs-coastal-layer';
const CONTOUR_SOURCE = 'aoi-derived-contours-source';
const CONTOUR_LAYER = 'aoi-derived-contours-layer';
const CASING_LAYER = 'aoi-readable-contours-casing';

let markers = [];
let timer = null;
let applying = false;

function waitForApp() {
  return new Promise(resolve => {
    const tick = () => {
      if (window.__MSO__?.map) resolve(window.__MSO__);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

function active() {
  return state.bathyMode === 'aoi-adaptive' &&
    state.contours &&
    state.bathymetryGridSource === 'EMODNET_WCS';
}

function injectCss() {
  if (document.querySelector('#wcs-readable-cartography-css')) return;
  const style = document.createElement('style');
  style.id = 'wcs-readable-cartography-css';
  style.textContent = `
    body.wcs-readable-cartography .contour-label{display:none!important}
    .wcs-readable-label{
      pointer-events:none;
      white-space:nowrap;
      font:700 10px/1 Segoe UI,Arial,sans-serif;
      color:#102b39;
      background:rgba(248,252,255,.94);
      border:1px solid rgba(16,43,57,.72);
      border-radius:4px;
      padding:2px 4px;
      box-shadow:0 1px 3px rgba(0,0,0,.34);
      transform:translateZ(0);
    }
    .wcs-readable-label.shallow{
      color:#493700;
      background:rgba(255,248,199,.95);
      border-color:rgba(116,91,0,.72);
    }
  `;
  document.head.appendChild(style);
}

function clearMarkers() {
  for (const marker of markers) marker.remove();
  markers = [];
}

function effectiveGridOpacity() {
  const slider = document.querySelector('#depthOpacity');
  const requested = slider ? Number(slider.value) / 100 : 0.72;
  return Math.max(0.16, Math.min(0.72, requested * 0.78));
}

function ensureCasing(map) {
  if (!map.isStyleLoaded() || !map.getSource(CONTOUR_SOURCE) || !map.getLayer(CONTOUR_LAYER)) return false;
  if (!map.getLayer(CASING_LAYER)) {
    map.addLayer({
      id: CASING_LAYER,
      type: 'line',
      source: CONTOUR_SOURCE,
      layout: {
        visibility: active() ? 'visible' : 'none',
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': 'rgba(7,25,35,.88)',
        'line-width': ['case', ['==', ['get', 'major'], true], 4.8, ['==', ['get', 'shallow_priority'], true], 4.1, 3.0],
        'line-opacity': 0.82,
        'line-blur': 0.15
      }
    }, CONTOUR_LAYER);
  }
  return true;
}

function styleLayers(map) {
  if (map.getLayer(GRID_LAYER)) {
    map.setPaintProperty(GRID_LAYER, 'fill-outline-color', 'rgba(0,0,0,0)');
    map.setPaintProperty(GRID_LAYER, 'fill-antialias', false);
    map.setPaintProperty(GRID_LAYER, 'fill-opacity', effectiveGridOpacity());
  }
  if (map.getLayer(COASTAL_LAYER)) {
    map.setPaintProperty(COASTAL_LAYER, 'circle-stroke-width', 0.7);
    map.setPaintProperty(COASTAL_LAYER, 'circle-stroke-color', 'rgba(238,250,255,.88)');
  }

  if (!active()) {
    if (map.getLayer(CASING_LAYER)) map.setLayoutProperty(CASING_LAYER, 'visibility', 'none');
    return;
  }

  if (!ensureCasing(map)) return;
  const filter = state.contourDensity === 'major' ? ['==', ['get', 'major'], true] : null;

  map.setLayoutProperty(CASING_LAYER, 'visibility', 'visible');
  map.setFilter(CASING_LAYER, filter);

  map.setLayoutProperty(CONTOUR_LAYER, 'visibility', 'visible');
  map.setFilter(CONTOUR_LAYER, filter);
  map.setLayoutProperty(CONTOUR_LAYER, 'line-cap', 'round');
  map.setLayoutProperty(CONTOUR_LAYER, 'line-join', 'round');
  map.setPaintProperty(CONTOUR_LAYER, 'line-color', [
    'case',
    ['==', ['get', 'shallow_priority'], true], '#fff0a8',
    ['==', ['get', 'major'], true], '#ffffff',
    '#d7f4ff'
  ]);
  map.setPaintProperty(CONTOUR_LAYER, 'line-width', [
    'case',
    ['==', ['get', 'major'], true], 2.5,
    ['==', ['get', 'shallow_priority'], true], 2.0,
    1.35
  ]);
  map.setPaintProperty(CONTOUR_LAYER, 'line-opacity', ['case', ['==', ['get', 'major'], true], 1.0, 0.92]);
}

function longestLine(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return [];
  if (geometry.type === 'LineString') return geometry.coordinates ?? [];
  if (geometry.type === 'MultiLineString') {
    return (geometry.coordinates ?? []).reduce((best, line) => line.length > best.length ? line : best, []);
  }
  return [];
}

function candidatePoints(feature) {
  const line = longestLine(feature);
  if (line.length < 2) return [];
  const fractions = [0.5, 0.35, 0.65, 0.22, 0.78];
  return fractions.map(fraction => line[Math.max(0, Math.min(line.length - 1, Math.round((line.length - 1) * fraction)))]);
}

function labelDepths(grouped) {
  const depths = [...grouped.keys()].sort((a, b) => a - b);
  const wanted = new Set();
  for (const depth of depths) {
    const features = grouped.get(depth) ?? [];
    if (features.some(feature => feature.properties?.shallow_priority)) wanted.add(depth);
  }
  if (depths.length <= 4) depths.forEach(depth => wanted.add(depth));
  else depths.filter((_, index) => index % 2 === 1).forEach(depth => wanted.add(depth));
  return wanted;
}

function collides(point, occupied) {
  return occupied.some(other => Math.abs(point.x - other.x) < 72 && Math.abs(point.y - other.y) < 28);
}

function renderLabels(map) {
  clearMarkers();
  if (!active() || !window.__MSO__?.getWcsLocalContours) return;

  const stitched = stitchContourSegments(window.__MSO__.getWcsLocalContours());
  const grouped = new Map();
  for (const feature of stitched.features ?? []) {
    const depth = Number(feature.properties?.depth_m);
    if (!Number.isFinite(depth)) continue;
    if (!grouped.has(depth)) grouped.set(depth, []);
    grouped.get(depth).push(feature);
  }

  const wanted = labelDepths(grouped);
  const occupied = [];
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  for (const depth of [...wanted].sort((a, b) => a - b)) {
    const features = grouped.get(depth) ?? [];
    features.sort((a, b) => longestLine(b).length - longestLine(a).length);
    let placed = false;

    for (const feature of features.slice(0, 3)) {
      for (const lngLat of candidatePoints(feature)) {
        const pixel = map.project(lngLat);
        if (pixel.x < 45 || pixel.y < 45 || pixel.x > width - 45 || pixel.y > height - 45) continue;
        if (collides(pixel, occupied)) continue;

        const element = document.createElement('div');
        const shallow = Boolean(feature.properties?.shallow_priority);
        element.className = `wcs-readable-label${shallow ? ' shallow' : ''}`;
        element.textContent = `${depth} m`;
        element.title = shallow
          ? 'Shallow-priority derived contour; native WCS resolution and coastal uncertainty still apply'
          : 'Derived from EMODnet WCS numeric DTM; visual label only';
        markers.push(new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(lngLat).addTo(map));
        occupied.push(pixel);
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
}

function apply(map) {
  if (applying || !map.isStyleLoaded()) return;
  applying = true;
  try {
    document.body.classList.toggle('wcs-readable-cartography', active());
    styleLayers(map);
    renderLabels(map);
  } finally {
    applying = false;
  }
}

function schedule(map) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { apply(map); } catch { /* style graph may still be settling */ }
  }, 90);
}

const app = await waitForApp();
const map = app.map;
injectCss();
schedule(map);

subscribeState((next, patch) => {
  if (
    Object.prototype.hasOwnProperty.call(patch, 'bathymetryGridSource') ||
    Object.prototype.hasOwnProperty.call(patch, 'adaptiveContours') ||
    Object.prototype.hasOwnProperty.call(patch, 'bathyMode') ||
    Object.prototype.hasOwnProperty.call(patch, 'contours') ||
    Object.prototype.hasOwnProperty.call(patch, 'contourDensity') ||
    Object.prototype.hasOwnProperty.call(patch, 'baseMap') ||
    Object.prototype.hasOwnProperty.call(patch, 'aoi')
  ) schedule(map);
});

const opacitySlider = document.querySelector('#depthOpacity');
if (opacitySlider) opacitySlider.addEventListener('input', () => schedule(map));
map.on('moveend', () => schedule(map));
map.on('zoomend', () => schedule(map));
map.on('style.load', () => schedule(map));
