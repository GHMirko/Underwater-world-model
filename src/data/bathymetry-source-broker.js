const GLOBAL = [-180, -90, 180, 90];
const EMODNET_EUROPE = [-36, 15, 43, 90];

export const BATHYMETRY_SOURCE_CATALOG = Object.freeze([
  Object.freeze({
    id: 'LOCAL_SURVEY_UPLOAD',
    label: 'Local hydrographic survey / mission data',
    provider: 'User / institutional',
    scope: 'GLOBAL',
    coverage: GLOBAL,
    role: 'PRIMARY_NUMERIC',
    source_class: 'SURVEY',
    execution: 'USER_SUPPLIED',
    access: 'LOCAL_OR_CONNECTED_SOURCE',
    licence: 'SOURCE_DEPENDENT',
    typical_resolution_m: 1,
    vertical_datum: 'SOURCE_DEPENDENT',
    formats: ['BAG','GeoTIFF','XYZ','LAS/LAZ','NetCDF'],
    base_score: 100,
    viewer: true,
    predictor: true,
    note: 'Preferred whenever a qualified local survey is available. Source QC and vertical datum must be retained.'
  }),
  Object.freeze({
    id: 'EMODNET_HR_DTM',
    label: 'EMODnet High-Resolution DTM',
    provider: 'EMODnet Bathymetry',
    scope: 'EUROPE',
    coverage: EMODNET_EUROPE,
    role: 'PRIMARY_NUMERIC',
    source_class: 'COMPOSITE_HR_DTM',
    execution: 'DISCOVERY_REQUIRED',
    access: 'PUBLIC_OR_PROVIDER_POLICY',
    licence: 'DATASET_DEPENDENT',
    typical_resolution_m: 15,
    resolution_range_m: [4, 60],
    vertical_datum: 'METADATA_REQUIRED',
    formats: ['provider-native','GeoTIFF','NetCDF','XYZ'],
    base_score: 94,
    viewer: true,
    predictor: true,
    note: 'More than 200 selected-area HR-DTMs exist; actual coverage and resolution are discovered per AOI.'
  }),
  Object.freeze({
    id: 'EMODNET_SOURCE_SURVEY',
    label: 'EMODnet source-reference survey / composite DTM',
    provider: 'EMODnet / SeaDataNet CDI / Sextant',
    scope: 'EUROPE',
    coverage: EMODNET_EUROPE,
    role: 'PRIMARY_NUMERIC_DISCOVERY',
    source_class: 'SOURCE_REFERENCE',
    execution: 'DISCOVERY_AND_ACCESS_NEGOTIATION',
    access: 'METADATA_PUBLIC_DATASET_POLICY',
    licence: 'DATASET_DEPENDENT',
    typical_resolution_m: 10,
    vertical_datum: 'METADATA_REQUIRED',
    formats: ['survey-native','DTM-native'],
    base_score: 92,
    viewer: false,
    predictor: true,
    note: 'Find the prevailing survey/composite DTM behind each EMODnet cell and request/download the original higher-resolution source when permitted.'
  }),
  Object.freeze({
    id: 'NATIONAL_REGIONAL_OPEN_HR',
    label: 'National / regional open high-resolution bathymetry',
    provider: 'Hydrographic offices / coastal authorities / open-data portals',
    scope: 'REGIONAL_DYNAMIC',
    coverage: GLOBAL,
    role: 'PRIMARY_NUMERIC_DISCOVERY',
    source_class: 'REGIONAL_HR_DTM',
    execution: 'CATALOG_DISCOVERY_REQUIRED',
    access: 'PROVIDER_DEPENDENT',
    licence: 'PROVIDER_DEPENDENT',
    typical_resolution_m: 5,
    vertical_datum: 'SOURCE_DEPENDENT',
    formats: ['GeoTIFF','COG','NetCDF','ASCII','XYZ','point-cloud'],
    base_score: 93,
    viewer: true,
    predictor: true,
    note: 'Generic slot for high-resolution national/regional products. Provider-specific plugins can promote a discovered dataset to executable source.'
  }),
  Object.freeze({
    id: 'SHOM_LITTO3D',
    label: 'SHOM/IGN Litto3D',
    provider: 'Shom / IGN',
    scope: 'FRANCE',
    coverage: [-6.5, 41.0, 10.0, 51.8],
    role: 'PRIMARY_NUMERIC',
    source_class: 'TOPO_BATHY_LIDAR_DTM',
    execution: 'CATALOG_DISCOVERY_REQUIRED',
    access: 'OPEN',
    licence: 'Licence Ouverte',
    typical_resolution_m: 1,
    resolution_range_m: [1,5],
    vertical_datum: 'LEGAL_VERTICAL_DATUM_BY_ZONE',
    formats: ['ASCII','XYZ','WMS','WMTS'],
    base_score: 97,
    viewer: true,
    predictor: true,
    note: 'High-resolution land-sea coastal reference where coverage exists; marine acquisition extends through shallow coastal water.'
  }),
  Object.freeze({
    id: 'RIJKSWATERSTAAT_BATHY_1M',
    label: 'Rijkswaterstaat 1 m bathymetry',
    provider: 'Rijkswaterstaat',
    scope: 'NETHERLANDS',
    coverage: [3.0, 50.5, 7.5, 54.0],
    role: 'PRIMARY_NUMERIC',
    source_class: 'REGIONAL_HR_DTM',
    execution: 'CATALOG_DISCOVERY_REQUIRED',
    access: 'OPEN',
    licence: 'CC0-1.0',
    typical_resolution_m: 1,
    vertical_datum: 'NAP',
    formats: ['grid/provider-native'],
    base_score: 97,
    viewer: true,
    predictor: true,
    note: '1 m measured-bottom grid for Rijkswateren where current product coverage exists.'
  }),
  Object.freeze({
    id: 'UKHO_MARINE_BATHYMETRY',
    label: 'UKHO ADMIRALTY Marine Data Portal bathymetry',
    provider: 'UK Hydrographic Office',
    scope: 'UK_EEZ',
    coverage: [-14, 48, 4, 62],
    role: 'PRIMARY_NUMERIC_DISCOVERY',
    source_class: 'HYDROGRAPHIC_SURVEY_SURFACE',
    execution: 'CATALOG_DISCOVERY_REQUIRED',
    access: 'OPEN_AND_LICENSED_MIX',
    licence: 'OGL_OR_PRODUCT_DEPENDENT',
    typical_resolution_m: 5,
    vertical_datum: 'SOURCE_DEPENDENT',
    formats: ['bathymetry-surfaces','survey-data'],
    base_score: 95,
    viewer: true,
    predictor: true,
    note: 'Thousands of bathymetry surfaces and survey holdings; exact access and resolution are dataset-specific.'
  }),
  Object.freeze({
    id: 'LIGURIA_PTAMC_BATHY',
    label: 'Liguria PTAMC multibeam bathymetry',
    provider: 'Regione Liguria',
    scope: 'LIGURIA_SELECTED_AREAS',
    coverage: [7.3, 43.6, 10.2, 44.8],
    role: 'PRIMARY_NUMERIC_DISCOVERY',
    source_class: 'REGIONAL_MULTIBEAM_DTM',
    execution: 'COVERAGE_TEST_REQUIRED',
    access: 'OPEN_WHERE_COVERED',
    licence: 'CC-BY-4.0',
    typical_resolution_m: 1,
    vertical_datum: 'METADATA_REQUIRED',
    formats: ['GeoPackage','Shape/GML','WMS','WFS'],
    base_score: 96,
    viewer: true,
    predictor: true,
    note: 'Coverage is selective and MUST be tested. Geographic inclusion in Liguria does not imply dataset coverage.'
  }),
  Object.freeze({
    id: 'ENC_S57_S101',
    label: 'Official ENC S-57 / S-101',
    provider: 'National Hydrographic Office / licensed distributor',
    scope: 'GLOBAL',
    coverage: GLOBAL,
    role: 'HYDROGRAPHIC_CONSTRAINT',
    source_class: 'ENC_VECTOR',
    execution: 'LICENSED_OR_USER_SUPPLIED',
    access: 'LICENSED',
    licence: 'PRODUCT_DEPENDENT',
    typical_resolution_m: null,
    vertical_datum: 'CHART_DATUM',
    formats: ['S-57','S-101'],
    base_score: 88,
    viewer: true,
    predictor: 'CONSTRAINED_SYNTHETIC_ONLY',
    note: 'Use soundings, depth areas, contours, dredged areas, coastline and quality objects as hydrographic constraints; do not silently convert chart graphics into a measured DTM.'
  }),
  Object.freeze({
    id: 'SENTINEL2_SDB',
    label: 'Satellite-Derived Bathymetry from optical imagery',
    provider: 'Copernicus Sentinel-2 / derived processor',
    scope: 'GLOBAL_COASTAL',
    coverage: GLOBAL,
    role: 'CONDITIONAL_GAP_FILL',
    source_class: 'SATELLITE_DERIVED_BATHYMETRY',
    execution: 'DERIVATION_REQUIRED',
    access: 'PUBLIC_IMAGERY',
    licence: 'COPERNICUS_TERMS',
    typical_resolution_m: 10,
    vertical_datum: 'CALIBRATION_REQUIRED',
    formats: ['COG','GeoTIFF','NetCDF'],
    base_score: 72,
    viewer: true,
    predictor: 'WITH_UNCERTAINTY',
    conditions: ['clear_water','low_cloud','low_turbidity','favourable_sun_glint','calibration_or_physics_model'],
    note: 'Useful in optically clear shallow water; confidence is scene- and calibration-dependent and must never be assumed from pixel size alone.'
  }),
  Object.freeze({
    id: 'IHO_DCDB_CSB',
    label: 'IHO DCDB / Crowdsourced Bathymetry',
    provider: 'IHO DCDB / NOAA NCEI',
    scope: 'GLOBAL',
    coverage: GLOBAL,
    role: 'SUPPLEMENTAL_OBSERVATION',
    source_class: 'SOUNDINGS',
    execution: 'API_OR_DOWNLOAD',
    access: 'OPEN',
    licence: 'CC0_FOR_CSB',
    typical_resolution_m: null,
    vertical_datum: 'OBSERVATION_METADATA',
    formats: ['CSV','GeoJSON'],
    base_score: 64,
    viewer: true,
    predictor: 'SUPPLEMENTAL_ONLY',
    note: 'Use as observations/validation/gap evidence with per-file metadata; not a substitute for a qualified hydrographic survey.'
  }),
  Object.freeze({
    id: 'EMODNET_STANDARD_DTM',
    label: 'EMODnet harmonised DTM 2024',
    provider: 'EMODnet Bathymetry',
    scope: 'EUROPE',
    coverage: EMODNET_EUROPE,
    role: 'BASE_NUMERIC',
    source_class: 'HARMONISED_DTM',
    execution: 'PUBLIC_OGC',
    access: 'OPEN',
    licence: 'EMODNET_TERMS',
    typical_resolution_m: 115,
    vertical_datum: 'LAT_OR_MSL_PRODUCT',
    formats: ['GeoTIFF','NetCDF','XYZ','CSV','WCS'],
    base_score: 62,
    viewer: true,
    predictor: true,
    note: 'Reliable regional fallback and provenance backbone, but often too coarse for harbour/micro-AOI shallow-water geometry.'
  }),
  Object.freeze({
    id: 'GEBCO_2025',
    label: 'GEBCO 2025 global grid',
    provider: 'GEBCO / Seabed 2030',
    scope: 'GLOBAL',
    coverage: GLOBAL,
    role: 'GLOBAL_FALLBACK',
    source_class: 'GLOBAL_TERRAIN_MODEL',
    execution: 'SUBSET_DOWNLOAD_OR_OPENDAP',
    access: 'OPEN_TERMS',
    licence: 'GEBCO_TERMS',
    typical_resolution_m: 463,
    vertical_datum: 'APPROX_MSL_HETEROGENEOUS_SHALLOW',
    formats: ['NetCDF-CF','GeoTIFF','ASCII','OPeNDAP'],
    base_score: 35,
    viewer: true,
    predictor: 'BACKGROUND_ONLY',
    note: '15 arc-second global terrain model. Use for broad background or when no better source exists; underlying source quality varies.'
  })
]);

function intersects(a, b) {
  return !(a.maxLon < b[0] || a.minLon > b[2] || a.maxLat < b[1] || a.minLat > b[3]);
}

function dimensionsApprox(aoi) {
  const lat = (aoi.minLat + aoi.maxLat) / 2 * Math.PI / 180;
  const width = Math.max(1, (aoi.maxLon - aoi.minLon) * 111320 * Math.cos(lat));
  const height = Math.max(1, (aoi.maxLat - aoi.minLat) * 110540);
  return { width, height, min: Math.min(width, height), max: Math.max(width, height) };
}

function resolutionScore(source, targetGridM, shortSideM) {
  if (!Number.isFinite(source.typical_resolution_m)) return 0;
  const r = source.typical_resolution_m;
  if (r <= Math.max(targetGridM, 1)) return 10;
  const cells = shortSideM / r;
  if (cells >= 20) return 8;
  if (cells >= 8) return 4;
  if (cells >= 3) return 0;
  return -14;
}

function applicability(source, aoi) {
  if (source.id === 'LIGURIA_PTAMC_BATHY' && intersects(aoi, source.coverage)) return 'POTENTIAL_COVERAGE_TEST';
  if (source.scope === 'REGIONAL_DYNAMIC') return 'DISCOVERY_CANDIDATE';
  if (source.coverage === GLOBAL || source.scope.startsWith('GLOBAL')) return 'APPLICABLE';
  return intersects(aoi, source.coverage) ? 'APPLICABLE' : 'OUTSIDE_COVERAGE';
}

function availability(source) {
  if (source.execution === 'USER_SUPPLIED' || source.execution === 'LICENSED_OR_USER_SUPPLIED') return 'USER_OR_LICENCE_REQUIRED';
  if (source.execution === 'PUBLIC_OGC' || source.execution === 'SUBSET_DOWNLOAD_OR_OPENDAP' || source.execution === 'API_OR_DOWNLOAD') return 'QUERYABLE';
  if (source.execution === 'DERIVATION_REQUIRED') return 'DERIVATION_REQUIRED';
  if (source.execution === 'COVERAGE_TEST_REQUIRED') return 'COVERAGE_TEST_REQUIRED';
  return 'DISCOVERY_REQUIRED';
}

function useClass(source) {
  if (source.role === 'PRIMARY_NUMERIC' || source.role === 'PRIMARY_NUMERIC_DISCOVERY') return 'PRIMARY';
  if (source.role === 'HYDROGRAPHIC_CONSTRAINT') return 'CONSTRAINT';
  if (source.role === 'SUPPLEMENTAL_OBSERVATION') return 'SUPPLEMENTAL';
  if (source.role === 'CONDITIONAL_GAP_FILL') return 'CONDITIONAL';
  return 'FALLBACK';
}

export function buildBathymetryDiscoveryPlan(aoi, {
  targetGridM = 25,
  estimatedMinDepthM = null,
  estimatedMaxDepthM = null
} = {}) {
  if (!aoi) throw new Error('AOI is required for bathymetry discovery');
  const dimensions = dimensionsApprox(aoi);
  const micro = dimensions.max <= 3000;
  const shallow = Number.isFinite(estimatedMaxDepthM) ? estimatedMaxDepthM <= 50 : null;

  const candidates = BATHYMETRY_SOURCE_CATALOG.map(source => {
    const app = applicability(source, aoi);
    const applicable = app !== 'OUTSIDE_COVERAGE';
    const score = applicable
      ? source.base_score + resolutionScore(source, targetGridM, dimensions.min)
        + (micro && source.typical_resolution_m <= 10 ? 5 : 0)
        + (micro && source.typical_resolution_m >= 100 ? -8 : 0)
      : -999;
    const accessState = availability(source);
    const readyForUse = accessState === 'QUERYABLE' && ['BASE_NUMERIC','GLOBAL_FALLBACK'].includes(source.role);
    return {
      ...source,
      applicability: app,
      applicable,
      availability: accessState,
      ready_for_use: readyForUse,
      score,
      use_class: useClass(source),
      resolution_fit: Number.isFinite(source.typical_resolution_m)
        ? Math.max(0, Math.min(1, dimensions.min / Math.max(source.typical_resolution_m * 8, 1)))
        : null
    };
  }).filter(item => item.applicable).sort((a, b) => b.score - a.score);

  const primary = candidates.filter(item => item.use_class === 'PRIMARY').slice(0, 6);
  const constraints = candidates.filter(item => item.use_class === 'CONSTRAINT');
  const supplemental = candidates.filter(item => item.use_class === 'SUPPLEMENTAL');
  const conditional = candidates.filter(item => item.use_class === 'CONDITIONAL');
  const fallback = candidates.filter(item => item.use_class === 'FALLBACK');
  const executableBaseline = candidates.find(item => item.ready_for_use && ['PRIMARY','FALLBACK'].includes(item.use_class)) ?? null;
  const bestPotential = primary[0] ?? null;

  return {
    schema: 'bathymetry-source-plan/0.1',
    aoi: { ...aoi },
    target_analysis_grid_m: Number(targetGridM),
    area_profile: {
      width_m: dimensions.width,
      height_m: dimensions.height,
      micro_aoi: micro,
      shallow_water_expected: shallow,
      estimated_depth_range_m: [estimatedMinDepthM, estimatedMaxDepthM]
    },
    policy: {
      principle: 'BEST_AVAILABLE_INFORMATION_UNCERTAINTY_AWARE',
      never_infer_resolution_from_analysis_grid: true,
      viewer_is_not_analytical_source: true,
      prefer_qualified_local_numeric_data: true,
      preserve_vertical_datum: true,
      preserve_source_lineage_per_cell: true,
      chart_vectors_are_constraints_not_measured_raster: true,
      satellite_bathymetry_is_conditional: true
    },
    recommended_strategy: {
      best_potential_source: bestPotential?.id ?? null,
      current_executable_baseline: executableBaseline?.id ?? null,
      primary_numeric_candidates: primary.map(item => item.id),
      hydrographic_constraints: constraints.map(item => item.id),
      supplemental_observations: supplemental.map(item => item.id),
      conditional_gap_fill: conditional.map(item => item.id),
      fallback_chain: fallback.map(item => item.id),
      synthesis: [
        'discover highest-resolution qualified numeric source covering AOI',
        'normalize CRS, vertical datum metadata and positive-down depth semantics',
        'retain native values plus uncertainty/provenance on common World Model grid',
        'apply ENC/coastline/depth-area constraints when licensed data is available',
        'use CSB/soundings as supplemental evidence and validation',
        'use SDB only where optical conditions and calibration/physics support it',
        'fall back to EMODnet standard in Europe and GEBCO globally',
        'derive display colormap/isobaths from World Model, never vice versa'
      ]
    },
    candidates
  };
}

export function summarizeBathymetryPlan(plan, limit = 6) {
  if (!plan) return [];
  return (plan.candidates ?? []).slice(0, limit).map(item => ({
    id: item.id,
    label: item.label,
    use_class: item.use_class,
    applicability: item.applicability,
    execution: item.execution,
    availability: item.availability,
    ready_for_use: item.ready_for_use,
    resolution_m: item.typical_resolution_m,
    score: item.score
  }));
}
