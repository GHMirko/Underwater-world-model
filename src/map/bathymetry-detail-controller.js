/**
 * Prevent low-resolution bathymetry from looking like micro-survey data.
 * Preserve high-zoom navigation and land basemap; restrict ONLY bathymetry layers.
 * MapLibre layer maxzoom is independent of visibility toggles set by other controllers.
 */
import { state, subscribeState } from '../state.js';
import { bathymetryDisplayPolicy } from './bathymetry-detail-policy.js';

// Zoom beyond native grid resolution is visual overzoom, not missing data.
 // Never alter MapLibre layer maxzoom here: that was hiding marine layers and
 // isobaths even when the user only wanted to inspect the map at large scale.
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
function updateStatus() {
  const policy = bathymetryDisplayPolicy(state, map.getZoom(), map.getCenter().lat);
  document.body.classList.toggle('bathymetry-coarse-view', Boolean(policy.limited));
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
    ? 'Sovrascala batimetrica: oltre z' + policy.zoomLimit.toFixed(1) +
      ' (' + native + '). Layer e isobate restano visibili come contesto indicativo, NON per misure locali.' + supporting
    : 'Risoluzione batimetrica insufficiente per analisi locali (' + native + supporting +
      '). Ingrandire non aggiunge dettaglio.';
  banner.classList.toggle('limited', policy.limited);
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    updateStatus();
  });
}

// The warning reacts to map zoom and source metadata only; it does not mutate marine layers.
map.on('styledata', schedule);
map.on('style.load', schedule);
map.on('zoom', () => { updateStatus(); schedule(); });
subscribeState((_, patch) => {
  if (['aoi', 'bathyMode', 'bathymetryQuality', 'bathymetryGridSource'].some(key =>
    Object.prototype.hasOwnProperty.call(patch, key))) schedule();
});
schedule();
