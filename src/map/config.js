export const BASEMAPS = {
  chart: {
    name: 'Chart',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri Ocean',
    nativeMaxZoom: 16
  },
  satellite: {
    name: 'Satellite',
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri World Imagery',
    nativeMaxZoom: 20
  },
  terrain: {
    name: 'Terrain',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri Terrain',
    nativeMaxZoom: 16
  },
  minimal: {
    name: 'Minimal',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri Light Gray',
    nativeMaxZoom: 16
  }
};

export const SEASCAPE_RASTER = 'https://tiles.openwaters.io/seascape/raster.json';
export const SEASCAPE_VECTOR = 'https://tiles.openwaters.io/seascape/vector.json';

// Viewer bathymetry must be a sea-only overlay. Products that carry land
// topography (e.g. EMODnet mean_atlas_land / GEBCO shaded relief) remain valid
// data sources but are intentionally not exposed as viewer overlays.
export const BATHYMETRY = {
  'chart-relief': {
    name: 'Chart Relief · sea-only',
    layer: 'depth-relief',
    provider: 'seascape',
    contourFamily: 'seascape'
  },
  'emodnet-rainbow': {
    name: 'EMODnet Rainbow · sea-only',
    layer: 'emodnet:mean_rainbowcolour',
    provider: 'emodnet',
    contourFamily: 'emodnet'
  },
  'emodnet-multicolour': {
    name: 'EMODnet Multicolour · sea-only',
    layer: 'emodnet:mean_multicolour',
    provider: 'emodnet',
    contourFamily: 'emodnet'
  },
  none: { name: 'None', layer: null, provider: null, contourFamily: 'none' }
};

export function contourFamilyForBathymetry(mode) {
  return (BATHYMETRY[mode] ?? BATHYMETRY.none).contourFamily;
}

export function emodnetWms(layer) {
  return `https://ows.emodnet-bathymetry.eu/wms?service=WMS&request=GetMap&version=1.1.1&layers=${encodeURIComponent(layer)}&styles=&format=image/png&transparent=true&width=256&height=256&srs=EPSG:3857&bbox={bbox-epsg-3857}`;
}
