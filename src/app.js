import './styles.css';
import { createMap, setBaseMap } from './map/map-core.js';
import { LayerManager } from './map/layer-manager.js';
import { AoiController } from './map/aoi-controller.js';
import { AdaptiveContours } from './map/adaptive-contours.js';
import { renderDepthLegend } from './map/depth-legend.js';
import { sampleAoiBathymetry } from './data/emodnet.js';
import { ASSETS, DEFAULT_WEIGHTS, optimize } from './optimizer/core.js';
import { state, patchState } from './state.js';

const root = document.querySelector('#app');
root.innerHTML = `
<div class="app">
  <header class="header">
    <h1>Underwater Mission Optimizer</h1>
    <span class="badge">GitHub v0.8 cartography</span>
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

function updateLegend() {
  renderDepthLegend(legendEl, state.bathyMode, state.bathymetry);
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
window.__MSO__ = { map, layers, contours, aoi, state, updateLegend };
