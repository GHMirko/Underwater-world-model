import './styles.css';
import { createMap, setBaseMap } from './map/map-core.js';
import { LayerManager } from './map/layer-manager.js';
import { AoiController } from './map/aoi-controller.js';
import { AdaptiveContours } from './map/adaptive-contours.js';
import { renderDepthLegend } from './map/depth-legend.js';
import { aoiDimensionsMeters, formatMeters, recommendedZoomForAoi, resolutionAssessment } from './map/spatial-scale.js';
import { sampleAoiBathymetry } from './data/emodnet.js';
import { DEFAULT_ENVIRONMENT_SELECTION, ENVIRONMENT_VARIABLES } from './data/source-registry.js';
import { buildCopernicusPython, buildEnvironmentalRequest } from './data/environmental-request.js';
import { buildWorldModelPackage } from './data/world-model-package.js';
import { buildBathymetryDiscoveryPlan, summarizeBathymetryPlan } from './data/bathymetry-source-broker.js';
import { downloadJson, downloadText } from './data/download.js';
import { ASSETS, DEFAULT_WEIGHTS, optimize } from './optimizer/core.js';
import { state, patchState, subscribeState } from './state.js';

const root = document.querySelector('#app');
root.innerHTML = `
<div class="app">
  <header class="header">
    <h1>Underwater Mission Optimizer</h1>
    <span class="badge">GitHub v0.19 Bathymetry Source Broker</span>
    <span class="badge">MapLibre z22</span>
    <span class="badge">Resolution-aware Data Broker</span>
  </header>
  <div class="workspace">
    <section class="map-wrap">
      <div id="map" class="map"></div>
      <div id="depthLegend" class="depth-legend" aria-live="polite"></div>
    </section>
    <aside class="sidebar">
      <div class="panel">
        <h2>Map</h2>
        <div class="field"><label>Base map / land</label><select id="baseMap">
          <option value="chart">Chart</option><option value="satellite">Satellite</option><option value="terrain">Terrain</option><option value="minimal">Minimal</option>
        </select></div>
        <div class="field"><label>Bathymetry overlay · sea only</label><select id="bathyMode">
          <option value="chart-relief">Chart Relief · sea-only</option>
          <option value="emodnet-rainbow">EMODnet Rainbow · sea-only</option>
          <option value="emodnet-multicolour">EMODnet Multicolour · sea-only</option>
          <option value="none">None</option>
        </select></div>
        <div class="field"><label>Bathymetry opacity</label><input id="depthOpacity" type="range" min="0" max="100" value="72"></div>
        <label class="debug-control"><input id="debugBathymetryGrid" type="checkbox"> Debug numeric grid · engineering only</label>
        <label><input id="contours" type="checkbox" checked> Source-matched isobaths</label>
        <div class="field"><label>Isobath detail</label><select id="contourDensity">
          <option value="dense">Detailed where source supports it</option>
          <option value="major">Major only where source supports it</option>
        </select></div>
        <div id="contourStatus" class="status">Waiting for map…</div>
        <div class="data-note">Normal view uses a continuous display surface plus derived isobaths. The native numeric grid is hidden unless Debug is enabled; analytical consumers always use the numeric data layer, never the display texture.</div>
      </div>

      <div class="panel">
        <h2>Mission & AOI</h2>
        <div class="row">
          <button id="drawAoi" class="btn primary">Draw AOI</button>
          <button id="clearAoi" class="btn">Clear AOI</button>
        </div>
        <button id="fitAoi" class="btn" style="width:100%;margin-top:6px" disabled>Fit AOI / micro-zoom</button>
        <div id="aoiStatus" class="status">No AOI selected.</div>
        <div id="aoiScaleStatus" class="status">Viewer supports zoom to level 22. AOI is auto-fitted after drawing; analysis resolution remains source-dependent.</div>
        <div id="bathyStatus" class="status">Bathymetry will be sampled automatically after AOI selection.</div>
        <div id="bathySourceStatus" class="status">Bathymetry source: define an AOI for HR-DTM discovery.</div>
        <div class="field"><label>Mission</label><select id="mission"><option>ASW</option><option>MCM</option><option>REA</option></select></div>
        <div class="field"><label>Max operating depth (m)</label><input id="maxDepth" type="number" value="500" min="0"></div>
      </div>


      <div class="panel" id="bathyBrokerPanel">
        <h2>Bathymetry Source Broker</h2>
        <div id="bathyBrokerStatus" class="status">Define an AOI to build a best-available bathymetry strategy.</div>
        <div id="bathyBrokerCandidates" class="source-candidates"></div>
        <div class="request-actions">
          <button id="downloadBathyPlan" class="btn" disabled>Bathymetry plan JSON</button>
        </div>
        <div class="data-note">The broker ranks sources by role, coverage, resolution, access and fitness. Regional inclusion never implies actual dataset coverage: discovery/coverage tests remain explicit gates.</div>
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
        <div class="field"><label>Target analysis grid (m)</label><input id="analysisGridM" type="number" min="1" value="25"><small class="field-note">Computational grid only. It never upgrades native source resolution.</small></div>
        <div class="field"><label>Extract for AOI</label><div id="envVariables" class="env-vars"></div></div>
        <div id="spatialAdequacy" class="spatial-adequacy">Define an AOI to assess source resolution.</div>
        <button id="buildEnvRequest" class="btn primary" style="width:100%">Build Environmental Data Request</button>
        <div id="envRequestStatus" class="status">Select an AOI, time/depth window and variables.</div>
        <div class="request-actions">
          <button id="downloadManifest" class="btn" disabled>Manifest JSON</button>
          <button id="downloadWorldModel" class="btn" disabled>World Model package</button>
          <button id="downloadAoi" class="btn" disabled>AOI GeoJSON</button>
          <button id="downloadCopernicus" class="btn" disabled>Copernicus job</button>
          <a id="openBathymetry" class="btn btn-link disabled-link" target="_blank" rel="noreferrer">Bathymetry source</a>
        </div>
        <div class="data-note">The World Model Package links view layers to analytical sources, provenance, quality and standardized extraction jobs. REAL gate remains OPEN until source jobs are executed and validated.</div>
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
contours.setBathymetryMode(state.bathyMode);
const legendEl = document.querySelector('#depthLegend');
let currentEnvRequest = null;

function updateLegend() {
  renderDepthLegend(legendEl, state.bathyMode, state.bathymetry);
}

function utcInputValue(date) {
  return date.toISOString().slice(0, 16);
}

function fitToAoi(aoiValue = state.aoi, duration = 450) {
  if (!aoiValue) return;
  const bounds = [[aoiValue.minLon, aoiValue.minLat], [aoiValue.maxLon, aoiValue.maxLat]];
  map.fitBounds(bounds, { padding: 80, maxZoom: 21, duration });
}

const initialStart = new Date();
initialStart.setUTCMinutes(0, 0, 0);
const initialEnd = new Date(initialStart.getTime() + 24 * 3600 * 1000);
document.querySelector('#envStart').value = utcInputValue(initialStart);
document.querySelector('#envEnd').value = utcInputValue(initialEnd);

document.querySelector('#envVariables').innerHTML = DEFAULT_ENVIRONMENT_SELECTION.map(id => {
  const variable = ENVIRONMENT_VARIABLES[id];
  const resolution = Number.isFinite(variable.nativeHorizontalResolutionM) ? ` · ~${formatMeters(variable.nativeHorizontalResolutionM)}` : '';
  return `<label><input type="checkbox" value="${id}" checked> <span><b>${variable.label}</b><small>${variable.provider}${resolution}</small></span></label>`;
}).join('');

function setRequestButtons(enabled) {
  document.querySelector('#downloadManifest').disabled = !enabled;
  document.querySelector('#downloadWorldModel').disabled = !enabled;
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

function selectedEnvironmentVariables() {
  return [...document.querySelectorAll('#envVariables input:checked')].map(input => input.value);
}

function renderBathymetryBroker() {
  const status = document.querySelector('#bathyBrokerStatus');
  const list = document.querySelector('#bathyBrokerCandidates');
  const button = document.querySelector('#downloadBathyPlan');
  if (!state.aoi) {
    patchState({ bathymetryDiscoveryPlan: null });
    status.textContent = 'Define an AOI to build a best-available bathymetry strategy.';
    status.className = 'status';
    list.innerHTML = '';
    button.disabled = true;
    return;
  }
  const targetGridM = Number(document.querySelector('#analysisGridM')?.value) || 25;
  const plan = buildBathymetryDiscoveryPlan(state.aoi, {
    targetGridM,
    estimatedMinDepthM: Number.isFinite(state.bathymetry?.min) ? state.bathymetry.min : null,
    estimatedMaxDepthM: Number.isFinite(state.bathymetry?.max) ? state.bathymetry.max : null
  });
  if (state.bathymetrySource) {
    plan.runtime_discovery = {
      status: state.bathymetrySource.status ?? null,
      selected_source: state.bathymetrySource.selected_source ?? null,
      native_horizontal_resolution_m: state.bathymetrySource.native_horizontal_resolution_m ?? null,
      reason: state.bathymetrySource.reason ?? null
    };
    if (state.bathymetrySource.status === 'HR_SELECTED') {
      plan.recommended_strategy.current_executable_baseline = 'EMODNET_HR_DTM';
    }
  }
  patchState({ bathymetryDiscoveryPlan: plan });
  const summary = summarizeBathymetryPlan(plan, 7);
  const potential = plan.recommended_strategy.best_potential_source ?? 'NONE';
  const baseline = plan.recommended_strategy.current_executable_baseline ?? 'NONE';
  status.textContent = `BEST AVAILABLE PLAN · baseline ${baseline} · best potential ${potential} · ${plan.candidates.length} candidates · ${plan.area_profile.micro_aoi ? 'micro-AOI' : 'regional AOI'}`;
  status.className = 'status good';
  list.innerHTML = summary.map((item, index) => {
    const res = Number.isFinite(item.resolution_m) ? `~${formatMeters(item.resolution_m)}` : 'metadata/variable';
    return `<div class="source-candidate ${item.use_class.toLowerCase()}"><b>${index + 1}. ${item.label}</b><span>${item.use_class} · ${item.availability} · ${item.applicability} · ${res}</span></div>`;
  }).join('');
  button.disabled = false;
}


function renderSpatialAdequacy() {
  const el = document.querySelector('#spatialAdequacy');
  if (!state.aoi) {
    el.innerHTML = 'Define an AOI to assess source resolution.';
    return;
  }
  const rows = selectedEnvironmentVariables().map(id => {
    const variable = ENVIRONMENT_VARIABLES[id];
    const selectedBathyResolution = id === 'bathymetry' && Number.isFinite(state.bathymetrySource?.native_horizontal_resolution_m)
      ? state.bathymetrySource.native_horizontal_resolution_m
      : variable.nativeHorizontalResolutionM;
    const assessment = resolutionAssessment(state.aoi, selectedBathyResolution);
    const resolution = Number.isFinite(selectedBathyResolution) ? formatMeters(selectedBathyResolution) : 'variable / metadata required';
    const cells = assessment.cellsAcrossMin == null ? '' : ` · ${assessment.cellsAcrossMin.toFixed(1)} cells across short side`;
    return `<div class="adequacy-row ${assessment.status.toLowerCase()}"><b>${variable.label}</b><span>${assessment.status} · native ${resolution}${cells}</span></div>`;
  });
  el.innerHTML = rows.join('') || 'Select at least one environmental variable.';
}

function updateAoiStatus(aoiValue) {
  const el = document.querySelector('#aoiStatus');
  const scale = document.querySelector('#aoiScaleStatus');
  const fit = document.querySelector('#fitAoi');
  fit.disabled = !aoiValue;
  if (!aoiValue) {
    el.textContent = 'No AOI selected.';
    el.className = 'status';
    scale.textContent = 'Viewer supports zoom to level 22. AOI is auto-fitted after drawing; analysis resolution remains source-dependent.';
    scale.className = 'status';
    renderSpatialAdequacy();
    return;
  }
  const dimensions = aoiDimensionsMeters(aoiValue);
  const zoom = recommendedZoomForAoi(aoiValue);
  const micro = dimensions.maxDimension <= 1000;
  el.textContent = `AOI ${aoiValue.minLat.toFixed(5)}…${aoiValue.maxLat.toFixed(5)} N · ${aoiValue.minLon.toFixed(5)}…${aoiValue.maxLon.toFixed(5)} E`;
  el.className = 'status good';
  scale.textContent = `${micro ? 'MICRO-AOI · ' : ''}${formatMeters(dimensions.width)} × ${formatMeters(dimensions.height)} · ${(dimensions.area / 1e6).toFixed(dimensions.area < 1e6 ? 3 : 1)} km² · auto-fit ~z${zoom.toFixed(1)}`;
  scale.className = micro ? 'status good' : 'status';
  renderSpatialAdequacy();
}

async function onAoiChanged(aoiValue) {
  patchState({ aoi: aoiValue, bathymetry: null, bathymetryDiscoveryPlan: null });
  updateAoiStatus(aoiValue);
  renderBathymetryBroker();
  updateLegend();
  invalidateEnvRequest(aoiValue ? 'AOI defined. Configure environmental request and build it.' : 'Select an AOI first.');
  if (!aoiValue) return;

  fitToAoi(aoiValue);

  const status = document.querySelector('#bathyStatus');
  status.textContent = 'Retrieving numeric EMODnet bathymetry…';
  status.className = 'status warn';
  try {
    const bathymetry = await sampleAoiBathymetry(aoiValue);
    patchState({ bathymetry });
    renderBathymetryBroker();
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

document.querySelector('#fitAoi').addEventListener('click', () => fitToAoi());

document.querySelector('#clearAoi').addEventListener('click', () => {
  document.querySelector('#drawAoi').classList.remove('active');
  aoi.disable();
  aoi.clear();
  patchState({ aoi: null, bathymetry: null, bathymetryDiscoveryPlan: null });
  updateAoiStatus(null);
  renderBathymetryBroker();
  updateLegend();
  invalidateEnvRequest('Select an AOI first.');
  document.querySelector('#bathyStatus').textContent = 'Bathymetry will be sampled automatically after AOI selection.';
});

map.on('mouseup', () => document.querySelector('#drawAoi').classList.remove('active'));

map.on('load', () => {
  layers.restore();
  contours.setBathymetryMode(state.bathyMode);
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
  contours.setBathymetryMode(event.target.value);
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

const environmentPanel = document.querySelector('#environmentPanel');
const invalidateOnEnvironmentalEdit = event => {
  if (event.target.matches('input, select')) {
    invalidateEnvRequest();
    renderSpatialAdequacy();
  }
};
environmentPanel.addEventListener('input', invalidateOnEnvironmentalEdit);
environmentPanel.addEventListener('change', invalidateOnEnvironmentalEdit);
document.querySelector('#analysisGridM').addEventListener('change', renderBathymetryBroker);

document.querySelector('#downloadBathyPlan').addEventListener('click', () => {
  if (state.bathymetryDiscoveryPlan) downloadJson('bathymetry-source-plan.json', state.bathymetryDiscoveryPlan);
});

document.querySelector('#buildEnvRequest').addEventListener('click', () => {
  const status = document.querySelector('#envRequestStatus');
  try {
    const variables = selectedEnvironmentVariables();
    currentEnvRequest = buildEnvironmentalRequest({
      aoi: state.aoi,
      startDatetime: document.querySelector('#envStart').value,
      endDatetime: document.querySelector('#envEnd').value,
      minDepth: Number(document.querySelector('#envMinDepth').value),
      maxDepth: Number(document.querySelector('#envMaxDepth').value),
      analysisGridM: Number(document.querySelector('#analysisGridM').value),
      variables,
      bathymetrySelection: state.bathymetrySource,
      bathymetryDiscoveryPlan: state.bathymetryDiscoveryPlan
    });
    const copernicus = currentEnvRequest.source_jobs.filter(job => job.provider === 'Copernicus Marine').length;
    const publicOgc = currentEnvRequest.source_jobs.filter(job => job.execution === 'PUBLIC_OGC').length;
    const directHr = currentEnvRequest.source_jobs.filter(job => job.execution === 'DIRECT_HR_DOWNLOAD').length;
    const discovery = currentEnvRequest.source_jobs.filter(job => job.execution === 'CAPABILITY_DISCOVERY_REQUIRED').length;
    const unresolved = currentEnvRequest.source_jobs.filter(job => job.spatial_adequacy?.status === 'UNRESOLVED').length;
    const coarse = currentEnvRequest.source_jobs.filter(job => job.spatial_adequacy?.status === 'COARSE').length;
    status.textContent = `SOURCE-RESOLVED · ${variables.length} variables · ${currentEnvRequest.source_jobs.length} jobs · Copernicus ${copernicus} backend · HR bathy ${directHr}${publicOgc ? ` · public OGC ${publicOgc}` : ''}${discovery ? ` · discovery ${discovery}` : ''}${unresolved || coarse ? ` · spatial: ${unresolved} unresolved / ${coarse} coarse` : ''}`;
    status.className = unresolved ? 'status warn' : 'status good';
    setRequestButtons(true);
    const bathyJob = currentEnvRequest.source_jobs.find(job => ['emodnet-bathymetry', 'emodnet-hr-bathymetry', 'gebco-2026-bathymetry'].includes(job.id));
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

document.querySelector('#downloadWorldModel').addEventListener('click', () => {
  if (!currentEnvRequest) return;
  downloadJson('world-model-aoi-package.json', buildWorldModelPackage({ state, environmentalRequest: currentEnvRequest }));
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
renderSpatialAdequacy();
renderBathymetryBroker();
subscribeState((next, patch) => {
  if (Object.prototype.hasOwnProperty.call(patch, 'bathymetrySource') && next.aoi) renderBathymetryBroker();
});
window.__MSO__ = { map, layers, contours, aoi, state, updateLegend, fitToAoi, buildEnvironmentalRequest, buildWorldModelPackage, aoiDimensionsMeters, resolutionAssessment };
