const SOURCE_ID = 'aoi-source';
const FILL_ID = 'aoi-fill';
const LINE_ID = 'aoi-line';

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}

export function aoiToGeoJSON(aoi) {
  if (!aoi) return emptyFeatureCollection();
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [aoi.minLon, aoi.minLat],
          [aoi.maxLon, aoi.minLat],
          [aoi.maxLon, aoi.maxLat],
          [aoi.minLon, aoi.maxLat],
          [aoi.minLon, aoi.minLat]
        ]]
      }
    }]
  };
}

export class AoiController {
  constructor(map, onChange = () => {}) {
    this.map = map;
    this.onChange = onChange;
    this.enabled = false;
    this.start = null;
    this.aoi = null;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._restore = this._restore.bind(this);

    map.on('mousedown', this._onDown);
    map.on('mousemove', this._onMove);
    map.on('mouseup', this._onUp);
    map.on('style.load', this._restore);
  }

  enable() {
    this.enabled = true;
    this.start = null;
    this.map.dragPan.disable();
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  disable() {
    this.enabled = false;
    this.start = null;
    this.map.dragPan.enable();
    this.map.getCanvas().style.cursor = '';
  }

  clear() {
    this.aoi = null;
    this.start = null;
    this._render();
    this.onChange(null);
  }

  getAoi() {
    return this.aoi ? { ...this.aoi } : null;
  }

  _onDown(event) {
    if (!this.enabled) return;
    event.preventDefault?.();
    this.start = { lon: event.lngLat.lng, lat: event.lngLat.lat };
  }

  _onMove(event) {
    if (!this.enabled || !this.start) return;
    const current = { lon: event.lngLat.lng, lat: event.lngLat.lat };
    this.aoi = {
      minLon: Math.min(this.start.lon, current.lon),
      maxLon: Math.max(this.start.lon, current.lon),
      minLat: Math.min(this.start.lat, current.lat),
      maxLat: Math.max(this.start.lat, current.lat)
    };
    this._render();
  }

  _onUp() {
    if (!this.enabled || !this.start) return;
    const aoi = this.getAoi();
    this.disable();
    if (aoi && (aoi.maxLon - aoi.minLon) > 1e-5 && (aoi.maxLat - aoi.minLat) > 1e-5) {
      this.onChange(aoi);
    } else {
      this.clear();
    }
  }

  _ensureLayers() {
    const map = this.map;
    if (!map.isStyleLoaded()) return false;
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
    }
    if (!map.getLayer(FILL_ID)) {
      map.addLayer({
        id: FILL_ID,
        type: 'fill',
        source: SOURCE_ID,
        paint: { 'fill-color': '#50b7d9', 'fill-opacity': 0.18 }
      });
    }
    if (!map.getLayer(LINE_ID)) {
      map.addLayer({
        id: LINE_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: { 'line-color': '#50b7d9', 'line-width': 3 }
      });
    }
    return true;
  }

  _render() {
    if (!this._ensureLayers()) return;
    this.map.getSource(SOURCE_ID).setData(aoiToGeoJSON(this.aoi));
  }

  _restore() {
    this._render();
  }

  destroy() {
    this.disable();
    this.map.off('mousedown', this._onDown);
    this.map.off('mousemove', this._onMove);
    this.map.off('mouseup', this._onUp);
    this.map.off('style.load', this._restore);
  }
}
