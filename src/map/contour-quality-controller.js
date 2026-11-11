import { state, subscribeState } from '../state.js';
import { contourDisplayAssessment, stitchContourSegments } from './contour-quality.js';

const LOCAL_SOURCE = 'aoi-derived-contours-source';
const LOCAL_LAYER = 'aoi-derived-contours-layer';
const RECOVERY_LAYER = 'aoi-recovery-contours-layer';

function waitForApp() {
  return new Promise(resolve => {
    const tick = () => {
      if (window.__MSO__?.map && window.__MSO__?.getLocalContours) resolve(window.__MSO__);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

const app = await waitForApp();
const map = app.map;
let applying = false;

function setVisibility(layerId, visible) {
  if (!map.isStyleLoaded() || !map.getLayer(layerId)) return;
  const desired = visible ? 'visible' : 'none';
  if (map.getLayoutProperty(layerId, 'visibility') !== desired) {
    map.setLayoutProperty(layerId, 'visibility', desired);
  }
}

function authoritativeContours() {
  if (state.bathymetryGridSource === 'EMODNET_WCS' && window.__MSO__.getWcsLocalContours) {
    return window.__MSO__.getWcsLocalContours();
  }
  return window.__MSO__.getLocalContours();
}

function applyQualityPolicy() {
  if (applying || !map.isStyleLoaded()) return;
  applying = true;
  try {
    const adaptive = state.bathyMode !== 'none' && state.contours;
    const summary = state.adaptiveContours;
    const assessment = contourDisplayAssessment(summary);
    const recovery = summary?.derivation === 'BOUNDED_DENSER_NUMERIC_RECOVERY';
    const ready = adaptive && assessment.ready;

    if (map.getSource(LOCAL_SOURCE) && ready && !recovery) {
      const stitched = stitchContourSegments(authoritativeContours());
      map.getSource(LOCAL_SOURCE).setData(stitched);
    }

    // This controller is the final authority for derived-contour visibility.
    // WCS numeric contours take precedence over REST/recovery geometry when
    // a full numeric raster has been acquired for the AOI.
    setVisibility(LOCAL_LAYER, ready && !recovery);
    setVisibility(RECOVERY_LAYER, ready && recovery && state.bathymetryGridSource !== 'EMODNET_WCS');
    const densityFilter = state.contourDensity === 'major' ? ['==', ['get', 'major'], true] : null;
    if (map.getLayer(LOCAL_LAYER)) map.setFilter(LOCAL_LAYER, densityFilter);
    if (map.getLayer(RECOVERY_LAYER)) map.setFilter(RECOVERY_LAYER, densityFilter);
  } finally {
    applying = false;
  }
}

function scheduleApply() {
  [0, 60, 180, 420].forEach(delay => {
    setTimeout(() => {
      try { applyQualityPolicy(); } catch { /* style lifecycle settling */ }
    }, delay);
  });
}

subscribeState((next, patch) => {
  if (
    Object.prototype.hasOwnProperty.call(patch, 'adaptiveContours') ||
    Object.prototype.hasOwnProperty.call(patch, 'bathymetryGridSource') ||
    Object.prototype.hasOwnProperty.call(patch, 'bathyMode') ||
    Object.prototype.hasOwnProperty.call(patch, 'contours') ||
    Object.prototype.hasOwnProperty.call(patch, 'contourDensity') ||
    Object.prototype.hasOwnProperty.call(patch, 'aoi')
  ) {
    try { applyQualityPolicy(); } catch { /* style graph may still be settling */ }
    scheduleApply();
  }
});

const contourToggle = document.querySelector('#contours');
if (contourToggle) contourToggle.addEventListener('change', scheduleApply);

map.on('style.load', scheduleApply);
map.on('idle', applyQualityPolicy);
scheduleApply();
