import { BATHYMETRY, emodnetWms, gebcoWms } from './config.js';

const IDS = {
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
    this.bathyMode = 'emodnet-rainbow';
    this.depthOpacity = 0.64;
    this._styleHandler = () => this.restore();
    map.on('style.load', this._styleHandler);
  }

  setBathymetry(mode) {
    this.bathyMode = mode;
    this.renderBathymetry();
  }

  setDepthOpacity(value) {
    this.depthOpacity = value;
    if (this.map.getLayer(IDS.bathyLayer)) {
      this.map.setPaintProperty(IDS.bathyLayer, 'raster-opacity', value);
    }
  }

  renderBathymetry() {
    const map = this.map;
    if (!map.isStyleLoaded()) return;
    safeRemove(map, IDS.bathyLayer, IDS.bathySource);

    const spec = BATHYMETRY[this.bathyMode] ?? BATHYMETRY['emodnet-rainbow'];
    if (!spec.layer) return;

    const tile = spec.provider === 'gebco' ? gebcoWms(spec.layer) : emodnetWms(spec.layer);
    map.addSource(IDS.bathySource, { type: 'raster', tiles: [tile], tileSize: 256 });
    map.addLayer({
      id: IDS.bathyLayer,
      type: 'raster',
      source: IDS.bathySource,
      paint: { 'raster-opacity': this.depthOpacity }
    });
  }

  restore() {
    if (!this.map.isStyleLoaded()) return;
    this.renderBathymetry();
  }

  destroy() {
    this.map.off('style.load', this._styleHandler);
  }
}
