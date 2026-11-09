import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { independentMapStyle, switchLandBasemap } from './land-sea-style.js';

export function createMap(container, baseKey = 'minimal') {
  const map = new maplibregl.Map({
    container,
    style: independentMapStyle(baseKey),
    center: [24.2051, 36.62451],
    zoom: 7.1,
    minZoom: 1,
    maxZoom: 22,
    attributionControl: true
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 140 }), 'bottom-right');
  map.addControl(new maplibregl.FullscreenControl(), 'top-right');
  return map;
}

/**
 * Change ONLY land imagery. Marine background, bathymetry, contours, AOI,
 * predictor layers and numeric state retain their identity.
 */
export function setBaseMap(map, baseKey) {
  if (!switchLandBasemap(map, baseKey)) {
    map.once('style.load', () => switchLandBasemap(map, baseKey));
  }
}

export { maplibregl };
