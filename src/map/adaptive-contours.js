import { maplibregl } from './map-core.js';
import { emodnetWms } from './config.js';
import { contourThreshold, filterContours } from './contour-model.js';

const SOURCE = 'adaptive-contours-source';
const LINE = 'adaptive-contours-line';
const FALLBACK_SOURCE = 'contours-fallback-source';
const FALLBACK_LAYER = 'contours-fallback-layer';

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
    this.visible = true;
    this.raw = null;
    this.abortController = null;
    this.markers = [];
    this.timer = null;
    this._refresh = this.refresh.bind(this);
    map.on('moveend', this._refresh);
    map.on('style.load', this._refresh);
  }

  setVisible(visible) {
    this.visible = visible;
    if (!visible) {
      this._clearMarkers();
      this._removeAll();
      this.onStatus('Isobaths off');
      return;
    }
    this.refresh();
  }

  async refresh() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._refreshNow(), 200);
  }

  async _refreshNow() {
    if (!this.visible || !this.map.isStyleLoaded()) return;
    const zoom = this.map.getZoom();
    if (zoom < 5) {
      this._renderFallback();
      this.onStatus('Low zoom: EMODnet WMS isobath overview');
      return;
    }

    this.abortController?.abort();
    this.abortController = new AbortController();
    const bounds = this.map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(',');
    const urls = [
      `https://ows.emodnet-bathymetry.eu/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=emodnet:contours&outputFormat=application/json&srsName=EPSG:4326&maxFeatures=5000&bbox=${bbox},EPSG:4326`,
      `https://ows.emodnet-bathymetry.eu/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=emodnet:contours&outputFormat=application/json&srsName=EPSG:4326&count=5000&bbox=${bbox},EPSG:4326`
    ];

    this.onStatus('Loading adaptive EMODnet isobaths…');
    for (const url of urls) {
      try {
        const response = await fetch(url, { signal: this.abortController.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`WFS ${response.status}`);
        this.raw = await response.json();
        this._renderVector();
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }

    this._renderFallback();
    this.onStatus('WFS unavailable; WMS fallback active');
  }

  _renderVector() {
    this._removeFallback();
    const filtered = filterContours(this.raw, this.map.getZoom());
    if (this.map.getSource(SOURCE)) this.map.getSource(SOURCE).setData(filtered);
    else {
      this.map.addSource(SOURCE, { type: 'geojson', data: filtered });
      this.map.addLayer({
        id: LINE,
        type: 'line',
        source: SOURCE,
        paint: {
          'line-color': '#f5fbff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 10, 1.5, 13, 2],
          'line-opacity': 0.9
        }
      });
    }
    this._renderLabels(filtered);
    this.onStatus(`Adaptive isobaths: ${filtered.features.length} features · ${this.markers.length} labels · ≥ ${contourThreshold(this.map.getZoom())} m`);
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
        const marker = new maplibregl.Marker({ element }).setLngLat(point).addTo(this.map);
        this.markers.push(marker);
      }
    }
  }

  _renderFallback() {
    this._clearVector();
    if (!this.map.getSource(FALLBACK_SOURCE)) {
      this.map.addSource(FALLBACK_SOURCE, { type: 'raster', tiles: [emodnetWms('emodnet:contours')], tileSize: 256 });
      this.map.addLayer({ id: FALLBACK_LAYER, type: 'raster', source: FALLBACK_SOURCE, paint: { 'raster-opacity': 0.95 } });
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

  _removeAll() {
    this._clearVector();
    this._removeFallback();
  }

  _clearMarkers() {
    for (const marker of this.markers) marker.remove();
    this.markers = [];
  }

  destroy() {
    clearTimeout(this.timer);
    this.abortController?.abort();
    this.map.off('moveend', this._refresh);
    this.map.off('style.load', this._refresh);
    this._removeAll();
  }
}
