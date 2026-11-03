import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASEMAPS } from './config.js';

function baseStyle(baseKey = 'minimal') {
  const base = BASEMAPS[baseKey] ?? BASEMAPS.minimal;
  return {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: base.tiles,
        tileSize: 256,
        maxzoom: base.nativeMaxZoom ?? 16,
        attribution: base.attribution
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#dce7ed' } },
      { id: 'base', type: 'raster', source: 'base', paint: { 'raster-resampling': 'linear' } }
    ]
  };
}

export function createMap(container, baseKey = 'minimal') {
  const map = new maplibregl.Map({
    container,
    style: baseStyle(baseKey),
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

export function setBaseMap(map, baseKey) {
  const key = BASEMAPS[baseKey] ? baseKey : 'minimal';
  const center = map.getCenter();
  const zoom = map.getZoom();
  const bearing = map.getBearing();
  const pitch = map.getPitch();

  map.setStyle(baseStyle(key));
  map.once('style.load', () => {
    map.jumpTo({ center, zoom, bearing, pitch });
  });
}

export { maplibregl };
