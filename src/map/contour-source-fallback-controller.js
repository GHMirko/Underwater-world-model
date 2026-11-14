/**
 * Continuous bathymetric cartography:
 * - regional EMODnet published contours remain visible as CONTEXT during AOI
 *   acquisition and when numerical AOI data are incomplete;
 * - actual AOI isolines, when available, are a distinct high-contrast layer;
 * - QA rejected AOI contours may be displayed with an explicit provisional
 *   warning, but are never exported or used as predictor inputs.
 *
 * The context source is never recorded as AOI numeric data.
 */
import { state, subscribeState } from '../state.js';
import { regionalBathymetryRegion } from './bathymetry-context.js';
import { contourPresentationPolicy } from './contour-presentation-policy.js';

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
let cachedRegion = null;

function setStatus(text, kind='', mode='unavailable') {
  const node = document.querySelector('#contourStatus');
  if (node) {
    node.textContent = text;
    node.className = kind ? 'status '+kind : 'status';
  }
  const overlay = document.querySelector('#mapContourStatus');
  if (overlay) {
    overlay.textContent = text;
    overlay.dataset.mode = mode;
  }
}
function contextRegion() {
  // The geographic gate is indicative, not a claim of data availability.
  const focus = state.aoi
    ? { lng:(state.aoi.minLon+state.aoi.maxLon)/2,
        lat:(state.aoi.minLat+state.aoi.maxLat)/2 }
    : map.getCenter();
  return regionalBathymetryRegion(focus);
}
function setContextMode(active) {
  if (!active) {
    isContextActive = false;
    cachedRegion = null;
    if (engine.visible) engine.setVisible(false);
    return;
  }
  engine.setContextOnly(true, state.contourCount);
  if (engine.bathymetryMode !== 'emodnet-multicolour')
    engine.setBathymetryMode('emodnet-multicolour');
  if (engine.density !== state.contourDensity)
    engine.setDensity(state.contourDensity);
  cachedRegion = contextRegion();
  isContextActive = true;
  if (!engine.visible) engine.setVisible(true);
  else engine.setContextCount(state.contourCount);
}
function applyPolicy() {
  const region = contextRegion();
  const policy = contourPresentationPolicy({
    aoi:state.aoi,contours:state.contours,bathyMode:state.bathyMode,
    hasRegionalContext:Boolean(region),summary:state.adaptiveContours
  });
  // Do not detach context layers just because the user drew an AOI.
  setContextMode(policy.contextVisible);

  if (policy.mode === 'off') {
    setStatus('Isobate disattivate','','unavailable');
  } else if (policy.mode === 'context') {
    setStatus('CONTESTO EMODnet · isobate pubblicate di riferimento · seleziona AOI per dato numerico','',
      'context');
  } else if (policy.mode === 'unavailable') {
    setStatus('Contesto EMODnet non disponibile nella regione selezionata','warn','unavailable');
  } else if (policy.mode === 'aoi-context-fallback') {
    const detail = policy.numericAssessment.reason || 'griglia numerica in acquisizione';
    setStatus('AOI · isobate NUMERICHE ancora assenti. CONTESTO EMODnet mantenuto come riferimento, NON valido per calcoli · '+
      detail,'warn','context-with-aoi');
  } else if (policy.mode === 'aoi-provisional') {
    setStatus('AOI · isobate NUMERICHE PROVVISORIE visibili, qualità insufficiente per il calcolo · '+
      policy.numericAssessment.reason+
      (policy.contextVisible?' · contesto EMODnet mantenuto in tratteggio':''),
      'warn','aoi-provisional');
  } else if (policy.mode === 'aoi-validated') {
    const s=state.adaptiveContours;
    setStatus('AOI · isobate NUMERICHE · '+(s.requested_levels??state.contourCount)+' richieste / '+
      (s.available_levels??s.levels_m?.length??0)+' disponibili · confidenza '+(s.confidence??'DA VERIFICARE')+' · qualità di visualizzazione accettata'+
      (policy.contextVisible?' · contesto EMODnet tratteggiato (non analitico)':''),
      'good','aoi-validated');
  } else {
    setStatus('AOI · griglia numerica assente e contesto non disponibile','warn','aoi-unavailable');
  }
}

// The engine sends updates about WFS/WMS availability; do not overwrite
// the more important AOI QA status. Context render state stays independent.
const underlyingStatus=engine.onStatus;
engine.onStatus=message=>{
  if (!isContextActive || !state.contours) return;
  if (!state.aoi) {
    underlyingStatus(message);
    const overlay=document.querySelector('#mapContourStatus');
    if(overlay){overlay.textContent=message;overlay.dataset.mode='context';}
  }
};

subscribeState((_,patch)=>{
  if(['aoi','adaptiveContours','bathymetryGridSource','bathyMode',
      'contours','contourDensity','contourCount'].some(key=>
      Object.prototype.hasOwnProperty.call(patch,key)))
    queueMicrotask(applyPolicy);
});
map.on('style.load',applyPolicy);
map.on('moveend',()=>{if(!state.aoi)applyPolicy();});
applyPolicy();

// Integration tests inspect the two authorities without relying on pixels.
window.__MSO__.getContourPresentationPolicy=()=>contourPresentationPolicy({
  aoi:state.aoi,contours:state.contours,bathyMode:state.bathyMode,
  hasRegionalContext:Boolean(contextRegion()),summary:state.adaptiveContours
});
