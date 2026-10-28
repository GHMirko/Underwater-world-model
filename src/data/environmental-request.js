import { ENVIRONMENT_PACKAGE_PLAN, ENVIRONMENT_VARIABLES } from './source-registry.js';

const BATHY_RES_DEG = 1 / 960; // EMODnet DTM 1/16 arc minute

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
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
      coordinates: [[
        [minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]
      ]]
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
    service: 'wcs',
    version: '1.0.0',
    request: 'getcoverage',
    coverage: 'emodnet:mean',
    crs: 'EPSG:4326',
    BBOX: `${minLon},${minLat},${maxLon},${maxLat}`,
    format: 'image/tiff',
    interpolation: 'nearest',
    resx: String(resolution),
    resy: String(resolution)
  });
  return `https://ows.emodnet-bathymetry.eu/wcs?${params.toString()}`;
}

export function estimateBathymetryCells(aoi, resolution = BATHY_RES_DEG) {
  const nx = Math.max(1, Math.ceil((aoi.maxLon - aoi.minLon) / resolution));
  const ny = Math.max(1, Math.ceil((aoi.maxLat - aoi.minLat) / resolution));
  return { nx, ny, cells: nx * ny };
}

function buildCopernicusJob(definition, request) {
  return {
    id: `copernicus-${definition.id}`,
    provider: definition.provider,
    product_id: definition.productId,
    dataset_id: definition.datasetId,
    variables: [...definition.variables],
    subset: {
      bbox: [...request.bbox],
      start_datetime: request.time.start,
      end_datetime: request.time.end,
      minimum_depth: request.depth_m.min,
      maximum_depth: request.depth_m.max,
      polygons_file: ENVIRONMENT_PACKAGE_PLAN.aoi
    },
    output: {
      format: 'netcdf',
      canonical_target: ENVIRONMENT_PACKAGE_PLAN.gridded
    },
    execution: 'BACKEND_REQUIRED',
    provenance: 'Copernicus Marine official 3D hourly Mediterranean analysis/forecast dataset'
  };
}

function buildBathymetryJob(definition, request) {
  const grid = estimateBathymetryCells(request.aoi);
  return {
    id: 'emodnet-bathymetry',
    provider: definition.provider,
    service: definition.service,
    coverage: definition.coverage,
    request_url: buildEmodnetBathymetryUrl(request.aoi),
    subset: { bbox: [...request.bbox] },
    source_output: { format: 'geotiff', resolution_deg: BATHY_RES_DEG, estimated_grid: grid },
    normalization_target: { format: 'netcdf', file: ENVIRONMENT_PACKAGE_PLAN.gridded, variable: 'bathymetry' },
    execution: 'PUBLIC_OGC',
    provenance: 'EMODnet harmonised DTM; numeric coverage, separate from visual bathymetry layer'
  };
}

function buildSubstrateJob(definition, request) {
  return {
    id: 'emodnet-seabed-substrate',
    provider: definition.provider,
    service: definition.service,
    endpoint: definition.endpoint,
    capabilities_url: definition.capabilitiesUrl,
    feature_type: null,
    subset: { bbox: [...request.bbox], geometry: 'AOI polygon preferred' },
    output: { format: 'geojson', canonical_target: ENVIRONMENT_PACKAGE_PLAN.seabedVector },
    execution: 'CAPABILITY_DISCOVERY_REQUIRED',
    provenance: 'EMODnet Geology seabed substrate WFS; feature type must be discovered from current capabilities before extraction'
  };
}

export function buildEnvironmentalRequest({
  aoi,
  startDatetime,
  endDatetime,
  minDepth = 0,
  maxDepth = 500,
  variables = []
}) {
  aoiToPolygon(aoi);
  assertFinite(Number(minDepth), 'minDepth');
  assertFinite(Number(maxDepth), 'maxDepth');
  if (Number(minDepth) < 0 || Number(maxDepth) <= Number(minDepth)) throw new Error('Depth range is invalid');
  const start = normalizeUtc(startDatetime, 'startDatetime');
  const end = normalizeUtc(endDatetime, 'endDatetime');
  if (new Date(end) <= new Date(start)) throw new Error('End time must be after start time');

  const selected = [...new Set(variables)].filter(id => ENVIRONMENT_VARIABLES[id]);
  if (!selected.length) throw new Error('Select at least one environmental variable');

  const request = {
    schema: 'environmental-data-request/0.1',
    created_at: new Date().toISOString(),
    region_profile: 'MEDITERRANEAN',
    aoi: { ...aoi },
    geometry: aoiToPolygon(aoi),
    bbox: [aoi.minLon, aoi.minLat, aoi.maxLon, aoi.maxLat],
    time: { start, end },
    depth_m: { min: Number(minDepth), max: Number(maxDepth) },
    requested_variables: selected,
    package_plan: { ...ENVIRONMENT_PACKAGE_PLAN },
    source_jobs: [],
    derived_products: [],
    validation: {
      environmental_state_real: false,
      note: 'Request is source-resolved but not valid until source jobs have been executed and checked.'
    }
  };

  for (const id of selected) {
    const definition = ENVIRONMENT_VARIABLES[id];
    if (definition.provider === 'Copernicus Marine') request.source_jobs.push(buildCopernicusJob(definition, request));
    else if (id === 'bathymetry') request.source_jobs.push(buildBathymetryJob(definition, request));
    else if (id === 'seabed_substrate') request.source_jobs.push(buildSubstrateJob(definition, request));
  }

  if (selected.includes('temperature') && selected.includes('salinity')) {
    request.derived_products.push({
      id: 'sound_speed',
      label: 'Sound speed field / SSP',
      inputs: ['temperature', 'salinity', 'depth'],
      target: ENVIRONMENT_PACKAGE_PLAN.gridded,
      status: 'PLANNED',
      method: 'Approved seawater sound-speed formulation to be fixed in G2 before computation'
    });
  }

  return request;
}

export function buildCopernicusPython(request) {
  const jobs = request.source_jobs.filter(job => job.provider === 'Copernicus Marine');
  const lines = [
    'import copernicusmarine',
    '',
    '# Generated by Underwater Mission Optimizer Data Broker.',
    '# Credentials are handled by the Copernicus Marine Toolbox environment, never embedded here.',
    ''
  ];
  for (const job of jobs) {
    lines.push('copernicusmarine.subset(');
    lines.push(`    dataset_id=${JSON.stringify(job.dataset_id)},`);
    lines.push(`    variables=${JSON.stringify(job.variables)},`);
    lines.push(`    minimum_longitude=${request.bbox[0]}, maximum_longitude=${request.bbox[2]},`);
    lines.push(`    minimum_latitude=${request.bbox[1]}, maximum_latitude=${request.bbox[3]},`);
    lines.push(`    start_datetime=${JSON.stringify(request.time.start)}, end_datetime=${JSON.stringify(request.time.end)},`);
    lines.push(`    minimum_depth=${request.depth_m.min}, maximum_depth=${request.depth_m.max},`);
    lines.push(`    output_filename=${JSON.stringify(`${job.id}.nc`)},`);
    lines.push("    file_format='netcdf',");
    lines.push(')');
    lines.push('');
  }
  return lines.join('\n');
}
