/**
 * Bellhop3D AOI environmental inventory, v0.24.
 *
 * Pure planning module: no network fetch, no binary model execution,
 * no fabricated acoustic data or transmission-loss results.
 * Source-resolved does NOT mean downloaded, validated or Bellhop-ready.
 */
import { buildEnvironmentalRequest, normalizeUtc } from './environmental-request.js';
import { expandAoiByMeters, aoiDimensionsMeters } from '../map/spatial-scale.js';

export const ACOUSTIC_ENVIRONMENT_INPUTS = Object.freeze([
  Object.freeze({
    id: 'bathymetry', label: 'Bathymetry H(x,y)', role: 'REQUIRED',
    group: 'SEAFLOOR', sources: ['EMODnet numeric DTM / HR-DTM', 'GEBCO fallback', 'Local multibeam survey'],
    output: 'seafloor_bathymetry.nc → .bty',
    validation: ['All source–receiver paths covered', 'Water depth positive down', 'Vertical datum documented', 'No land/no-data interpolation without QA', 'Native resolution and uncertainties retained']
  }),
  Object.freeze({
    id: 'temperature', label: 'Temperature T(x,y,z,t)', role: 'REQUIRED_FOR_SSP_DERIVATION',
    group: 'WATER_COLUMN', sources: ['Copernicus Marine 3D', 'CTD local'],
    output: 'temperature.nc',
    validation: ['3D depth coordinates checked', 'Time overlap', 'Potential versus in-situ temperature distinguished', 'No invented sub-grid detail']
  }),
  Object.freeze({
    id: 'salinity', label: 'Salinity S(x,y,z,t)', role: 'REQUIRED_FOR_SSP_DERIVATION',
    group: 'WATER_COLUMN', sources: ['Copernicus Marine 3D', 'CTD local'],
    output: 'salinity.nc',
    validation: ['Practical versus absolute salinity distinguished', 'Shared time/depth/grid with temperature', 'Pressure and latitude available for conversion']
  }),
  Object.freeze({
    id: 'sound_speed', label: 'Sound speed c(x,y,z,t) / SSP', role: 'REQUIRED',
    group: 'DERIVED', sources: ['Validated CTD/SVP', 'Approved seawater equation + T/S/pressure'],
    output: 'soundspeed.nc → .ssp',
    validation: ['Reproducible equation and units', 'Vertical range to bottom', 'No water-column gaps', 'Gradient sensitivity assessed', 'Horizontal variability test for full 3D']
  }),
  Object.freeze({
    id: 'seabed_substrate', label: 'Seabed substrate and sediment classes', role: 'SUPPORTS_REQUIRED_BOUNDARY',
    group: 'SEAFLOOR', sources: ['EMODnet Geology WFS', 'Local sediment cores/surveys'],
    output: 'seabed.geojson',
    validation: ['Classification and scale documented', 'Spatial coverage verified', 'Not treated as direct geoacoustic parameter measurement']
  }),
  Object.freeze({
    id: 'bottom_geoacoustics', label: 'Bottom reflection / geoacoustic parameters', role: 'REQUIRED',
    group: 'BOUNDARY', sources: ['Measured cp, cs, rho and attenuation', 'Approved parameterization with sensitivity bounds'],
    output: 'bottom_properties.json → .env / .brc',
    validation: ['Compressional sound speed', 'Density', 'Attenuation units', 'Shear terms when modelled', 'Boundary parameter uncertainty']
  }),
  Object.freeze({
    id: 'surface_boundary', label: 'Surface boundary condition', role: 'REQUIRED',
    group: 'BOUNDARY', sources: ['Explicit flat pressure-release model', 'Measured/derived rough surface and reflection model'],
    output: 'surface_boundary.json → .env / .ati / .trc',
    validation: ['Boundary physics declared', 'Flat vs rough sea documented', 'Instantaneous surface not inferred from bulk Hs alone']
  }),
  Object.freeze({
    id: 'sea_level', label: 'Sea level / water-column offset', role: 'CONDITIONAL',
    group: 'SEA_SURFACE', sources: ['Copernicus Marine sea surface height', 'Tide gauge / local datum'],
    output: 'sea_level.nc',
    validation: ['Vertical datum aligned with bathymetry', 'Reference epoch and tidal constituents understood', 'Source grid resolution documented']
  }),
  Object.freeze({
    id: 'waves', label: 'Wave height, period and direction', role: 'OPTIONAL_FOR_ROUGH_SURFACE',
    group: 'SEA_SURFACE', sources: ['Copernicus Marine Mediterranean Waves', 'Local buoy / wave spectra'],
    output: 'waves.nc',
    validation: ['Bulk statistics not mistaken for a resolved sea surface', 'Time-aligned to run snapshot', 'Source grid suitability']
  }),
  Object.freeze({
    id: 'currents', label: 'Currents U/V(x,y,z,t)', role: 'CONTEXT_OPTIONAL',
    group: 'WATER_COLUMN', sources: ['Copernicus Marine 3D', 'ADCP local'],
    output: 'currents.nc',
    validation: ['Not directly ingested by standard Bellhop3D as current vectors', 'Use only through explicitly specified model extensions or scenario evolution']
  }),
  Object.freeze({
    id: 'insitu_ctd_svp', label: 'In-situ CTD / SVP quality check', role: 'VALIDATION_STRONGLY_RECOMMENDED',
    group: 'OBSERVATIONS', sources: ['Copernicus In Situ', 'EMODnet Physics', 'Local casts/profiles'],
    output: 'observations_ctd_svp.nc',
    validation: ['Station position/time/depth', 'Calibration metadata', 'Model bias vs measured sound speed', 'Uncertainty propagation']
  }),
  Object.freeze({
    id: 'volume_absorption', label: 'Water attenuation model', role: 'MODEL_CONFIGURATION',
    group: 'ACOUSTIC', sources: ['Bellhop absorption options', 'Water chemistry measurements as applicable'],
    output: 'absorption_parameters.json → .env',
    validation: ['Model choice depends on frequency', 'Environmental inputs and units documented']
  })
]);

export const BELLHOP_SCENARIO_INPUTS = Object.freeze([
  'Source latitude/longitude and depth',
  'Source frequency or list of frequencies, including bandwidth aggregation rule',
  'Source directivity / beam pattern as required',
  'Receiver positions, azimuths, depths and TL grid',
  'Beam launch and sampling settings, coherent/incoherent model selection',
  'Simulation time snapshot(s), horizontal 2.5D or full-3D physics',
  'Maximum propagation range and simulation-domain coverage'
]);

function jobById(request, id) {
  if (id === 'bathymetry') return request.source_jobs.find(job => /bathymetry/.test(job.id));
  if (id === 'seabed_substrate') return request.source_jobs.find(job => /substrate/.test(job.id));
  return request.source_jobs.find(job => job.id === 'copernicus-' + id);
}

const REQUIRED_IDS = ['bathymetry', 'sound_speed', 'bottom_geoacoustics', 'surface_boundary'];
const EXTRACTED_IDS = ['bathymetry', 'temperature', 'salinity', 'seabed_substrate', 'sea_level', 'waves', 'currents'];

export function buildBellhop3dEnvironmentInventory({
  aoi,
  startDatetime,
  endDatetime,
  minDepth = 0,
  maxDepth = 500,
  analysisGridM = 25,
  propagationBufferM = 0,
  bathymetrySelection = null,
  bathymetryDiscoveryPlan = null
}) {
  if (!aoi) throw new Error('Define an AOI before preparing Bellhop3D environmental inputs');
  const buffer = Number(propagationBufferM);
  if (!Number.isFinite(buffer) || buffer < 0) throw new Error('Propagation-domain buffer must be non-negative');
  if (buffer > 1_000_000) throw new Error('Propagation-domain buffer exceeds the initial 1000 km guardrail');
  const start = normalizeUtc(startDatetime, 'startDatetime');
  const end = normalizeUtc(endDatetime, 'endDatetime');
  const domain = buffer ? expandAoiByMeters(aoi, buffer) : { ...aoi };
  // Request source data over the propagation domain, not only the visual AOI.
  // The acquired arrays will be clipped later to the verified Bellhop grid.
  const environmentalRequest = buildEnvironmentalRequest({
    aoi: domain, startDatetime: start, endDatetime: end, minDepth, maxDepth, analysisGridM,
    variables: ['bathymetry', 'temperature', 'salinity', 'seabed_substrate', 'sea_level', 'waves', 'currents'],
    bathymetrySelection, bathymetryDiscoveryPlan
  });

  const inventory = ACOUSTIC_ENVIRONMENT_INPUTS.map(def => {
    const job = EXTRACTED_IDS.includes(def.id) ? jobById(environmentalRequest, def.id) : null;
    let acquisitionStatus = job ? 'SOURCE_JOB_PLANNED' : 'INPUT_OR_DERIVATION_REQUIRED';
    if (job?.execution === 'REGIONAL_SOURCE_NOT_APPLICABLE') acquisitionStatus = 'SOURCE_UNRESOLVED';
    return {
      ...def,
      acquisition_status: acquisitionStatus,
      data_status: 'NOT_ACQUIRED',
      validation_status: 'NOT_VALIDATED',
      source_job_id: job?.id ?? null,
      source_profile: job?.source_profile ?? null,
      native_horizontal_resolution_m: job?.native_horizontal_resolution_m ?? null,
      horizontal_adequacy: job?.spatial_adequacy?.status ?? 'UNKNOWN',
      temporal_validity_checked: false,
      vertical_reference_checked: false,
      provenance_recorded: false
    };
  });

  const allJobsPlanned = environmentalRequest.source_jobs.length;
  const unresolvedJobs = environmentalRequest.source_jobs.filter(job =>
    job.execution === 'REGIONAL_SOURCE_NOT_APPLICABLE'
  ).map(job => job.id);
  const spatialResolutionGaps = environmentalRequest.source_jobs.filter(job =>
    ['COARSE', 'UNRESOLVED'].includes(job.spatial_adequacy?.status)
  ).map(job => job.id);

  return {
    schema: 'bellhop3d-environment-inventory/0.1',
    produced_at_utc: new Date().toISOString(),
    original_aoi: { ...aoi },
    propagation_domain: {
      geometry: 'bbox-expanded-for-first-pass-discovery',
      buffer_m: buffer,
      aoi_bbox: [aoi.minLon, aoi.minLat, aoi.maxLon, aoi.maxLat],
      domain_bbox: [domain.minLon, domain.minLat, domain.maxLon, domain.maxLat],
      dimensions_m: aoiDimensionsMeters(domain),
      status: buffer > 0 ? 'CANDIDATE_ONLY_REQUIRES_SOURCE_RECEIVER_COVERAGE_CHECK' : 'NOT_DEFINED_BEYOND_AOI',
      note: 'The true Bellhop domain must encompass source, receiver grid and ray propagation paths; buffering is only a discovery approximation.'
    },
    time: { start, end, simulation_snapshots: [], alignment_status: 'NOT_CHECKED' },
    coordinate_systems: {
      geographic: 'EPSG:4326',
      simulation: 'local metric coordinates to be defined around scenario origin',
      vertical_positive: 'down',
      vertical_datum: 'UNRESOLVED — bathymetry, sea level and source/receiver depths must be aligned'
    },
    inventory,
    environmental_request: environmentalRequest,
    derived_workflow: [
      { id: 'pressure', inputs: ['depth', 'latitude', 'sea_level'], status: 'NOT_COMPUTED', note: 'Pressure conversion depends on vertical reference and units.' },
      { id: 'sound_speed', inputs: ['temperature', 'salinity', 'pressure'], status: 'NOT_COMPUTED', method: 'Approved TEOS-10/GSW transformation with clear potential/in-situ temperature semantics and salinity type.' },
      { id: 'geoacoustic_properties', inputs: ['seabed_substrate', 'measurements_or_approved_prior'], status: 'NOT_CONFIGURED', note: 'Substrate classes alone do not determine speed, density, loss or reflection coefficients.' },
      { id: 'boundary_surface', inputs: ['chosen_flat_boundary_or_validated_surface_model', 'sea_level', 'waves'], status: 'NOT_CONFIGURED', note: 'Bulk significant wave height is not an instantaneous surface elevation field.' },
      { id: 'bellhop3d_inputs', inputs: ['bathymetry', 'sound_speed', 'bottom_geoacoustics', 'surface_boundary', 'scenario'], status: 'NOT_ASSEMBLED', outputs: ['case.env', 'case.bty', 'case.ssp', 'case.ati (if relevant)', 'case.brc (if relevant)'] },
      { id: 'transmission_loss', inputs: ['bellhop3d_inputs', 'model_executable'], status: 'NOT_RUN', outputs: ['case.shd', 'transmission_loss.nc', 'run_provenance.json'] }
    ],
    readiness: {
      status: 'NOT_READY',
      requested_source_jobs: allJobsPlanned,
      unresolved_source_jobs: unresolvedJobs,
      spatial_resolution_gaps: spatialResolutionGaps,
      required_model_inputs: REQUIRED_IDS,
      completed_and_validated_inputs: [],
      blocking_gates: [
        'ACQUIRE_NUMERIC_BATHY_AND_FULL_3D_WATER_COLUMN',
        'VERIFY_SPACE_TIME_VERTICAL_DATUM_AND_UNCERTAINTY',
        'COMPUTE_AND_VALIDATE_SOUND_SPEED_3D_FIELD',
        'SPECIFY_GEOACOUSTIC_AND_SURFACE_BOUNDARY_MODELS',
        ...(buffer ? [] : ['DEFINE_SOURCE_RECEIVER_PROPAGATION_DOMAIN']),
        'DEFINE_SOURCE_FREQUENCY_RECEIVER_GEOMETRY_AND_SIMULATION_TIME',
        'ASSEMBLE_VALIDATE_BELLHOP3D_NATIVE_FILES_AND_EXECUTABLE'
      ],
      note: 'This is a SOURCE-RESOLVED PLAN, not a valid or executable BELLHOP3D environment.'
    },
    output_contract: {
      tl_quantity: 'Transmission loss in dB by frequency, simulation snapshot, source and receiver x/y/depth',
      output_from_bellhop: '.shd',
      canonical_output: 'NetCDF with TL_dB(frequency,time,source,receiver_y,receiver_x,depth)',
      include: ['input hashes and source citations', 'model and run version', 'boundary conditions', 'source native and target resolutions', 'uncertainty/sensitivity ensembles', 'time/vertical datum and interpolation records']
    },
    scenario_inputs_pending: [...BELLHOP_SCENARIO_INPUTS],
    scope_note: 'No sound-field calculation, no Bellhop3D executable, no TL estimates, no probability-of-detection output.'
  };
}
