import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASEMAPS } from './config.js';

function baseStyle(baseKey = 'chart') {
  const base = BASEMAPS[baseKey] ?? BASEMAPS.chart;
  return {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: base.tiles,
        tileSize: 256,
        attribution: base.attribution
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#173248' } },
      { id: 'base', type: 'raster', source: 'base' }
    ]
  };
}

export function createMap(container, baseKey = 'chart') {
  const map = new maplibregl.Map({
    container,
    style: baseStyle(baseKey),
    center: [24.2051, 36.62451],
    zoom: 7.1,
    minZoom: 1,
    maxZoom: 16,
    attributionControl: true
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  map.addControl(new maplibregl.FullscreenControl(), 'top-right');
  return map;
}

export function setBaseMap(map, baseKey) {
  const base = BASEMAPS[baseKey] ?? BASEMAPS.chart;
  const center = map.getCenter();
  const zoom = map.getZoom();
  const bearing = map.getBearing();
  const pitch = map.getPitch();

  map.setStyle(baseStyle(baseKey));
  map.once('style.load', () => {
    map.jumpTo({ center, zoom, bearing, pitch });
  });
}

export { maplibregl };
