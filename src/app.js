import './styles.css';
import { createMap, setBaseMap } from './map/map-core.js';
import { LayerManager } from './map/layer-manager.js';
import { AoiController } from './map/aoi-controller.js';
import { AdaptiveContours } from './map/adaptive-contours.js';
import { renderDepthLegend } from './map/depth-legend.js';
import { sampleAoiBathymetry } from './data/emodnet.js';
import { DEFAULT_ENVIRONMENT_SELECTION, ENVIRONMENT_VARIABLES } from './data/source-registry.js';
import { buildCopernicusPython, buildEnvironmentalRequest } from './data/environmental-request.js';
import { downloadJson, downloadText } from './data/download.js';
import { ASSETS, DEFAULT_WEIGHTS, optimize } from './optimizer/core.js';
import { state, patchState } from './state.js';

const root = document.querySelector('#app');
root.innerHTML = `
<div class="app">
  <header class="header">
    <h1>Underwater Mission Optimizer</h1>
    <span class="badge">GitHub v0.9 Data Broker</span>
    <span class="badge">MapLibre bundled</span>
    <span class="badge">Regression-safe modules</span>
  </header>
  <div class="workspace">
    <section class="map-wrap">
      <div id="map" class="map"></div>
      <div id="depthLegend" class="depth-legend" aria-live="polite"></div>
    </section>
    <aside class="sidebar">
      <div class="panel">
        <h2>Map</h2>
        <div class="field"><label>Base map</label><select id="baseMap">
          <option value="chart">Chart</option><option value="satellite">Satellite</option><option value="terrain">Terrain</option><option value="minimal">Minimal</option>
        </select></div>
        <div class="field"><label>Bathymetry</label><select id="bathyMode">
          <option value="chart-relief">Chart Relief · dynamic</option>
          <option value="emodnet-rainbow">EMODnet Rainbow</option><option value="emodnet-multicolour">EMODnet Multicolour</option><option value="emodnet-atlas">EMODnet Atlas</option><option value="gebco-relief">GEBCO Relief</option><option value="none">None</option>
        </select></div>
        <div class="field"><label>Bathymetry opacity</label><input id="depthOpacity" type="range" min="0" max="100" value="72"></div>
        <label><input id="contours" type="checkbox" checked> Adaptive isobaths</label>
        <div class="field"><label>Isobath density</label><select id="contourDensity">
          <option value="dense">Dense chart + EMODnet major</option>
          <option value="major">EMODnet major only</option>
        </select></div>
        <div id="contourStatus" class="status">Waiting for map…</div>
      </div>

      <div class="panel">
        <h2>Mission & AOI</h2>
        <div class="row">
          <button id="drawAoi" class="btn primary">Draw AOI</button>
          <button id="clearAoi" class="btn">Clear AOI</button>
        </div>
        <div id="aoiStatus" class="status">No AOI selected.</div>
        <div id="bathyStatus" class="status">Bathymetry will be sampled automatically after AOI selection.</div>
        <div class="field"><label>Mission</label><select id="mission"><option>ASW</option><option>MCM</option><option>REA</option></select></div>
        <div class="field"><label>Max operating depth (m)</label><input id="maxDepth" type="number" value="500" min="0"></div>
      </div>

      <div class="panel" id="environmentPanel">
        <h2>Environmental Data Request</h2>
        <div class="row">
          <div class="field"><label>Start UTC</label><input id="envStart" type="datetime-local" step="3600"></div>
          <div class="field"><label>End UTC</label><input id="envEnd" type="datetime-local" step="3600"></div>
        </div>
        <div class="row">
          <div class="field"><label>Min depth (m)</label><input id="envMinDepth" type="number" min="0" value="0"></div>
          <div class="field"><label>Max depth (m)</label><input id="envMaxDepth" type="number" min="1" value="500"></div>
        </div>
        <div class="field"><label>Extract for AOI</label><div id="envVariables" class="env-vars"></div></div>
        <button id="buildEnvRequest" class="btn primary" style="width:100%">Build Environmental Data Request</button>
        <div id="envRequestStatus" class="status">Select an AOI, time/depth window and variables.</div>
        <div class="request-actions">
          <button id="downloadManifest" class="btn" disabled>Manifest JSON</button>
          <button id="downloadAoi" class="btn" disabled>AOI GeoJSON</button>
          <button id="downloadCopernicus" class="btn" disabled>Copernicus job</button>
          <a id="openBathymetry" class="btn btn-link disabled-link" target="_blank" rel="noreferrer">EMODnet bathy</a>
        </div>
        <div class="data-note">REAL gate remains OPEN until source jobs are executed and validated. Copernicus credentials are never stored in the browser.</div>
      </div>

      <div class="panel">
        <h2>Assets</h2>
        <div id="assets" class="assets"></div>
      </div>

      <div class="panel">
        <button id="optimize" class="btn primary" style="width:100%">Run Pareto optimizer</button>
        <div id="results" class="results" style="margin-top:8px"></div>
      </div>
    </aside>
  </div>
</div>`;

const map = createMap('map', state.baseMap);
const layers = new LayerManager(map);
const contours = new AdaptiveContours(map, message => {
  document.querySelector('#contourStatus').textContent = message;
});
const legendEl = document.querySelector('#depthLegend');
let currentEnvRequest = null;

function updateLegend() {
  renderDepthLegend(legendEl, state.bathyMode, state.bathymetry);
}

function utcInputValue(date) {
  return date.toISOString().slice(0, 16);
}

const initialStart = new Date();
initialStart.setUTCMinutes(0, 0, 0);
const initialEnd = new Date(initialStart.getTime() + 24 * 3600 * 1000);
document.querySelector('#envStart').value = utcInputValue(initialStart);
document.querySelector('#envEnd').value = utcInputValue(initialEnd);

document.querySelector('#envVariables').innerHTML = DEFAULT_ENVIRONMENT_SELECTION.map(id => {
  const variable = ENVIRONMENT_VARIABLES[id];
  return `<label><input type="checkbox" value="${id}" checked> <span><b>${variable.label}</b><small>${variable.provider}</small></span></label>`;
}).join('');

function setRequestButtons(enabled) {
  document.querySelector('#downloadManifest').disabled = !enabled;
  document.querySelector('#downloadAoi').disabled = !enabled;
  document.querySelector('#downloadCopernicus').disabled = !enabled;
  const bathy = document.querySelector('#openBathymetry');
  if (!enabled) {
    bathy.removeAttribute('href');
    bathy.classList.add('disabled-link');
  }
}

function invalidateEnvRequest(message = 'AOI or request parameters changed. Build the Environmental Data Request again.') {
  currentEnvRequest = null;
  setRequestButtons(false);
  const status = document.querySelector('#envRequestStatus');
  status.textContent = message;
  status.className = 'status';
}

function updateAoiStatus(aoi) {
  const el = document.querySelector('#aoiStatus');
  if (!aoi) {
    el.textContent = 'No AOI selected.';
    el.className = 'status';
    return;
  }
  el.textContent = `AOI ${aoi.minLat.toFixed(3)}…${aoi.maxLat.toFixed(3)} N · ${aoi.minLon.toFixed(3)}…${aoi.maxLon.toFixed(3)} E`;
  el.className = 'status good';
}

async function onAoiChanged(aoi) {
  patchState({ aoi, bathymetry: null });
  updateAoiStatus(aoi);
  updateLegend();
  invalidateEnvRequest(aoi ? 'AOI defined. Configure environmental request and build it.' : 'Select an AOI first.');
  if (!aoi) return;
  const status = document.querySelector('#bathyStatus');
  status.textContent = 'Retrieving numeric EMODnet bathymetry…';
  status.className = 'status warn';
  try {
    const bathymetry = await sampleAoiBathymetry(aoi);
    patchState({ bathymetry });
    status.textContent = `REAL EMODnet · ${bathymetry.samples}/9 · mean ${bathymetry.mean.toFixed(1)} m · σ ${bathymetry.sd.toFixed(1)} m`;
    status.className = 'status good';
    updateLegend();
  } catch (error) {
    status.textContent = 'Numeric bathymetry unavailable. Visual layers remain active; optimizer uses SURROGATE fallback.';
    status.className = 'status warn';
    updateLegend();
  }
}

const aoi = new AoiController(map, onAoiChanged);

document.querySelector('#drawAoi').addEventListener('click', event => {
  event.currentTarget.classList.add('active');
  aoi.clear();
  aoi.enable();
  document.querySelector('#aoiStatus').textContent = 'Drag on the map to define AOI.';
});

document.querySelector('#clearAoi').addEventListener('click', () => {
  document.querySelector('#drawAoi').classList.remove('active');
  aoi.disable();
  aoi.clear();
  patchState({ aoi: null, bathymetry: null });
  updateAoiStatus(null);
  updateLegend();
  invalidateEnvRequest('Select an AOI first.');
  document.querySelector('#bathyStatus').textContent = 'Bathymetry will be sampled automatically after AOI selection.';
});

map.on('mouseup', () => document.querySelector('#drawAoi').classList.remove('active'));

map.on('load', () => {
  layers.restore();
  contours.setDensity(state.contourDensity);
  contours.refresh();
});

document.querySelector('#baseMap').addEventListener('change', event => {
  patchState({ baseMap: event.target.value });
  setBaseMap(map, event.target.value);
});

document.querySelector('#bathyMode').addEventListener('change', event => {
  patchState({ bathyMode: event.target.value });
  layers.setBathymetry(event.target.value);
  updateLegend();
});

document.querySelector('#depthOpacity').addEventListener('input', event => {
  layers.setDepthOpacity(Number(event.target.value) / 100);
});

document.querySelector('#contours').addEventListener('change', event => {
  patchState({ contours: event.target.checked });
  contours.setVisible(event.target.checked);
});

document.querySelector('#contourDensity').addEventListener('change', event => {
  patchState({ contourDensity: event.target.value });
  contours.setDensity(event.target.value);
});

document.querySelector('#mission').addEventListener('change', event => patchState({ mission: event.target.value }));

document.querySelector('#environmentPanel').addEventListener('change', event => {
  if (event.target.id !== 'buildEnvRequest') invalidateEnvRequest();
});

document.querySelector('#buildEnvRequest').addEventListener('click', () => {
  const status = document.querySelector('#envRequestStatus');
  try {
    const variables = [...document.querySelectorAll('#envVariables input:checked')].map(input => input.value);
    currentEnvRequest = buildEnvironmentalRequest({
      aoi: state.aoi,
      startDatetime: document.querySelector('#envStart').value,
      endDatetime: document.querySelector('#envEnd').value,
      minDepth: Number(document.querySelector('#envMinDepth').value),
      maxDepth: Number(document.querySelector('#envMaxDepth').value),
      variables
    });
    const copernicus = currentEnvRequest.source_jobs.filter(job => job.provider === 'Copernicus Marine').length;
    const publicOgc = currentEnvRequest.source_jobs.filter(job => job.execution === 'PUBLIC_OGC').length;
    const discovery = currentEnvRequest.source_jobs.filter(job => job.execution === 'CAPABILITY_DISCOVERY_REQUIRED').length;
    status.textContent = `SOURCE-RESOLVED · ${variables.length} variables · ${currentEnvRequest.source_jobs.length} jobs · Copernicus ${copernicus} backend · public OGC ${publicOgc}${discovery ? ` · discovery ${discovery}` : ''}`;
    status.className = 'status good';
    setRequestButtons(true);
    const bathyJob = currentEnvRequest.source_jobs.find(job => job.id === 'emodnet-bathymetry');
    const bathyLink = document.querySelector('#openBathymetry');
    if (bathyJob) {
      bathyLink.href = bathyJob.request_url;
      bathyLink.classList.remove('disabled-link');
    }
  } catch (error) {
    currentEnvRequest = null;
    setRequestButtons(false);
    status.textContent = error.message;
    status.className = 'status warn';
  }
});

document.querySelector('#downloadManifest').addEventListener('click', () => {
  if (currentEnvRequest) downloadJson('environmental-request.json', currentEnvRequest);
});

document.querySelector('#downloadAoi').addEventListener('click', () => {
  if (currentEnvRequest) downloadJson('aoi.geojson', currentEnvRequest.geometry);
});

document.querySelector('#downloadCopernicus').addEventListener('click', () => {
  if (currentEnvRequest) downloadText('copernicus_subset.py', buildCopernicusPython(currentEnvRequest), 'text/x-python;charset=utf-8');
});

document.querySelector('#assets').innerHTML = ASSETS.map(asset => `
<label><input type="checkbox" value="${asset.id}" checked> <span><b>${asset.id}</b> · ${asset.type} · ${asset.maxDepth} m · ${asset.speed} kt · ${asset.endurance} h</span></label>
`).join('');

document.querySelector('#assets').addEventListener('change', () => {
  state.assets = new Set([...document.querySelectorAll('#assets input:checked')].map(input => input.value));
});

document.querySelector('#optimize').addEventListener('click', () => {
  const results = document.querySelector('#results');
  if (!state.aoi) {
    results.innerHTML = '<div class="status warn">Select an AOI first.</div>';
    return;
  }
  const ranked = optimize({
    aoi: state.aoi,
    bathymetry: state.bathymetry,
    selectedAssetIds: [...state.assets],
    mission: state.mission,
    maxDepth: Number(document.querySelector('#maxDepth').value) || 500,
    weights: DEFAULT_WEIGHTS[state.mission]
  }).slice(0, 3);
  results.innerHTML = ranked.length ? ranked.map((item, index) => `
    <div class="result"><b>${index === 0 ? 'Recommended' : `Alternative ${index + 1}`}</b><br>
    <b class="score">${(item.score * 100).toFixed(1)}</b><br>${item.id}<br>
    Coverage ${item.metrics.coverage.toFixed(1)}% · Time ${item.metrics.time.toFixed(1)} h<br>
    Cost ${item.metrics.cost.toFixed(2)} · Robustness ${item.metrics.robustness.toFixed(1)}<br>
    <small>${item.provenance}</small></div>`).join('') : '<div class="status warn">No feasible candidate.</div>';
});

updateLegend();
setRequestButtons(false);
window.__MSO__ = { map, layers, contours, aoi, state, updateLegend, buildEnvironmentalRequest };
