/**
 * Land / sea presentation contract.
 *
 * Land basemap selection NEVER calls setStyle and NEVER mutates a marine source.
 * A permanent OSM water polygon layer provides a consistent sea background on
 * top of both land rasters; sea raster/contours/derived AOI layers are stacked
 * after it by their independent controllers.
 *
 * Visual coastline is OpenMapTiles/OSM: it is NOT bathymetric source geometry.
 */
import { BASEMAPS } from './config.js';

export const LAND_LAYER_IDS = Object.freeze({
  minimal: 'land-basemap-minimal',
  satellite: 'land-basemap-satellite'
});

export const SEA_BACKGROUND_LAYER_ID = 'sea-water-background';
export const SEA_COASTLINE_SOURCE_ID = 'sea-coastline-vectors';

// Direct vector tile URL avoids blocking the map style on TileJSON discovery.
const COASTLINE_TILE_URL = 'https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf';
const WATER_CLASSES = ['ocean', 'dock'];

export function independentMapStyle(baseKey = 'minimal') {
  const selected = Object.hasOwn(LAND_LAYER_IDS, baseKey) ? baseKey : 'minimal';
  const sources = {};
  const layers = [{ id: 'background', type: 'background', paint: { 'background-color': '#f1ebdc' } }];

  for (const [key, id] of Object.entries(LAND_LAYER_IDS)) {
    const base = BASEMAPS[key];
    sources[id] = {
      type: 'raster',
      tiles: base.tiles,
      tileSize: 256,
      maxzoom: base.nativeMaxZoom ?? 16,
      attribution: base.attribution
    };
    layers.push({
      id,
      type: 'raster',
      source: id,
      layout: { visibility: key === selected ? 'visible' : 'none' },
      paint: { 'raster-opacity': 1, 'raster-resampling': 'linear' }
    });
  }

  // This water mask belongs to the SEA presentation stack: it never changes
  // with a land basemap switch. It also prevents satellite imagery appearing
  // through semi-transparent sea overlays.
  sources[SEA_COASTLINE_SOURCE_ID] = {
    type: 'vector',
    tiles: [COASTLINE_TILE_URL],
    minzoom: 0,
    maxzoom: 14,
    attribution: '© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap'
  };
  layers.push({
    id: SEA_BACKGROUND_LAYER_ID,
    type: 'fill',
    source: SEA_COASTLINE_SOURCE_ID,
    'source-layer': 'water',
    filter: ['in', ['get', 'class'], ['literal', WATER_CLASSES]],
    paint: { 'fill-color': '#f8fcff', 'fill-opacity': 1 }
  });
  return { version: 8, sources, layers };
}

export function switchLandBasemap(map, baseKey) {
  const selected = Object.hasOwn(LAND_LAYER_IDS, baseKey) ? baseKey : 'minimal';
  // Only change visibility of land-specific layers. No setStyle, addSource,
  // removeSource, marine layer rebuild, state mutation, camera reset or I/O.
  // Call after style is loaded; changes queued before load are not needed
  // because initial style already contains selected land source.
  if (!map.isStyleLoaded()) return false;

  for (const [key, id] of Object.entries(LAND_LAYER_IDS)) {
    if (!map.getLayer(id)) return false;
  }
  for (const [key, id] of Object.entries(LAND_LAYER_IDS)) {
    const desired = key === selected ? 'visible' : 'none';
    if (map.getLayoutProperty(id, 'visibility') !== desired) {
      map.setLayoutProperty(id, 'visibility', desired);
    }
  }
  return true;
}
