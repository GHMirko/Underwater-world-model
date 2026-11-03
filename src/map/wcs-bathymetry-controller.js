import { fetchEmodnetWcsGrid, EMODNET_STANDARD_RESOLUTION_M } from '../data/emodnet-wcs.js';
import { applyWaterMaskToGrid, fetchEmodnetWaterMask } from '../data/emodnet-water-mask.js';
import { state, patchState, subscribeState } from '../state.js';
import { aoiDimensionsMeters } from './spatial-scale.js';
import { AOI_ADAPTIVE_PALETTE, renderDepthLegend } from './depth-legend.js';
import { assessBathymetryConfidence, buildAdaptiveContours, chooseContourScheme, contourSummary } from './local-contours.js';
import { contourDisplayAssessment, stitchContourSegments } from './contour-quality.js';
import { maplibregl } from './map-core.js';

const GRID_SOURCE = 'aoi-wcs-grid-source';
const GRID_LAYER = 'aoi-wcs-grid-layer';
const COASTAL_LAYER = 'aoi-wcs-coastal-layer';
let generation = 0;
let activeAbort = null;
let gridGeojson = { type: 'FeatureCollection', features: [] };
let wcsContours = { type: 'FeatureCollection', features: [] };
let lastGrid = null;
let markers = [];

function waitForApp() {
  return new Promise(resolve => {
    const tick = () => {
      if (window.__MSO__?.map) resolve(window.__MSO__);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

function statusElement() {
  let status = document.querySelector('#wcsGridStatus');
  if (status) return status;
  const anchor = document.querySelector('#aoiDepthGridStatus') ?? document.querySelector('#bathySourceStatus');
  if (!anchor) return null;
  status = document.createElement('div');
  status.id = 'wcsGridStatus';
  status.className = 'status';
  status.textContent = 'AOI WCS bathymetry: waiting for AOI.';
  anchor.insertAdjacentElement('afterend', status);
  return status;
}

function currentOpacity() {
  const slider = document.querySelector('#depthOpacity');
  return slider ? Math.max(0.12, Math.min(0.92, Number(slider.value) / 100)) : 0.72;
}

function numericGridVisible() {
  return state.bathyMode === 'aoi-adaptive' && Boolean(lastGrid) && Boolean(state.debugBathymetryGrid);
}

function adaptiveExpression(range) {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return '#52b6d8';
  const min = range.min;
  const max = range.max > min ? range.max : min + 0.1;
  const expression = ['interpolate', ['linear'], ['get', 'depth_m']];
  AOI_ADAPTIVE_PALETTE.forEach((color, index) => {
    expression.push(min + ((max - min) * index) / (AOI_ADAPTIVE_PALETTE.length - 1), color);
  });
  return expression;
}

function cellsToGeojson(cells) {
  const features = [];
  for (const cell of cells) {
    const properties = {
      depth_m: cell.depth,
      provenance: 'REAL_EMODNET_WCS_GEOTIFF',
      native_resolution_m: EMODNET_STANDARD_RESOLUTION_M,
      ix: cell.ix,
      iy: cell.iy,
      water_fraction: cell.water_fraction ?? 1,
      coastal_uncertain: Boolean(cell.coastal_uncertain),
      shallow_water: Boolean(cell.shallow_water)
    };
    if (cell.coastal_uncertain) {
      features.push({
        type: 'Feature',
        properties,
        geometry: { type: 'Point', coordinates: [cell.lon ?? (cell.west + cell.east) / 2, cell.lat ?? (cell.south + cell.north) / 2] }
      });
    } else {
      features.push({
        type: 'Feature',
        properties,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [cell.west, cell.south],
            [cell.east, cell.south],
            [cell.east, cell.north],
            [cell.west, cell.north],
            [cell.west, cell.south]
          ]]
        }
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function ensureGridLayer(map) {
  if (!map.isStyleLoaded()) return false;
  if (!map.getSource(GRID_SOURCE)) map.addSource(GRID_SOURCE, { type: 'geojson', data: gridGeojson });
  if (!map.getLayer(GRID_LAYER)) {
    map.addLayer({
      id: GRID_LAYER,
      type: 'fill',
      source: GRID_SOURCE,
      layout: { visibility: numericGridVisible() ? 'visible' : 'none' },
      paint: {
        'fill-color': adaptiveExpression(lastGrid),
        'fill-opacity': currentOpacity(),
        'fill-outline-color': 'rgba(19,75,105,0.22)'
      }
    });
  }
  if (!map.getLayer(COASTAL_LAYER)) {
    map.addLayer({
      id: COASTAL_LAYER,
      type: 'circle',
      source: GRID_SOURCE,
      layout: { visibility: numericGridVisible() ? 'visible' : 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5, 19, 9, 22, 15],
        'circle-color': adaptiveExpression(lastGrid),
        'circle-opacity': ['interpolate', ['linear'], ['get', 'water_fraction'], 0.18, 0.24, 0.5, 0.42, 0.82, 0.62],
        'circle-stroke-color': 'rgba(235,249,255,.9)',
        'circle-stroke-width': 0.8
      }
    });
  }
  return true;
}

function renderGrid(map) {
  if (!ensureGridLayer(map)) return;
  const source = map.getSource(GRID_SOURCE);
  if (source) source.setData(gridGeojson);
  const visible = numericGridVisible() ? 'visible' : 'none';
  if (map.getLayer(GRID_LAYER)) {
    map.setLayoutProperty(GRID_LAYER, 'visibility', visible);
    map.setPaintProperty(GRID_LAYER, 'fill-color', adaptiveExpression(lastGrid));
    map.setPaintProperty(GRID_LAYER, 'fill-opacity', currentOpacity());
  }
  if (map.getLayer(COASTAL_LAYER)) {
    map.setLayoutProperty(COASTAL_LAYER, 'visibility', visible);
    map.setPaintProperty(COASTAL_LAYER, 'circle-color', adaptiveExpression(lastGrid));
  }
  if (map.getLayer('aoi-line')) map.moveLayer('aoi-line');
}

function clearMarkers() {
  for (const marker of markers) marker.remove();
  markers = [];
}

function featureMidpoint(feature) {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || !coords.length) return null;
  return coords[Math.floor(coords.length / 2)] ?? null;
}

function renderContourLabels(map) {
  clearMarkers();
  if (!state.contours || state.bathyMode !== 'aoi-adaptive' || state.bathymetryGridSource !== 'EMODNET_WCS') return;
  const summary = state.adaptiveContours;
  if (!contourDisplayAssessment(summary).ready) return;
  const stitched = stitchContourSegments(wcsContours);
  const grouped = new Map();
  for (const feature of stitched.features) {
    const depth = feature.properties?.depth_m;
    if (!Number.isFinite(depth)) continue;
    if (!grouped.has(depth)) grouped.set(depth, []);
    grouped.get(depth).push(feature);
  }
  for (const [depth, features] of [...grouped.entries()].slice(0, 12)) {
    const feature = features.reduce((best, current) => {
      const a = best?.geometry?.coordinates?.length ?? 0;
      const b = current?.geometry?.coordinates?.length ?? 0;
      return b > a ? current : best;
    }, features[0]);
    const point = featureMidpoint(feature);
    if (!point) continue;
    const el = document.createElement('div');
    el.className = 'contour-label';
    el.textContent = `${depth} m`;
    el.title = 'Derived from EMODnet WCS numeric DTM; not for close-proximity navigation';
    markers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(point).addTo(map));
  }
}

function renderLegend() {
  const element = document.querySelector('#depthLegend');
  if (!element || state.bathyMode !== 'aoi-adaptive' || !lastGrid) return;
  renderDepthLegend(element, 'aoi-adaptive', lastGrid);
}

function clear(map) {
  generation += 1;
  activeAbort?.abort();
  activeAbort = null;
  lastGrid = null;
  gridGeojson = { type: 'FeatureCollection', features: [] };
  wcsContours = { type: 'FeatureCollection', features: [] };
  clearMarkers();
  if (map.getSource(GRID_SOURCE)) map.getSource(GRID_SOURCE).setData(gridGeojson);
  if (map.getLayer(GRID_LAYER)) map.setLayoutProperty(GRID_LAYER, 'visibility', 'none');
  if (map.getLayer(COASTAL_LAYER)) map.setLayoutProperty(COASTAL_LAYER, 'visibility', 'none');
  if (state.bathymetryGridSource === 'EMODNET_WCS') {
    patchState({ bathymetryGridSource: null, bathymetryGrid: null, bathymetryQuality: null, adaptiveContours: null });
  }
  const status = statusElement();
  if (status) {
    status.textContent = 'AOI WCS bathymetry: waiting for AOI.';
    status.className = 'status';
  }
}

function reassertWcsState() {
  if (!lastGrid || state.bathymetryGridSource !== 'EMODNET_WCS') return;
  if (state.adaptiveContours?.derivation === 'EMODNET_WCS_NUMERIC_GRID') return;
  patchState({
    bathymetryGridSource: 'EMODNET_WCS',
    bathymetryGrid: lastGrid,
    bathymetryQuality: lastGrid.quality,
    adaptiveContours: lastGrid.contour_summary
  });
}

async function load(map, aoi) {
  const current = ++generation;
  activeAbort?.abort();
  const controller = new AbortController();
  activeAbort = controller;
  const status = statusElement();
  if (status) {
    status.textContent = 'AOI REAL WCS bathymetry: loading numeric GeoTIFF + no-land coastal mask…';
    status.className = 'status warn';
  }

  try {
    const rawGrid = await fetchEmodnetWcsGrid(aoi, { signal: controller.signal });
    if (current !== generation || controller.signal.aborted) return;

    let grid = rawGrid;
    let maskNote = 'mask unavailable';
    try {
      const mask = await fetchEmodnetWaterMask(aoi, { signal: controller.signal });
      if (current !== generation || controller.signal.aborted) return;
      grid = applyWaterMaskToGrid(rawGrid, mask);
      maskNote = `${grid.masked_land_cells} land cells masked · ${grid.coastal_cells} coastal cells uncertain`;
    } catch (maskError) {
      if (maskError?.name === 'AbortError') throw maskError;
      maskNote = `no-land mask unavailable: ${maskError?.message ?? 'request failed'}`;
    }

    const dimensions = aoiDimensionsMeters(aoi);
    const quality = assessBathymetryConfidence({
      aoiWidthM: dimensions.width,
      aoiHeightM: dimensions.height,
      nativeResolutionM: EMODNET_STANDARD_RESOLUTION_M,
      validSamples: grid.valid_cells,
      totalSamples: grid.total_cells,
      sourceType: 'EMODNET_STANDARD_WCS',
      derivation: 'NUMERIC_GRID'
    });
    const scheme = chooseContourScheme(grid.min, grid.max);
    const rawContours = buildAdaptiveContours({
      samples: grid.samples,
      nx: grid.nx,
      ny: grid.ny,
      scheme,
      metadata: {
        source: 'EModnet Bathymetry WCS / standard DTM GeoTIFF',
        native_resolution_m: EMODNET_STANDARD_RESOLUTION_M,
        confidence: quality.confidence,
        confidence_score: quality.confidence_score,
        coverage_ratio: quality.coverage_ratio,
        estimated_horizontal_uncertainty_m: quality.estimated_horizontal_uncertainty_m,
        fitness_for_use: quality.fitness_for_use,
        coastal_mask: grid.water_mask_applied ? grid.water_mask_source : null
      }
    });
    const summary = contourSummary(rawContours, scheme, quality);
    summary.derivation = 'EMODNET_WCS_NUMERIC_GRID';
    summary.source = 'EMODNET_WCS';
    summary.grid = `${grid.nx}x${grid.ny}`;
    summary.valid_cells = grid.valid_cells;
    summary.total_cells = grid.total_cells;
    summary.water_mask_applied = Boolean(grid.water_mask_applied);
    summary.coastal_cells = grid.coastal_cells ?? 0;
    summary.masked_land_cells = grid.masked_land_cells ?? 0;

    wcsContours = rawContours;
    lastGrid = {
      min: grid.min,
      max: grid.max,
      mean: grid.mean,
      samples: grid.valid_cells,
      total: grid.total_cells,
      nx: grid.nx,
      ny: grid.ny,
      source: 'REAL_EMODNET_WCS_GEOTIFF',
      water_mask_applied: Boolean(grid.water_mask_applied),
      coastal_cells: grid.coastal_cells ?? 0,
      masked_land_cells: grid.masked_land_cells ?? 0,
      quality,
      contour_summary: summary
    };
    gridGeojson = cellsToGeojson(grid.cells);
    window.__MSO__.getWcsLocalContours = () => wcsContours;
    patchState({
      bathymetryGridSource: 'EMODNET_WCS',
      bathymetryGrid: lastGrid,
      bathymetryQuality: quality,
      adaptiveContours: summary
    });
    renderGrid(map);
    renderLegend();
    setTimeout(() => renderContourLabels(map), 80);

    const assessment = contourDisplayAssessment(summary);
    if (status) {
      const shallow = scheme.levels.filter(level => level.shallow_priority).map(level => `${level.depth_m}m`).join('/');
      status.textContent = `AOI REAL WCS · ${grid.nx}×${grid.ny} · ${grid.valid_cells}/${grid.total_cells} wet-depth cells · ${grid.min.toFixed(1)}–${grid.max.toFixed(1)} m · ${scheme.interval_m} m contours${shallow ? ` + shallow ${shallow}` : ''} · ${maskNote} · ${assessment.ready ? 'LOCAL ACCEPTED' : `LOCAL INSUFFICIENT: ${assessment.reason}`}`;
      status.className = assessment.ready ? 'status good' : 'status warn';
    }
  } catch (error) {
    if (current !== generation || error?.name === 'AbortError') return;
    if (status) {
      status.textContent = `AOI WCS unavailable (${error?.message ?? 'request failed'}) · REST point sampling remains fallback.`;
      status.className = 'status warn';
    }
  }
}

const app = await waitForApp();
const map = app.map;
window.__MSO__.getWcsLocalContours = () => wcsContours;
statusElement();
ensureGridLayer(map);

const opacitySlider = document.querySelector('#depthOpacity');
if (opacitySlider) opacitySlider.addEventListener('input', () => renderGrid(map));

subscribeState((next, patch) => {
  if (Object.prototype.hasOwnProperty.call(patch, 'aoi')) {
    if (!next.aoi) clear(map);
    else load(map, next.aoi);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'baseMap')) {
    setTimeout(() => { renderGrid(map); renderContourLabels(map); }, 120);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'bathyMode') || Object.prototype.hasOwnProperty.call(patch, 'debugBathymetryGrid')) {
    renderGrid(map);
    renderLegend();
    renderContourLabels(map);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'contours')) renderContourLabels(map);
  if (
    lastGrid &&
    Object.prototype.hasOwnProperty.call(patch, 'adaptiveContours') &&
    next.bathymetryGridSource === 'EMODNET_WCS' &&
    next.adaptiveContours?.derivation !== 'EMODNET_WCS_NUMERIC_GRID'
  ) setTimeout(reassertWcsState, 0);
});

map.on('style.load', () => setTimeout(() => { renderGrid(map); renderContourLabels(map); }, 80));
map.on('idle', () => {
  if (state.bathymetryGridSource === 'EMODNET_WCS') {
    renderGrid(map);
    reassertWcsState();
  }
});

if (state.aoi) load(map, state.aoi);
