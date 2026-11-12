/**
 * The map has two deliberately separate contour authorities:
 * 1. Before the operator draws an AOI: published EMODnet context isolines
 *    when browsing its regional geographic footprint (WFS vectors with a
 *    transparent, contour-only WMS fallback).
 * 2. With AOI: contours computed from the acquired numeric AOI grid,
 *    subject to its quality gate. Context is disabled and cancelled.
 *
 * Context contours are NEVER treated as AOI data, never exported to the
 * experiment and never passed to acoustic or optimization pipelines.
 * Selection of GEBCO/Chart Relief changes source reference metadata only:
 * contextual contours in EMODnet regions are explicitly labelled EMODnet.
 */
import { state, subscribeState } from '../state.js';
import { regionalBathymetryRegion } from './bathymetry-context.js';
import { contourDisplayAssessment } from './contour-quality.js';

function waitForApp() {
  return new Promise(resolve => {
    const tick = () => window.__MSO__?.contours && window.__MSO__?.map
      ? resolve(window.__MSO__) : requestAnimationFrame(tick);
    tick();
  });
}

const app = await waitForApp();
const engine = app.contours;
const map = app.map;
let isContextActive = false;

function status(text, kind = '') {
  const node = document.querySelector('#contourStatus');
  if (!node) return;
  node.textContent = text;
  node.className = kind ? 'status ' + kind : 'status';
  const overlay = document.querySelector('#mapContourStatus');
  if (overlay) {
    overlay.textContent = text;
    overlay.dataset.mode = isContextActive ? 'context' : state.aoi ? 'aoi' : 'unavailable';
  }
}

function setContextMode(active) {
  if (!active) {
    isContextActive = false;
    if (engine.visible) engine.setVisible(false);
    return;
  }
  engine.setContextOnly(true, state.contourCount);
  engine.setDensity(state.contourDensity);
  if (engine.bathymetryMode !== 'emodnet-multicolour')
    engine.setBathymetryMode('emodnet-multicolour');
  isContextActive = true;
  if (!engine.visible) engine.setVisible(true);
  else engine.setContextCount(state.contourCount);
}

function applyPolicy() {
  if (!state.contours || state.bathyMode === 'none') {
    setContextMode(false);
    status('Isobate disattivate');
    return;
  }

  // Published context is a navigational reference only. Use regional gate
  // before any WFS request; do not claim coverage merely from bbox.
  if (!state.aoi) {
    const region = regionalBathymetryRegion(map.getCenter());
    if (!region) {
      setContextMode(false);
      status('Nessuna AOI · fuori copertura indicativa EMODnet: isobate di contesto non disponibili', 'warn');
      return;
    }
    setContextMode(true);
    if (!map.getLayer('adaptive-contours-line') && !map.getLayer('contours-fallback-layer'))
      status('CONTESTO EMODnet · acquisizione isobate pubblicate per la vista in corso…');
    return;
  }

  // AOI begins: cancel in-flight WFS and remove any old context WMS/labels.
  setContextMode(false);
  const summary = state.adaptiveContours;
  const assessment = contourDisplayAssessment(summary);
  if (!assessment.ready) {
    status('AOI · isobate numeriche non disponibili: ' +
      (summary ? assessment.reason : 'acquisizione della griglia numerica in corso o non riuscita') +
      '. Nessuna isobata di contesto viene scambiata per dato AOI.', 'warn');
    return;
  }
  status(`AOI · isobate NUMERICHE · ${summary.requested_levels ?? state.contourCount} richieste / ${summary.available_levels ?? summary.levels_m.length} disponibili · confidenza ${summary.confidence}`,
    summary.confidence === 'HIGH' || summary.confidence === 'MEDIUM' ? 'good' : 'warn');
}

// Other async subsystems may update the contour status when context was
// disabled. Only forward genuine context engine messages while it is active.
const reportEngineStatus = engine.onStatus;
engine.onStatus = message => {
  if (!isContextActive || state.aoi || !state.contours) return;
  reportEngineStatus(message);
  const overlay = document.querySelector('#mapContourStatus');
  if (overlay) {
    overlay.textContent = message;
    overlay.dataset.mode = 'context';
  }
};

subscribeState((_, patch) => {
  if (['aoi','adaptiveContours','bathymetryGridSource','bathyMode','contours','contourDensity','contourCount']
    .some(key => Object.prototype.hasOwnProperty.call(patch,key))) queueMicrotask(applyPolicy);
});
map.on('style.load', applyPolicy);
map.on('moveend', () => { if (!state.aoi) applyPolicy(); });
applyPolicy();
