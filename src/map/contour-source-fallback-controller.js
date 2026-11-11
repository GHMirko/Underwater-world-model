/**
 * v0.28: AOI-derived isolines are the sole operational contour source.
 * No WFS/WMS background contours are substituted when local data are absent:
 * they would not be clipped to the AOI or share the chosen numeric source.
 */
import { state, subscribeState } from '../state.js';
import { contourDisplayAssessment } from './contour-quality.js';

function waitForApp() {
  return new Promise(resolve => {
    const tick = () => window.__MSO__?.contours ? resolve(window.__MSO__) : requestAnimationFrame(tick);
    tick();
  });
}

const app = await waitForApp();
const engine = app.contours;
const setStatus = (message, good = false) => {
  const status = document.querySelector('#contourStatus');
  if (!status) return;
  status.textContent = message;
  status.className = good ? 'status good' : 'status warn';
};

function ensureOperationalContoursOnly() {
  if (engine.visible) engine.setVisible(false);
  if (!state.contours || state.bathyMode === 'none') {
    setStatus('Isobate AOI disattivate');
    return;
  }
  if (!state.aoi) {
    setStatus('Definire AOI: isobate solo da griglia batimetrica numerica, nessuna curva di contesto');
    return;
  }
  const summary = state.adaptiveContours;
  const quality = contourDisplayAssessment(summary);
  if (!quality.ready) {
    setStatus('Isobate AOI non disponibili: ' +
      (summary ? quality.reason : 'acquisizione dati numerici in corso o non riuscita') +
      ' · non vengono interpolate curve WMS esterne.');
    return;
  }
  setStatus(`Isobate AOI numeriche · ${summary.requested_levels ?? state.contourCount} richieste / ${summary.available_levels ?? summary.levels_m?.length ?? 0} disponibili · ${summary.feature_count} segmenti · confidenza ${summary.confidence}`,true);
}

subscribeState((_,patch) => {
  if (['aoi','adaptiveContours','bathymetryGridSource','bathyMode','contours','contourDensity','contourCount']
    .some(key => Object.prototype.hasOwnProperty.call(patch,key))) {
    queueMicrotask(ensureOperationalContoursOnly);
  }
});
app.map.on('style.load',ensureOperationalContoursOnly);
ensureOperationalContoursOnly();
