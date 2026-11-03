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

function setVisibility(layerId, visible) {
  if (!map.isStyleLoaded() || !map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function applyQualityPolicy() {
  if (!map.isStyleLoaded()) return;
  const adaptive = state.bathyMode === 'aoi-adaptive' && state.contours;
  const summary = state.adaptiveContours;
  const assessment = contourDisplayAssessment(summary);
  const recovery = summary?.derivation === 'BOUNDED_DENSER_NUMERIC_RECOVERY';
  const ready = adaptive && assessment.ready;

  if (map.getSource(LOCAL_SOURCE)) {
    if (ready && !recovery) {
      const stitched = stitchContourSegments(window.__MSO__.getLocalContours());
      map.getSource(LOCAL_SOURCE).setData(stitched);
    }
  }

  setVisibility(LOCAL_LAYER, ready && !recovery);
  setVisibility(RECOVERY_LAYER, ready && recovery);
}

function scheduleApply() {
  setTimeout(() => {
    try { applyQualityPolicy(); } catch { /* style lifecycle settling */ }
  }, 0);
  setTimeout(() => {
    try { applyQualityPolicy(); } catch { /* style lifecycle settling */ }
  }, 120);
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

map.on('style.load', scheduleApply);
scheduleApply();
