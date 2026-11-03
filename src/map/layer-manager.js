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
    this._styleHandler = () => this.restore();
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
        // Bilinear is intentional for the visual layer: at z18-z22 the
        // source is still ~115 m. This keeps the image visible without
        // claiming additional native resolution.
        'raster-resampling': 'linear'
      }
    });
  }

  renderBathymetry() {
    const map = this.map;
    if (!map.isStyleLoaded()) return;
    this._clearBathymetry();

    const stack = visualBathymetryStack(this.bathyMode);
    if (!stack.length) return;

    // The bottom layer is a sea-only fallback when the primary source can
    // encode water with unknown depth. This is especially relevant inside
    // ports and very small coastal AOIs where a high-resolution satellite
    // basemap may greatly exceed bathymetric data resolution.
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
    if (!spec.layer) return;

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
      return;
    }

    // EMODnet rainbow/multicolour are transparent sea overlays only. WMS is
    // requested at the current view resolution, so it remains displayable at
    // micro-AOI zoom even though the underlying DTM is still ~115 m native.
    this._addEmodnetRaster(
      IDS.bathySource,
      IDS.bathyLayer,
      spec.layer,
      this.depthOpacity
    );
  }

  restore() {
    if (!this.map.isStyleLoaded()) return;
    this.renderBathymetry();
  }

  destroy() {
    this.map.off('style.load', this._styleHandler);
    this._clearBathymetry();
  }
}
