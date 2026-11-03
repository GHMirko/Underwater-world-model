import { ENVIRONMENT_PACKAGE_PLAN, ENVIRONMENT_VARIABLES } from './source-registry.js';
import { aoiDimensionsMeters, expandAoiByMeters, resolutionAssessment } from '../map/spatial-scale.js';

const BATHY_RES_DEG = 1 / 960; // EMODnet DTM 1/16 arc minute

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function bboxFromAoi(aoi) {
  return [aoi.minLon, aoi.minLat, aoi.maxLon, aoi.maxLat];
}

export function aoiToPolygon(aoi) {
  if (!aoi) throw new Error('AOI is required');
  const { minLon, maxLon, minLat, maxLat } = aoi;
  [minLon, maxLon, minLat, maxLat].forEach((value, index) => assertFinite(value, ['minLon', 'maxLon', 'minLat', 'maxLat'][index]));
  if (minLon >= maxLon || minLat >= maxLat) throw new Error('AOI bounds are invalid');
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]]
    }
  };
}

export function normalizeUtc(value, label) {
  if (!value) throw new Error(`${label} is required`);
  const iso = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid`);
  return date.toISOString();
}

export function buildEmodnetBathymetryUrl(aoi, resolution = BATHY_RES_DEG) {
  const { minLon, minLat, maxLon, maxLat } = aoi;
  const params = new URLSearchParams({
    service: 'wcs', version: '1.0.0', request: 'getcoverage', coverage: 'emodnet:mean', crs: 'EPSG:4326',
    BBOX: `${minLon},${minLat},${maxLon},${maxLat}`, format: 'image/tiff', interpolation: 'nearest',
    resx: String(resolution), resy: String(resolution)
  });
  return `https://ows.emodnet-bathymetry.eu/wcs?${params.toString()}`;
}

export function estimateBathymetryCells(aoi, resolution = BATHY_RES_DEG) {
  const nx = Math.max(1, Math.ceil((aoi.maxLon - aoi.minLon) / resolution));
  const ny = Math.max(1, Math.ceil((aoi.maxLat - aoi.minLat) / resolution));
  return { nx, ny, cells: nx * ny };
}

function buildCopernicusJob(definition, request) {
  const adequacy = resolutionAssessment(request.aoi, definition.nativeHorizontalResolutionM);
  const contextBufferM = adequacy.status === 'ADEQUATE' ? 0 : definition.nativeHorizontalResolutionM * 1.25;
  const sourceAoi = contextBufferM > 0 ? expandAoiByMeters(request.aoi, contextBufferM) : request.aoi;
  return {
    id: `copernicus-${definition.id}`,
    provider: definition.provider,
    product_id: definition.productId,
    dataset_id: definition.datasetId,
    variables: [...definition.variables],
    native_horizontal_resolution_m: definition.nativeHorizontalResolutionM,
    spatial_adequacy: adequacy,
    context_buffer_m: contextBufferM,
    subset: {
      bbox: bboxFromAoi(sourceAoi), target_aoi_bbox: [...request.bbox], start_datetime: request.time.start,
      end_datetime: request.time.end, minimum_depth: request.depth_m.min, maximum_depth: request.depth_m.max,
      polygons_file: ENVIRONMENT_PACKAGE_PLAN.aoi
    },
    output: { format: 'netcdf', canonical_target: ENVIRONMENT_PACKAGE_PLAN.gridded },
    execution: 'BACKEND_REQUIRED',
    provenance: 'Copernicus Marine official 3D hourly Mediterranean analysis/forecast dataset',
    resolution_note: definition.resolutionNote
  };
}

function sanitizeHrPrimary(primary) {
  if (!primary) return null;
  return {
    id: primary.id ?? null,
    name: primary.name ?? null,
    coverage_ratio: Number.isFinite(primary.coverage_ratio) ? primary.coverage_ratio : null,
    full_coverage: Boolean(primary.full_coverage),
    native_horizontal_resolution_m: Number.isFinite(primary.native_horizontal_resolution_m) ? primary.native_horizontal_resolution_m : null,
    download_url: primary.download_url ?? null,
    metadata_url: primary.metadata_url ?? null,
    bbox: primary.bbox ?? null
  };
}

function buildBathymetryJob(definition, request, selection = null, discoveryPlan = null) {
  const fallbackGrid = estimateBathymetryCells(request.aoi);
  const fallbackUrl = buildEmodnetBathymetryUrl(request.aoi);
  const useHr = selection?.selected_source === 'EMODNET_HR_DTM' && selection?.primary?.download_url;
  const nativeResolution = useHr && Number.isFinite(selection.native_horizontal_resolution_m)
    ? selection.native_horizontal_resolution_m
    : definition.nativeHorizontalResolutionM;
  const adequacy = resolutionAssessment(request.aoi, nativeResolution);

  return {
    id: useHr ? 'emodnet-hr-bathymetry' : 'emodnet-bathymetry',
    provider: definition.provider,
    source_broker_plan: discoveryPlan ? {
      schema: discoveryPlan.schema,
      recommended_strategy: discoveryPlan.recommended_strategy,
      candidates: discoveryPlan.candidates?.map(item => ({
        id: item.id,
        label: item.label,
        use_class: item.use_class,
        applicability: item.applicability,
        execution: item.execution,
        typical_resolution_m: item.typical_resolution_m,
        vertical_datum: item.vertical_datum,
        access: item.access,
        licence: item.licence,
        score: item.score
      })) ?? []
    } : null,
    source_selector: {
      status: selection?.status ?? 'NOT_RUN',
      selected_source: useHr ? 'EMODNET_HR_DTM' : 'EMODNET_STANDARD_DTM',
      reason: selection?.reason ?? 'HR discovery not executed; standard DTM selected',
      discovery: selection?.discovery ?? null,
      hr_candidates: selection?.hr_candidates ?? 0,
      primary_candidate: sanitizeHrPrimary(selection?.primary)
    },
    service: useHr ? 'DIRECT_HR_PRODUCT' : definition.service,
    coverage: useHr ? null : definition.coverage,
    request_url: useHr ? selection.primary.download_url : fallbackUrl,
    fallback: {
      provider: 'EMODnet Bathymetry', service: definition.service, coverage: definition.coverage,
      request_url: fallbackUrl, native_horizontal_resolution_m: definition.nativeHorizontalResolutionM,
      source_output: { format: 'geotiff', resolution_deg: BATHY_RES_DEG, estimated_grid: fallbackGrid }
    },
    subset: { bbox: [...request.bbox] },
    native_horizontal_resolution_m: nativeResolution,
    spatial_adequacy: adequacy,
    source_output: useHr
      ? { format: 'provider-native', estimated_grid: null }
      : { format: 'geotiff', resolution_deg: BATHY_RES_DEG, estimated_grid: fallbackGrid },
    normalization_target: { format: 'netcdf', file: ENVIRONMENT_PACKAGE_PLAN.gridded, variable: 'bathymetry' },
    execution: useHr ? 'DIRECT_HR_DOWNLOAD' : 'PUBLIC_OGC',
    provenance: useHr
      ? 'EMODnet High-Resolution DTM selected from hr_bathymetry_area footprint; standard harmonised DTM retained as fallback'
      : 'EMODnet harmonised DTM selected as executable source; HR-DTM discovery state retained in source_selector',
    resolution_note: useHr
      ? 'HR-DTM resolution comes from current feature metadata when available; verify downloaded product metadata before acoustic use.'
      : definition.resolutionNote
  };
}

function buildSubstrateJob(definition, request) {
  return {
    id: 'emodnet-seabed-substrate', provider: definition.provider, service: definition.service, endpoint: definition.endpoint,
    capabilities_url: definition.capabilitiesUrl, feature_type: null,
    subset: { bbox: [...request.bbox], geometry: 'AOI polygon preferred' }, native_horizontal_resolution_m: null,
    spatial_adequacy: { status: 'UNKNOWN', cellsAcrossMin: null, cellsAcrossMax: null },
    output: { format: 'geojson', canonical_target: ENVIRONMENT_PACKAGE_PLAN.seabedVector },
    execution: 'CAPABILITY_DISCOVERY_REQUIRED',
    provenance: 'EMODnet Geology seabed substrate WFS; feature type must be discovered from current capabilities before extraction',
    resolution_note: definition.resolutionNote
  };
}

export function buildEnvironmentalRequest({
  aoi,
  startDatetime,
  endDatetime,
  minDepth = 0,
  maxDepth = 500,
  analysisGridM = 25,
  variables = [],
  bathymetrySelection = null,
  bathymetryDiscoveryPlan = null
}) {
  aoiToPolygon(aoi);
  assertFinite(Number(minDepth), 'minDepth');
  assertFinite(Number(maxDepth), 'maxDepth');
  assertFinite(Number(analysisGridM), 'analysisGridM');
  if (Number(minDepth) < 0 || Number(maxDepth) <= Number(minDepth)) throw new Error('Depth range is invalid');
  if (Number(analysisGridM) <= 0) throw new Error('Analysis grid must be positive');
  const start = normalizeUtc(startDatetime, 'startDatetime');
  const end = normalizeUtc(endDatetime, 'endDatetime');
  if (new Date(end) <= new Date(start)) throw new Error('End time must be after start time');

  const selected = [...new Set(variables)].filter(id => ENVIRONMENT_VARIABLES[id]);
  if (!selected.length) throw new Error('Select at least one environmental variable');

  const dimensions = aoiDimensionsMeters(aoi);
  const request = {
    schema: 'environmental-data-request/0.3',
    created_at: new Date().toISOString(),
    region_profile: 'MEDITERRANEAN',
    aoi: { ...aoi },
    geometry: aoiToPolygon(aoi),
    bbox: bboxFromAoi(aoi),
    spatial_profile: {
      width_m: dimensions.width, height_m: dimensions.height, area_m2: dimensions.area,
      target_analysis_grid_m: Number(analysisGridM),
      note: 'Target analysis grid is a computational/resampling grid; it does not increase native source information.'
    },
    time: { start, end },
    depth_m: { min: Number(minDepth), max: Number(maxDepth) },
    requested_variables: selected,
    package_plan: { ...ENVIRONMENT_PACKAGE_PLAN },
    source_jobs: [],
    derived_products: [],
    validation: { environmental_state_real: false, note: 'Request is source-resolved but not valid until source jobs have been executed and checked.' }
  };

  for (const id of selected) {
    const definition = ENVIRONMENT_VARIABLES[id];
    if (definition.provider === 'Copernicus Marine') request.source_jobs.push(buildCopernicusJob(definition, request));
    else if (id === 'bathymetry') request.source_jobs.push(buildBathymetryJob(definition, request, bathymetrySelection, bathymetryDiscoveryPlan));
    else if (id === 'seabed_substrate') request.source_jobs.push(buildSubstrateJob(definition, request));
  }

  if (selected.includes('temperature') && selected.includes('salinity')) {
    request.derived_products.push({
      id: 'sound_speed', label: 'Sound speed field / SSP', inputs: ['temperature', 'salinity', 'depth'],
      target: ENVIRONMENT_PACKAGE_PLAN.gridded, status: 'PLANNED',
      method: 'Approved seawater sound-speed formulation to be fixed in G2 before computation'
    });
  }

  return request;
}

export function buildCopernicusPython(request) {
  const jobs = request.source_jobs.filter(job => job.provider === 'Copernicus Marine');
  const lines = [
    'import copernicusmarine', '', '# Generated by Underwater Mission Optimizer Data Broker.',
    '# Credentials are handled by the Copernicus Marine Toolbox environment, never embedded here.',
    '# Coarse source grids may be fetched with context around the AOI; downstream processing clips/interpolates to the target AOI.', ''
  ];
  for (const job of jobs) {
    lines.push('copernicusmarine.subset(');
    lines.push(`    dataset_id=${JSON.stringify(job.dataset_id)},`);
    lines.push(`    variables=${JSON.stringify(job.variables)},`);
    lines.push(`    minimum_longitude=${job.subset.bbox[0]}, maximum_longitude=${job.subset.bbox[2]},`);
    lines.push(`    minimum_latitude=${job.subset.bbox[1]}, maximum_latitude=${job.subset.bbox[3]},`);
    lines.push(`    start_datetime=${JSON.stringify(request.time.start)}, end_datetime=${JSON.stringify(request.time.end)},`);
    lines.push(`    minimum_depth=${request.depth_m.min}, maximum_depth=${request.depth_m.max},`);
    lines.push(`    output_filename=${JSON.stringify(`${job.id}.nc`)},`);
    lines.push("    file_format='netcdf',");
    lines.push(')');
    lines.push('');
  }
  return lines.join('\n');
}
