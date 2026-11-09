import { BATHYMETRY, SEASCAPE_RASTER, emodnetWms, gebcoWms, visualBathymetryStack } from './config.js';
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
    this._mountedBathyMode = null;
    this.depthOpacity = 0.72;
    this._restoreTimers = new Set();
    this._styleHandler = () => this._scheduleRestore();
    map.on('style.load', this._styleHandler);
  }

  setBathymetry(mode) {
    this.bathyMode = BATHYMETRY[mode] ? mode : 'chart-relief';
    // A basemap/style transition can leave MapLibre temporarily unable to
    // accept custom sources/layers. Do not silently drop the requested sea
    // layer: reuse the bounded restore path until the style graph is ready.
    if (!this.renderBathymetry()) this._scheduleRestore();
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

  _addRasterWms(sourceId, layerId, tile, opacity, nativeTileMaxZoom = 13) {
    this.map.addSource(sourceId, {
      type: 'raster',
      tiles: [tile],
      tileSize: 256,
      minzoom: 0,
      // Request tiles only up to the resolution appropriate to the source.
      // MapLibre then overzooms those cached tiles at larger viewing scales.
      maxzoom: nativeTileMaxZoom
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

  _addEmodnetRaster(sourceId, layerId, layerName, opacity) {
    this._addRasterWms(sourceId, layerId, emodnetWms(layerName), opacity, 13);
  }

  _addGebcoRaster(sourceId, layerId, layerName, opacity) {
    this._addRasterWms(sourceId, layerId, gebcoWms(layerName), opacity, 11);
  }

  renderBathymetry() {
    const map = this.map;
    // isStyleLoaded() becomes false while ANY remote tile is loading.
    // That is not a reason to block adding/removing already mounted style
    // layers. The base layer proves that the style graph exists.
    if (!map.getLayer('background')) return false;

    const stack = visualBathymetryStack(this.bathyMode);
    const primaryExpected = Boolean(BATHYMETRY[this.bathyMode]?.layer);
    const fallbackExpected = stack.length > 1;
    // Several view-mode controllers can request the same bathymetry while
    // their callbacks settle. Do not tear down sources for an unchanged mode:
    // the user could otherwise see a blank flash or lose layer identity
    // during a land-only basemap switch.
    if (this._mountedBathyMode === this.bathyMode &&
        Boolean(map.getLayer(IDS.bathyLayer)) === primaryExpected &&
        Boolean(map.getLayer(IDS.fallbackLayer)) === fallbackExpected) return true;

    this._clearBathymetry();
    this._mountedBathyMode = null;

    if (!stack.length) { this._mountedBathyMode = this.bathyMode; return true; }

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
    if (!spec.layer) { this._mountedBathyMode = this.bathyMode; return true; }

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
      this._mountedBathyMode = this.bathyMode;
      return true;
    }

    if (spec.provider === 'gebco') {
      this._addGebcoRaster(IDS.bathySource, IDS.bathyLayer, spec.layer, this.depthOpacity);
      this._mountedBathyMode = this.bathyMode;
      return true;
    }

    this._addEmodnetRaster(
      IDS.bathySource,
      IDS.bathyLayer,
      spec.layer,
      this.depthOpacity
    );
    this._mountedBathyMode = this.bathyMode;
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
      if (this.map.getLayer('background')) {
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
