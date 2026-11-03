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

function applyQualityPolicy() {
  if (applying || !map.isStyleLoaded()) return;
  applying = true;
  try {
    const adaptive = state.bathyMode === 'aoi-adaptive' && state.contours;
    const summary = state.adaptiveContours;
    const assessment = contourDisplayAssessment(summary);
    const recovery = summary?.derivation === 'BOUNDED_DENSER_NUMERIC_RECOVERY';
    const ready = adaptive && assessment.ready;

    if (map.getSource(LOCAL_SOURCE) && ready && !recovery) {
      const stitched = stitchContourSegments(window.__MSO__.getLocalContours());
      map.getSource(LOCAL_SOURCE).setData(stitched);
    }

    // This controller is the final authority for derived-contour visibility.
    // Earlier renderers may recreate layers during style/state transitions,
    // but they may not override the user's isobath toggle or the quality gate.
    setVisibility(LOCAL_LAYER, ready && !recovery);
    setVisibility(RECOVERY_LAYER, ready && recovery);
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
    Object.prototype.hasOwnProperty.call(patch, 'bathyMode') ||
    Object.prototype.hasOwnProperty.call(patch, 'contours') ||
    Object.prototype.hasOwnProperty.call(patch, 'contourDensity') ||
    Object.prototype.hasOwnProperty.call(patch, 'baseMap') ||
    Object.prototype.hasOwnProperty.call(patch, 'aoi')
  ) scheduleApply();
});

const contourToggle = document.querySelector('#contours');
if (contourToggle) contourToggle.addEventListener('change', scheduleApply);

map.on('style.load', scheduleApply);
map.on('idle', applyQualityPolicy);
scheduleApply();
