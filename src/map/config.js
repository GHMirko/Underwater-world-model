export const BASEMAPS = {
  minimal: {
    name: 'Minimal',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri Light Gray',
    nativeMaxZoom: 16
  },
  satellite: {
    name: 'Satellite',
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri World Imagery',
    nativeMaxZoom: 20
  }
};

export const SEASCAPE_RASTER = 'https://tiles.openwaters.io/seascape/raster.json';
export const SEASCAPE_VECTOR = 'https://tiles.openwaters.io/seascape/vector.json';

// Land/background and sea data are intentionally independent. The client viewer
// exposes only basemaps that remain useful at micro-AOI scale; bathymetry is
// always rendered as a separate sea-data layer.
export const BATHYMETRY = {
  'chart-relief': {
    name: 'Chart Relief · sea-only',
    layer: 'depth-relief',
    provider: 'seascape',
    contourFamily: 'seascape',
    visualFallback: 'emodnet-multicolour'
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

export function visualBathymetryStack(mode) {
  const selected = BATHYMETRY[mode] ?? BATHYMETRY.none;
  if (!selected.layer) return [];
  if (!selected.visualFallback) return [mode];
  return [selected.visualFallback, mode];
}

export function emodnetWms(layer) {
  return `https://ows.emodnet-bathymetry.eu/wms?service=WMS&request=GetMap&version=1.1.1&layers=${encodeURIComponent(layer)}&styles=&format=image/png&transparent=true&tiled=false&width=256&height=256&srs=EPSG:3857&bbox={bbox-epsg-3857}`;
}

export function emodnetHrBathymetryDiscoveryWfs(aoi) {
  const bbox = [aoi.minLon, aoi.minLat, aoi.maxLon, aoi.maxLat].join(',');
  return `https://ows.emodnet-bathymetry.eu/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=emodnet:hr_bathymetry_area&outputFormat=application/json&srsName=EPSG:4326&bbox=${bbox},EPSG:4326`;
}
