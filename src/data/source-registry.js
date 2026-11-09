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
    execution: 'backend-required',
    nativeHorizontalResolutionM: 4200,
    coverageBbox: [-17.29, 30.19, 36.29, 45.98],
    globalFallback: Object.freeze({
      productId: 'GLOBAL_ANALYSISFORECAST_PHY_001_024',
      datasetId: 'cmems_mod_glo_phy-thetao_anfc_0.083deg_PT6H-i',
      variables: ['thetao'],
      nativeHorizontalResolutionM: 9200,
      temporalResolution: '6-hourly'
    }),
    resolutionNote: 'Regional model grid ~1/24°; treat as background environmental state for micro-AOIs.'
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
    execution: 'backend-required',
    nativeHorizontalResolutionM: 4200,
    coverageBbox: [-17.29, 30.19, 36.29, 45.98],
    globalFallback: Object.freeze({
      productId: 'GLOBAL_ANALYSISFORECAST_PHY_001_024',
      datasetId: 'cmems_mod_glo_phy-so_anfc_0.083deg_PT6H-i',
      variables: ['so'],
      nativeHorizontalResolutionM: 9200,
      temporalResolution: '6-hourly'
    }),
    resolutionNote: 'Regional model grid ~1/24°; treat as background environmental state for micro-AOIs.'
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
    execution: 'backend-required',
    nativeHorizontalResolutionM: 4200,
    coverageBbox: [-17.29, 30.19, 36.29, 45.98],
    globalFallback: Object.freeze({
      productId: 'GLOBAL_ANALYSISFORECAST_PHY_001_024',
      datasetId: 'cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i',
      variables: ['uo', 'vo'],
      nativeHorizontalResolutionM: 9200,
      temporalResolution: '6-hourly'
    }),
    resolutionNote: 'Regional model grid ~1/24°; sub-grid variation inside micro-AOIs is not resolved.'
  }),
  sea_level: Object.freeze({
    id: 'sea_level',
    label: 'Sea surface height / sea level',
    domain: 'sea-surface',
    provider: 'Copernicus Marine',
    productId: 'MEDSEA_ANALYSISFORECAST_PHY_006_013',
    datasetId: 'cmems_mod_med_phy-ssh_anfc_4.2km-2D_PT1H-m',
    variables: ['zos'],
    structure: 'grid-3d-time-lat-lon',
    canonicalFormat: 'netcdf',
    execution: 'backend-required',
    nativeHorizontalResolutionM: 4200,
    coverageBbox: [-17.29, 30.19, 36.29, 45.98],
    resolutionNote: 'Hourly regional sea surface height: regional context, not local tide gauge. Datum alignment with bathymetry required.'
  }),
  waves: Object.freeze({
    id: 'waves',
    label: 'Sea state (Hs, period, direction)',
    domain: 'sea-surface',
    provider: 'Copernicus Marine',
    productId: 'MEDSEA_ANALYSISFORECAST_WAV_006_017',
    datasetId: 'cmems_mod_med_wav_anfc_4.2km_PT1H-i',
    variables: ['VHM0', 'VTM02', 'VMDR'],
    structure: 'grid-3d-time-lat-lon',
    canonicalFormat: 'netcdf',
    execution: 'backend-required',
    nativeHorizontalResolutionM: 4200,
    coverageBbox: [-18.12, 30.19, 36.29, 45.98],
    resolutionNote: 'Hourly regional waves. Bulk Hs/period/direction do not determine a unique instantaneous surface or roughness spectrum.'
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
    execution: 'browser-public',
    nativeHorizontalResolutionM: 115,
    resolutionNote: 'Standard European DTM ~115 m. Higher-resolution local DTMs should be preferred when available.'
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
    execution: 'capability-discovery-required',
    nativeHorizontalResolutionM: null,
    resolutionNote: 'Vector map scale varies by source; adequacy must be assessed from source metadata.'
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
