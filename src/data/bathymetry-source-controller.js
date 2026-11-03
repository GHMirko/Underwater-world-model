import { discoverBathymetrySource } from './bathymetry-selector.js';
import { patchState, state, subscribeState } from '../state.js';

function sameAoi(a, b) {
  if (!a || !b) return false;
  return ['minLon', 'minLat', 'maxLon', 'maxLat'].every(key => Math.abs(a[key] - b[key]) < 1e-10);
}

function ensureStatusElement() {
  let element = document.querySelector('#bathySourceStatus');
  if (element) return element;
  const anchor = document.querySelector('#bathyStatus');
  if (!anchor) return null;
  element = document.createElement('div');
  element.id = 'bathySourceStatus';
  element.className = 'status';
  element.textContent = 'Bathymetry source: define an AOI for HR-DTM discovery.';
  anchor.insertAdjacentElement('afterend', element);
  return element;
}

function resolutionText(value) {
  return Number.isFinite(value) ? `~${value < 10 ? value.toFixed(1) : value.toFixed(0)} m` : 'resolution metadata pending';
}

function renderSelection(selection) {
  const element = ensureStatusElement();
  if (!element) return;
  if (!selection) {
    element.textContent = 'Bathymetry source: define an AOI for HR-DTM discovery.';
    element.className = 'status';
    return;
  }
  const candidate = selection.primary;
  if (selection.status === 'HR_SELECTED') {
    element.textContent = `HR-DTM SELECTED · ${candidate?.name ?? 'EMODnet HR'} · ${resolutionText(selection.native_horizontal_resolution_m)} · AOI coverage ${(candidate.coverage_ratio * 100).toFixed(0)}%`;
    element.className = 'status good';
    return;
  }
  if (selection.status === 'HR_CANDIDATE_METADATA_REQUIRED') {
    element.textContent = `HR-DTM FOUND · ${candidate?.name ?? 'candidate'} · coverage ${(candidate.coverage_ratio * 100).toFixed(0)}% · direct data link not resolved, standard ~115 m remains executable fallback`;
    element.className = 'status warn';
    return;
  }
  if (selection.status === 'HR_PARTIAL_STANDARD_FALLBACK') {
    element.textContent = `HR-DTM PARTIAL · best coverage ${(candidate?.coverage_ratio * 100 || 0).toFixed(0)}% · standard EMODnet ~115 m selected for complete AOI`;
    element.className = 'status warn';
    return;
  }
  const discovery = selection.discovery === 'UNAVAILABLE' ? 'HR discovery unavailable' : 'No full HR-DTM coverage';
  element.textContent = `${discovery} · standard EMODnet DTM ~115 m fallback · ${selection.reason}`;
  element.className = 'status warn';
}

let sequence = 0;

async function resolveForAoi(aoi) {
  const requestId = ++sequence;
  const element = ensureStatusElement();
  if (element) {
    element.textContent = 'Bathymetry source: searching EMODnet HR-DTM footprints…';
    element.className = 'status warn';
  }
  const selection = await discoverBathymetrySource(aoi);
  if (requestId !== sequence || !sameAoi(aoi, state.aoi)) return;
  patchState({ bathymetrySource: selection });
  renderSelection(selection);
}

ensureStatusElement();
renderSelection(state.bathymetrySource);

subscribeState((current, patch) => {
  if (!Object.prototype.hasOwnProperty.call(patch, 'aoi')) return;
  sequence += 1;
  if (!current.aoi) {
    patchState({ bathymetrySource: null });
    renderSelection(null);
    return;
  }
  patchState({ bathymetrySource: null });
  resolveForAoi({ ...current.aoi });
});
