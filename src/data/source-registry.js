export const ENVIRONMENT_VARIABLES = Object.freeze({
  temperature: Object.freeze({
    id: 'temperature',
    label: 'Temperature',
    domain: 'water-column',
    provider: 'Copernicus Marine',
    productId: 'MEDSEA_ANALYSISFORECAST_PHY_006_013',
    datasetId: 'cmems_mod_med_phy-tem_anfc_4.2km-3D_PT1H-m',
    variables: ['thetao'],
    structure: 'grid-4d',
    canonicalFormat: 'netcdf',
    execution: 'backend-required'
  }),
  salinity: Object.freeze({
    id: 'salinity',
    label: 'Salinity',
    domain: 'water-column',
    provider: 'Copernicus Marine',
    productId: 'MEDSEA_ANALYSISFORECAST_PHY_006_013',
    datasetId: 'cmems_mod_med_phy-sal_anfc_4.2km-3D_PT1H-m',
    variables: ['so'],
    structure: 'grid-4d',
    canonicalFormat: 'netcdf',
    execution: 'backend-required'
  }),
  currents: Object.freeze({
    id: 'currents',
    label: 'Horizontal currents U/V',
    domain: 'water-column',
    provider: 'Copernicus Marine',
    productId: 'MEDSEA_ANALYSISFORECAST_PHY_006_013',
    datasetId: 'cmems_mod_med_phy-cur_anfc_4.2km-3D_PT1H-m',
    variables: ['uo', 'vo'],
    structure: 'grid-4d',
    canonicalFormat: 'netcdf',
    execution: 'backend-required'
  }),
  bathymetry: Object.freeze({
    id: 'bathymetry',
    label: 'Bathymetry',
    domain: 'seafloor',
    provider: 'EMODnet Bathymetry',
    service: 'WCS',
    endpoint: 'https://ows.emodnet-bathymetry.eu/wcs',
    coverage: 'emodnet:mean',
    structure: 'grid-2d',
    sourceFormat: 'geotiff',
    canonicalFormat: 'netcdf',
    execution: 'browser-public'
  }),
  seabed_substrate: Object.freeze({
    id: 'seabed_substrate',
    label: 'Seabed substrate',
    domain: 'seafloor',
    provider: 'EMODnet Geology',
    service: 'WFS',
    endpoint: 'https://drive.emodnet-geology.eu/geoserver/gtk/wfs',
    capabilitiesUrl: 'https://drive.emodnet-geology.eu/geoserver/gtk/wfs?SERVICE=WFS&REQUEST=GetCapabilities&VERSION=2.0.0',
    structure: 'vector-polygons',
    sourceFormat: 'geojson',
    canonicalFormat: 'geojson',
    execution: 'capability-discovery-required'
  })
});

export const DEFAULT_ENVIRONMENT_SELECTION = Object.freeze([
  'temperature',
  'salinity',
  'currents',
  'bathymetry',
  'seabed_substrate'
]);

export const ENVIRONMENT_PACKAGE_PLAN = Object.freeze({
  gridded: 'environment.nc',
  seabedVector: 'seabed.geojson',
  aoi: 'aoi.geojson',
  manifest: 'manifest.json'
});
