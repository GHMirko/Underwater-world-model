import { BATHYMETRY, SEASCAPE_RASTER, emodnetWms, visualBathymetryStack } from './config.js';
import { chartReliefExpression } from './depth-legend.js';

const IDS = {
  fallbackSource: 'bathymetry-fallback-source',
  fallbackLayer: 'bathymetry-fallback-layer',
  bathySource: 'bathymetry-source',
  bathyLayer: 'bathymetry-layer'
};

function safeRemove(map, layerId, sourceId) {
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

export class LayerManager {
  constructor(map) {
    this.map = map;
    this.bathyMode = 'chart-relief';
    this.depthOpacity = 0.72;
    this._restoreTimers = new Set();
    this._styleHandler = () => this._scheduleRestore();
    map.on('style.load', this._styleHandler);
  }

  setBathymetry(mode) {
    this.bathyMode = BATHYMETRY[mode] ? mode : 'chart-relief';
    this.renderBathymetry();
  }

  setDepthOpacity(value) {
    this.depthOpacity = value;
    if (this.map.getLayer(IDS.fallbackLayer)) {
      this.map.setPaintProperty(IDS.fallbackLayer, 'raster-opacity', value);
    }
    if (!this.map.getLayer(IDS.bathyLayer)) return;
    const property = this.bathyMode === 'chart-relief' ? 'color-relief-opacity' : 'raster-opacity';
    this.map.setPaintProperty(IDS.bathyLayer, property, value);
  }

  _clearBathymetry() {
    safeRemove(this.map, IDS.bathyLayer, IDS.bathySource);
    safeRemove(this.map, IDS.fallbackLayer, IDS.fallbackSource);
  }

  _addEmodnetRaster(sourceId, layerId, layerName, opacity) {
    const tile = emodnetWms(layerName);
    this.map.addSource(sourceId, {
      type: 'raster',
      tiles: [tile],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 22
    });
    this.map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': opacity,
        'raster-resampling': 'linear'
      }
    });
  }

  renderBathymetry() {
    const map = this.map;
    if (!map.isStyleLoaded()) return false;
    this._clearBathymetry();

    const stack = visualBathymetryStack(this.bathyMode);
    if (!stack.length) return true;

    if (stack.length > 1) {
      const fallbackSpec = BATHYMETRY[stack[0]];
      if (fallbackSpec?.provider === 'emodnet') {
        this._addEmodnetRaster(
          IDS.fallbackSource,
          IDS.fallbackLayer,
          fallbackSpec.layer,
          this.depthOpacity
        );
      }
    }

    const spec = BATHYMETRY[this.bathyMode] ?? BATHYMETRY['chart-relief'];
    if (!spec.layer) return true;

    if (spec.provider === 'seascape') {
      map.addSource(IDS.bathySource, {
        type: 'raster-dem',
        url: SEASCAPE_RASTER,
        encoding: 'terrarium',
        tileSize: 512
      });
      map.addLayer({
        id: IDS.bathyLayer,
        type: 'color-relief',
        source: IDS.bathySource,
        paint: {
          'color-relief-color': chartReliefExpression(),
          'color-relief-opacity': this.depthOpacity,
          resampling: 'nearest'
        }
      });
      return true;
    }

    this._addEmodnetRaster(
      IDS.bathySource,
      IDS.bathyLayer,
      spec.layer,
      this.depthOpacity
    );
    return true;
  }

  _scheduleRestore() {
    // setStyle() destroys all custom sources/layers. A single style.load hook
    // proved too timing-sensitive across browsers, so the world-model sea
    // stack is remounted through a bounded retry sequence. This mechanism is
    // intentionally generic: later current/SSP/predictor layers can use the
    // same lifecycle contract instead of being coupled to a basemap.
    for (const timer of this._restoreTimers) clearTimeout(timer);
    this._restoreTimers.clear();

    const tryRestore = attempt => {
      if (this.map.isStyleLoaded()) {
        try {
          this.renderBathymetry();
          return;
        } catch {
          // Style graph can still be settling immediately after style.load.
        }
      }
      if (attempt >= 10) return;
      const timer = setTimeout(() => {
        this._restoreTimers.delete(timer);
        tryRestore(attempt + 1);
      }, 50 + attempt * 25);
      this._restoreTimers.add(timer);
    };

    const timer = setTimeout(() => {
      this._restoreTimers.delete(timer);
      tryRestore(0);
    }, 0);
    this._restoreTimers.add(timer);
  }

  restore() {
    if (this.renderBathymetry()) return;
    this._scheduleRestore();
  }

  destroy() {
    this.map.off('style.load', this._styleHandler);
    for (const timer of this._restoreTimers) clearTimeout(timer);
    this._restoreTimers.clear();
    this._clearBathymetry();
  }
}
