export const BASEMAPS = {
  chart: {
    name: 'Chart',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri Ocean'
  },
  satellite: {
    name: 'Satellite',
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri World Imagery'
  },
  terrain: {
    name: 'Terrain',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri Terrain'
  },
  minimal: {
    name: 'Minimal',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri Light Gray'
  }
};

export const BATHYMETRY = {
  'emodnet-rainbow': { name: 'EMODnet Rainbow', layer: 'emodnet:mean_rainbowcolour', provider: 'emodnet' },
  'emodnet-multicolour': { name: 'EMODnet Multicolour', layer: 'emodnet:mean_multicolour', provider: 'emodnet' },
  'emodnet-atlas': { name: 'EMODnet Atlas', layer: 'emodnet:mean_atlas_land', provider: 'emodnet' },
  'gebco-relief': { name: 'GEBCO Relief', layer: 'gebco_latest', provider: 'gebco' },
  none: { name: 'None', layer: null, provider: null }
};

export function emodnetWms(layer) {
  return `https://ows.emodnet-bathymetry.eu/wms?service=WMS&request=GetMap&version=1.1.1&layers=${encodeURIComponent(layer)}&styles=&format=image/png&transparent=true&width=256&height=256&srs=EPSG:3857&bbox={bbox-epsg-3857}`;
}

export function gebcoWms(layer) {
  return `https://wms.gebco.net/mapserv?service=WMS&request=GetMap&version=1.1.1&layers=${encodeURIComponent(layer)}&styles=&format=image/png&transparent=true&width=256&height=256&srs=EPSG:3857&bbox={bbox-epsg-3857}`;
}
