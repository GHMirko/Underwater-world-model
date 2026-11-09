/**
 * Prevent low-resolution bathymetry from looking like micro-survey data.
 * Preserve high-zoom navigation and land basemap; restrict ONLY bathymetry layers.
 * MapLibre layer maxzoom is independent of visibility toggles set by other controllers.
 */
import { state, subscribeState } from '../state.js';
import { bathymetryDisplayPolicy } from './bathymetry-detail-policy.js';

const DISPLAY_LAYERS = [
  'bathymetry-layer',
  'bathymetry-fallback-layer',
  'contours-fallback-layer',
  'adaptive-contours-line',
  'dense-isobaths-line',
  'aoi-bathymetry-surface-layer',
  'aoi-derived-contours-layer',
  'aoi-recovery-contours-layer',
  'aoi-readable-contours-casing',
  'aoi-wcs-grid-layer',
  'aoi-wcs-coastal-layer',
  'aoi-depth-grid-layer',
  'aoi-depth-grid-outline'
];

function waitForApp() {
  return new Promise(resolve => {
    const tick = () => {
      if (window.__MSO__?.map) resolve(window.__MSO__);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

const app = await waitForApp();
const map = app.map;
const panel = document.querySelector('.map-wrap');
const banner = document.createElement('div');
banner.id = 'bathymetryDetailLimit';
banner.className = 'bathymetry-detail-limit';
banner.setAttribute('role', 'status');
banner.setAttribute('aria-live', 'polite');
banner.hidden = true;
panel?.append(banner);

let scheduled = false;
function applyLimit() {
  if (!map.isStyleLoaded()) return;
  const policy = bathymetryDisplayPolicy(state, map.getZoom(), map.getCenter().lat);
  const limit = policy.enabled ? policy.zoomLimit : 22;
  for (const id of DISPLAY_LAYERS) {
    const layer = map.getLayer(id);
    if (!layer) continue;
    // Idempotent updates: setLayerZoomRange emits styledata, so avoid loops.
    if (Math.abs((layer.maxzoom ?? 24) - limit) > 0.001) {
      map.setLayerZoomRange(id, layer.minzoom ?? 0, limit);
    }
  }
}

function updateStatus() {
  const policy = bathymetryDisplayPolicy(state, map.getZoom(), map.getCenter().lat);
  document.body.classList.toggle('bathymetry-detail-limited', Boolean(policy.limited));
  if (!policy.enabled) {
    banner.hidden = true;
    return;
  }
  const microWarning = ['COARSE', 'UNRESOLVED'].includes(policy.spatialAdequacy);
  banner.hidden = !policy.limited && !microWarning;
  if (banner.hidden) return;
  const native = Number.isFinite(policy.resolutionM)
    ? 'griglia sorgente/contesto ~' + Math.round(policy.resolutionM) + ' m'
    : 'risoluzione sorgente non verificata';
  const supporting = microWarning ? ' · AOI non risolta dalla griglia' : '';
  banner.textContent = policy.limited
    ? 'Limite dettaglio batimetrico z' + policy.zoomLimit.toFixed(1) +
      ' superato: layer e isobate nascosti (' + native + '). Carta e AOI restano navigabili.' + supporting
    : 'Dettaglio batimetrico insufficiente (' + native + supporting +
      '). Zoom massimo della batimetria z' + policy.zoomLimit.toFixed(1) + '.';
  banner.classList.toggle('limited', policy.limited);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    try { applyLimit(); updateStatus(); } catch { /* MapLibre style transition */ }
  }, 0);
}

// The first pass and subsequent styledata events also cover layers recreated
// asynchronously by WCS, fallback, base-map or contour controllers.
map.on('styledata', schedule);
map.on('style.load', schedule);
map.on('zoom', () => { updateStatus(); schedule(); });
subscribeState((_, patch) => {
  if (['aoi', 'bathyMode', 'bathymetryQuality', 'bathymetryGridSource'].some(key =>
    Object.prototype.hasOwnProperty.call(patch, key))) schedule();
});
schedule();
