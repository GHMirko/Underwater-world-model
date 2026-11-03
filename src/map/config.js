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

// Land/background and sea data are intentionally independent. Client-facing
// micro-AOI bathymetry defaults to numeric AOI samples rather than a WMS colour
// raster, because the WMS can paint no-data/shore cells over a high-resolution
// land basemap. WMS products remain optional context layers only.
export const BATHYMETRY = {
  'aoi-adaptive': {
    name: 'AOI REAL · adaptive range',
    layer: null,
    provider: 'emodnet-numeric',
    contourFamily: 'none',
    numeric: true
  },
  'chart-relief': {
    name: 'Chart Relief · context only',
    layer: 'depth-relief',
    provider: 'seascape',
    contourFamily: 'seascape',
    visualFallback: 'emodnet-multicolour'
  },
  'emodnet-rainbow': {
    name: 'EMODnet Rainbow · context WMS',
    layer: 'emodnet:mean_rainbowcolour',
    provider: 'emodnet',
    contourFamily: 'emodnet'
  },
  'gebco-global': {
    name: 'GEBCO 2026 · global context WMS',
    layer: 'GEBCO_Latest_2',
    provider: 'gebco',
    contourFamily: 'none'
  },
  'emodnet-multicolour': {
    name: 'EMODnet Multicolour · context WMS',
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

export function gebcoWms(layer = 'GEBCO_Latest_2') {
  return `https://wms.gebco.net/mapserv?service=WMS&request=GetMap&version=1.1.1&layers=${encodeURIComponent(layer)}&styles=&format=image/png&transparent=true&width=256&height=256&srs=EPSG:3857&bbox={bbox-epsg-3857}`;
}

export function emodnetHrBathymetryDiscoveryWfs(aoi) {
  const bbox = [aoi.minLon, aoi.minLat, aoi.maxLon, aoi.maxLat].join(',');
  return `https://ows.emodnet-bathymetry.eu/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=emodnet:hr_bathymetry_area&outputFormat=application/json&srsName=EPSG:4326&bbox=${bbox},EPSG:4326`;
}
