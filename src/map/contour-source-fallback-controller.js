import { state, subscribeState } from '../state.js';

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
  return `Adaptive isobaths · ${summary.interval_m} m interval · ${summary.levels_m.length} levels · confidence ${summary.confidence} · coverage ${(summary.coverage_ratio * 100).toFixed(0)}%`;
}

const app = await waitForApp();
const contourEngine = app.contours;
const originalStatus = contourEngine.onStatus;
let contextFallback = false;

contourEngine.onStatus = message => {
  originalStatus(contextFallback ? `CONTEXT ONLY · ${message}` : message);
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
  const localReady = Boolean(summary?.feature_count > 0);

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

  // Best-available-information policy: before a numeric AOI exists, or when
  // the local grid cannot yet produce a trustworthy crossing, keep the
  // authoritative EMODnet contour service visible as context. It is never
  // promoted to the local analytical World Model layer.
  contextFallback = true;
  contourEngine.setBathymetryMode('emodnet-rainbow');
  contourEngine.setDensity(state.contourDensity);
  contourEngine.setVisible(true);

  const status = statusElement();
  if (status) {
    const reason = state.aoi
      ? `local numeric grid produced no contour crossing${summary?.confidence ? ` · local confidence ${summary.confidence}` : ''}`
      : 'define an AOI to replace context with local derived isobaths';
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
    // Run after the primary cartography controller has reacted to the same
    // state patch. This controller only arbitrates which contour source is
    // visible; it does not own the World Model data.
    setTimeout(applyContourSourcePolicy, 0);
  }
});

const badge = document.querySelector('.header .badge');
if (badge) badge.textContent = 'GitHub v0.16.1 Context + Local Isobaths';

applyContourSourcePolicy();
