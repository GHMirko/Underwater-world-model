import { maplibregl } from './map-core.js';
import { SEASCAPE_VECTOR, contourFamilyForBathymetry, emodnetWms } from './config.js';
import { contourThreshold, filterContours, selectContextContourLevels } from './contour-model.js';

const SOURCE = 'adaptive-contours-source';
const LINE = 'adaptive-contours-line';
const FALLBACK_SOURCE = 'contours-fallback-source';
const FALLBACK_LAYER = 'contours-fallback-layer';
const DENSE_SOURCE = 'dense-isobaths-source';
const DENSE_LINE = 'dense-isobaths-line';

function featureMidpoint(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
  if (!lines.length) return null;
  const line = lines.reduce((best, current) => current.length > best.length ? current : best, lines[0]);
  return line[Math.floor(line.length / 2)] ?? null;
}

export class AdaptiveContours {
  constructor(map, onStatus = () => {}) {
    this.map = map;
    this.onStatus = onStatus;
    this.visible = false; // Context contours opt-in only when NO AOI exists.
    this.contextOnly = false;
    this.maxContextLevels = 8;
    this.density = 'dense';
    this.bathymetryMode = 'chart-relief';
    this.family = contourFamilyForBathymetry(this.bathymetryMode);
    this.raw = null;
    this.abortController = null;
    this.markers = [];
    this.timer = null;
    this._refresh = this.refresh.bind(this);
    map.on('moveend', this._refresh);
    map.on('style.load', this._refresh);
  }

  setBathymetryMode(mode) {
    this.bathymetryMode = mode;
    this.family = contourFamilyForBathymetry(mode);
    this.raw = null;
    clearTimeout(this.timer);
    this.abortController?.abort();
    this.abortController = null;
    this._removeAll();
    if (this.visible) this.refresh();
  }

  setVisible(visible) {
    this.visible = visible;
    if (!visible) {
      // Context WFS calls are asynchronous. Cancelling both the debounce timer
      // and the active fetch prevents an old context request from re-mounting
      // itself after local AOI contours have taken authority.
      clearTimeout(this.timer);
      this.abortController?.abort();
      this.abortController = null;
      this._clearMarkers();
      this._removeAll();
      this.onStatus('Isobaths off');
      return;
    }
    this.refresh();
  }

  setDensity(density) {
    this.density = density === 'major' ? 'major' : 'dense';
    if (this.visible) this.refresh();
  }

  setContextOnly(enabled, maxLevels = 8) {
    this.contextOnly = Boolean(enabled);
    this.maxContextLevels = Math.max(2, Math.min(30, Number(maxLevels) || 8));
    if (!this.contextOnly) return;
    this._removeDense();
    if (this.visible && this.raw) this._renderVector();
  }

  setContextCount(count) {
    this.maxContextLevels = Math.max(2, Math.min(30, Number(count) || 8));
    if (this.contextOnly && this.visible && this.raw) this._renderVector();
  }

  contextLabel() {
    return this.family === 'emodnet-context'
      ? 'EMODnet isobaths · DIFFERENT SOURCE from GEBCO · context only'
      : 'Source-matched EMODnet isobaths';
  }

  async refresh() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._refreshNow(), 180);
  }

  async _refreshNow() {
    if (!this.visible || !this.map.getLayer('background')) return;

    if (this.family === 'none') {
      this._removeAll();
      this.onStatus(this.bathymetryMode === 'none' ? 'Bathymetry off · isobaths hidden' : 'No contours available for the selected source');
      return;
    }

    if (this.family === 'seascape') {
      this.abortController?.abort();
      this.abortController = null;
      this._clearVector();
      this._removeFallback();
      this._renderDense();
      this.onStatus(this.map.getZoom() >= 17
        ? 'Seascape isobaths · micro-zoom over native data where no local source exists'
        : this.density === 'major'
          ? 'Source-matched Seascape isobaths · provider has one vector contour family'
          : 'Source-matched Seascape isobaths · detailed vector contours');
      return;
    }

    this._removeDense();
    const zoom = this.map.getZoom();
    if (zoom < 5) {
      this._renderFallback();
      this.onStatus('CONTESTO EMODnet · curve WMS originali; dettaglio vettoriale da z5');
      return;
    }

    // Best-available rendering: the WMS exists immediately. WFS is merely a
    // higher-quality vector upgrade and may disappear without creating a blank
    // state.
    this._renderFallback();

    this.abortController?.abort();
    const requestController = new AbortController();
    this.abortController = requestController;
    const bounds = this.map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(',');
    const urls = [
      `https://ows.emodnet-bathymetry.eu/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=emodnet:contours&outputFormat=application/json&srsName=EPSG:4326&maxFeatures=5000&bbox=${bbox},EPSG:4326`,
      `https://ows.emodnet-bathymetry.eu/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=emodnet:contours&outputFormat=application/json&srsName=EPSG:4326&count=5000&bbox=${bbox},EPSG:4326`
    ];

    this.onStatus('CONTESTO EMODnet · ricerca isobate WFS vettoriali…');
    for (const url of urls) {
      try {
        const response = await fetch(url, { signal: requestController.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`WFS ${response.status}`);
        const raw = await response.json();
        // Authority may have switched to local AOI contours while the request
        // was in flight. A stale response must never mutate the map or status.
        if (!this.visible || this.abortController !== requestController || requestController.signal.aborted) return;
        this.raw = raw;
        this._renderVector();
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
        if (!this.visible || this.abortController !== requestController) return;
      }
    }

    if (!this.visible || this.abortController !== requestController || requestController.signal.aborted) return;
    this.onStatus('CONTESTO EMODnet · WFS non disponibile: curve WMS di contesto (non AOI)');
  }

  _renderDense() {
    if (!this.map.getLayer('background')) return;
    if (this.map.getSource(DENSE_SOURCE)) return;
    this.map.addSource(DENSE_SOURCE, { type: 'vector', url: SEASCAPE_VECTOR });
    this.map.addLayer({
      id: DENSE_LINE,
      type: 'line',
      source: DENSE_SOURCE,
      'source-layer': 'contours',
      minzoom: 4,
      filter: ['any', ['!', ['has', 'sys']], ['==', ['get', 'sys'], 'm']],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#315c75',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.45, 8, 0.6, 11, 0.85, 14, 1.05, 18, 1.2],
        'line-opacity': 0.78
      }
    });
  }

  _renderVector() {
    if (!this.visible) return;
    const filtered = this.contextOnly ? selectContextContourLevels(this.raw, this.maxContextLevels)
      : filterContours(this.raw, this.map.getZoom());
    if (!filtered.features.length) {
      this._clearVector();
      this._renderFallback();
      this.onStatus('CONTESTO EMODnet · nessuna isobata vettoriale nella vista; WMS di contesto attivo');
      return;
    }
    this._removeFallback();
    if (this.map.getSource(SOURCE)) this.map.getSource(SOURCE).setData(filtered);
    else {
      this.map.addSource(SOURCE, { type: 'geojson', data: filtered });
      this.map.addLayer({
        id: LINE,
        type: 'line',
        source: SOURCE,
        paint: {
          'line-color': '#245b73',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.1, 10, 1.7, 13, 2.2, 18, 2.4],
          'line-opacity': 0.72,
          'line-dasharray': [3, 2]  // published CONTEXT, not numeric AOI
        }
      }, this.map.getLayer('aoi-derived-contours-layer') ? 'aoi-derived-contours-layer' : undefined);
    }
    this._renderLabels(filtered);
    if (!filtered.features.length && this.map.getZoom() >= 14) {
      this.onStatus(this.contextLabel() + ' · no vector contour in micro-area; detailed isobaths require HR/local bathymetry');
      return;
    }
    if (this.contextOnly) {
      const selected = filtered.metadata?.displayed_levels_m ?? [];
      this.onStatus(`CONTESTO EModnet WFS · ${selected.length} livelli pubblicati (max ${this.maxContextLevels}) · ${filtered.features.length} segmenti · non è dato AOI`);
    } else {
      this.onStatus(`${this.contextLabel()}: ${filtered.features.length} features · ${this.markers.length} labels · ≥ ${contourThreshold(this.map.getZoom())} m depth`);
    }
  }

  _renderLabels(filtered) {
    this._clearMarkers();
    const grouped = new Map();
    for (const feature of filtered.features) {
      const depth = feature.properties?._depth;
      if (!grouped.has(depth)) grouped.set(depth, []);
      grouped.get(depth).push(feature);
    }
    const perDepth = this.map.getZoom() < 8 ? 1 : this.map.getZoom() < 11 ? 2 : 3;
    for (const [depth, features] of grouped) {
      for (let i = 0; i < Math.min(perDepth, features.length); i += 1) {
        const feature = features[Math.floor(i * features.length / Math.min(perDepth, features.length))];
        const point = featureMidpoint(feature);
        if (!point) continue;
        const element = document.createElement('div');
        element.className = 'contour-label';
        element.textContent = `${depth} m`;
        this.markers.push(new maplibregl.Marker({ element }).setLngLat(point).addTo(this.map));
      }
    }
  }

  _renderFallback() {
    if (!this.visible || !this.map.getLayer('background')) return;
    this._clearVector();
    if (!this.map.getSource(FALLBACK_SOURCE)) {
      this.map.addSource(FALLBACK_SOURCE, { type: 'raster', tiles: [emodnetWms('emodnet:contours')], tileSize: 256, maxzoom: 13 });
      this.map.addLayer({ id: FALLBACK_LAYER, type: 'raster', source: FALLBACK_SOURCE,
        paint: { 'raster-opacity': 0.75 } },
        this.map.getLayer('aoi-derived-contours-layer') ? 'aoi-derived-contours-layer' : undefined);
    }
  }

  _removeFallback() {
    if (this.map.getLayer(FALLBACK_LAYER)) this.map.removeLayer(FALLBACK_LAYER);
    if (this.map.getSource(FALLBACK_SOURCE)) this.map.removeSource(FALLBACK_SOURCE);
  }

  _clearVector() {
    this._clearMarkers();
    if (this.map.getLayer(LINE)) this.map.removeLayer(LINE);
    if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
  }

  _removeDense() {
    if (this.map.getLayer(DENSE_LINE)) this.map.removeLayer(DENSE_LINE);
    if (this.map.getSource(DENSE_SOURCE)) this.map.removeSource(DENSE_SOURCE);
  }

  _removeAll() {
    this._clearVector();
    this._removeFallback();
    this._removeDense();
  }

  _clearMarkers() {
    for (const marker of this.markers) marker.remove();
    this.markers = [];
  }

  destroy() {
    clearTimeout(this.timer);
    this.abortController?.abort();
    this.abortController = null;
    this.map.off('moveend', this._refresh);
    this.map.off('style.load', this._refresh);
    this._removeAll();
  }
}
