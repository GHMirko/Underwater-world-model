import { state, subscribeState } from '../state.js';
import { contourDisplayAssessment } from './contour-quality.js';

function waitForApp() {
  return new Promise(resolve => {
    const tick = () => {
      if (window.__MSO__?.contours && window.__MSO__?.map) resolve(window.__MSO__);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

function statusElement() {
  return document.querySelector('#contourStatus');
}

function localSummaryText(summary) {
  if (!summary?.feature_count) return null;
  const quality = contourDisplayAssessment(summary);
  return `Adaptive isobaths · ${summary.interval_m} m interval · ${summary.levels_m.length} levels · confidence ${summary.confidence} · coverage ${(summary.coverage_ratio * 100).toFixed(0)}% · ${quality.ready ? 'LOCAL ACCEPTED' : 'LOCAL INSUFFICIENT'}`;
}

const app = await waitForApp();
const contourEngine = app.contours;
const originalStatus = contourEngine.onStatus;
let contextFallback = false;

contourEngine.onStatus = message => {
  if (!contextFallback) {
    originalStatus(message);
    return;
  }
  const phase = state.aoi
    ? 'local derived contour unavailable or below quality gate'
    : 'waiting for local AOI bathymetry';
  originalStatus(`CONTEXT ONLY · ${phase} · ${message}`);
};

function applyContourSourcePolicy() {
  if (state.bathyMode !== 'aoi-adaptive') {
    contextFallback = false;
    return;
  }

  if (!state.contours) {
    contextFallback = false;
    if (contourEngine.visible) contourEngine.setVisible(false);
    const status = statusElement();
    if (status) status.textContent = 'Adaptive isobaths off';
    return;
  }

  const summary = state.adaptiveContours;
  const assessment = contourDisplayAssessment(summary);
  const localReady = Boolean(summary?.feature_count > 0 && assessment.ready);

  if (localReady) {
    contextFallback = false;
    if (contourEngine.visible) contourEngine.setVisible(false);
    const status = statusElement();
    if (status) {
      status.textContent = localSummaryText(summary);
      status.className = summary.confidence === 'HIGH' || summary.confidence === 'MEDIUM' ? 'status good' : 'status warn';
    }
    return;
  }

  contextFallback = true;
  contourEngine.setBathymetryMode('emodnet-rainbow');
  contourEngine.setDensity(state.contourDensity);
  contourEngine.setVisible(true);

  const status = statusElement();
  if (status) {
    const reason = state.aoi
      ? summary?.feature_count
        ? `local evidence insufficient · ${assessment.reason}`
        : `local numeric grid produced no contour crossing${summary?.confidence ? ` · local confidence ${summary.confidence}` : ''}`
      : 'waiting for local AOI bathymetry';
    status.textContent = `CONTEXT ONLY · EMODnet isobaths · ${reason}`;
    status.className = 'status warn';
  }
}

subscribeState((next, patch) => {
  if (
    Object.prototype.hasOwnProperty.call(patch, 'aoi') ||
    Object.prototype.hasOwnProperty.call(patch, 'adaptiveContours') ||
    Object.prototype.hasOwnProperty.call(patch, 'bathyMode') ||
    Object.prototype.hasOwnProperty.call(patch, 'contours') ||
    Object.prototype.hasOwnProperty.call(patch, 'contourDensity') ||
    Object.prototype.hasOwnProperty.call(patch, 'baseMap')
  ) {
    setTimeout(applyContourSourcePolicy, 0);
  }
});

const badge = document.querySelector('.header .badge');
if (badge) badge.textContent = 'GitHub v0.16 Confidence-Aware Contours · v0.16.2';

applyContourSourcePolicy();
