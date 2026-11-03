function clean(value) {
  return value == null ? null : value;
}

function bathymetryLayer(state, environmentalRequest) {
  const job = environmentalRequest?.source_jobs?.find(item => item.id === 'emodnet-bathymetry' || item.id === 'emodnet-hr-bathymetry') ?? null;
  const grid = state.bathymetryGrid;
  const quality = state.bathymetryQuality;
  const contours = state.adaptiveContours;
  return {
    id: 'bathymetry',
    layer_class: 'ENVIRONMENTAL_BASE_LAYER',
    analytical_source: {
      provider: 'EMODnet Bathymetry',
      source_id: grid?.source ?? job?.source_selector?.selected_source ?? 'EMODNET_STANDARD_DTM',
      service: job?.service ?? 'WCS',
      request_url: job?.request_url ?? null,
      native_horizontal_resolution_m: clean(quality?.native_resolution_m ?? job?.native_horizontal_resolution_m),
      source_format: job?.source_output?.format ?? 'geotiff',
      vertical_semantics: { quantity: 'depth', units: 'm', positive: 'down' },
      crs: 'EPSG:4326',
      provenance: job?.provenance ?? 'EMODnet numeric bathymetry',
      authoritative_for_predictors: true
    },
    quality: {
      confidence: quality?.confidence ?? 'UNKNOWN',
      confidence_score: clean(quality?.confidence_score),
      coverage_ratio: clean(quality?.coverage_ratio),
      estimated_horizontal_uncertainty_m: clean(quality?.estimated_horizontal_uncertainty_m),
      vertical_uncertainty_m: clean(quality?.vertical_uncertainty_m),
      fitness_for_use: quality?.fitness_for_use ?? [],
      caution: quality?.caution ?? null
    },
    numeric_grid: grid ? {
      nx: clean(grid.nx), ny: clean(grid.ny), valid_cells: clean(grid.samples), total_cells: clean(grid.total),
      min_depth_m: clean(grid.min), max_depth_m: clean(grid.max), mean_depth_m: clean(grid.mean),
      water_mask_applied: Boolean(grid.water_mask_applied), coastal_cells: clean(grid.coastal_cells), masked_land_cells: clean(grid.masked_land_cells)
    } : null,
    derived_layers: {
      display_surface: {
        id: 'bathymetry.display.continuous',
        layer_class: 'DISPLAY_DERIVED',
        derivation: 'INTERPOLATED_FROM_NUMERIC_GRID_FOR_VISUALIZATION',
        predictor_input: false,
        note: 'Continuous colour rendering is for human interpretation only; analytical consumers use the numeric source grid.'
      },
      contours: contours ? {
        id: 'bathymetry.contours.adaptive',
        layer_class: 'DERIVED',
        derivation: contours.derivation ?? 'NUMERIC_GRID_CONTOURS',
        interval_m: clean(contours.interval_m),
        levels_m: contours.levels_m ?? [],
        feature_count: clean(contours.feature_count),
        confidence: contours.confidence ?? quality?.confidence ?? 'UNKNOWN',
        predictor_input: true,
        note: 'Derived geometry retains source provenance and quality metadata.'
      } : null
    },
    standardization: {
      preferred_gridded_exchange: 'NetCDF-CF',
      source_exchange: job?.source_output?.format ?? 'GeoTIFF',
      vector_exchange: 'GeoJSON',
      metadata_exchange: 'JSON',
      normalization_target: job?.normalization_target ?? null
    }
  };
}

function sourceLayer(job) {
  return {
    id: job.id,
    provider: job.provider,
    execution: job.execution,
    request_url: job.request_url ?? job.endpoint ?? null,
    variables: job.variables ?? null,
    subset: job.subset ?? null,
    native_horizontal_resolution_m: clean(job.native_horizontal_resolution_m),
    spatial_adequacy: job.spatial_adequacy ?? null,
    output: job.output ?? job.source_output ?? null,
    provenance: job.provenance ?? null,
    resolution_note: job.resolution_note ?? null
  };
}

export function buildWorldModelPackage({ state, environmentalRequest }) {
  if (!state?.aoi) throw new Error('AOI is required for the World Model Package');
  if (!environmentalRequest) throw new Error('Build the Environmental Data Request before the World Model Package');
  return {
    schema: 'underwater-world-model-aoi-package/0.2',
    created_at: new Date().toISOString(),
    mission: state.mission,
    aoi: { ...state.aoi },
    geometry: environmentalRequest.geometry,
    time: environmentalRequest.time,
    depth_m: environmentalRequest.depth_m,
    spatial_profile: environmentalRequest.spatial_profile,
    contracts: {
      view_vs_data: 'Visualization layers are never authoritative numerical inputs. Predictors and optimizers consume analytical/derived data layers with provenance.',
      uncertainty: 'Best available information is retained with confidence, coverage, resolution and fitness-for-use metadata.',
      validity: { valid_until: null, rerun_at: null, event_driven_reassessment: true }
    },
    bathymetry_source_broker: state.bathymetryDiscoveryPlan ? {
      schema: state.bathymetryDiscoveryPlan.schema,
      area_profile: state.bathymetryDiscoveryPlan.area_profile,
      policy: state.bathymetryDiscoveryPlan.policy,
      recommended_strategy: state.bathymetryDiscoveryPlan.recommended_strategy,
      candidates: state.bathymetryDiscoveryPlan.candidates?.map(item => ({
        id: item.id,
        label: item.label,
        provider: item.provider,
        use_class: item.use_class,
        source_class: item.source_class,
        applicability: item.applicability,
        execution: item.execution,
        access: item.access,
        licence: item.licence,
        typical_resolution_m: item.typical_resolution_m,
        vertical_datum: item.vertical_datum,
        score: item.score,
        predictor: item.predictor,
        viewer: item.viewer,
        note: item.note
      })) ?? []
    } : null,
    synthesis_contract: {
      target: 'ANALYSIS_READY_UNDERWATER_WORLD_MODEL',
      cell_schema: ['value', 'source_id', 'native_resolution_m', 'vertical_datum', 'derivation', 'uncertainty', 'confidence', 'valid_time', 'fitness_for_use'],
      source_priority: 'qualified local numeric > regional/national HR > EMODnet HR/source survey > constrained ENC/SDB/CSB supplements > EMODnet standard > GEBCO global fallback',
      display_policy: 'viewer derives colormap/isobaths from the World Model; display products never overwrite analytical values',
      update_policy: 'new local observations may supersede lower-confidence prior cells while preserving lineage'
    },
    layers: {
      bathymetry: bathymetryLayer(state, environmentalRequest),
      source_jobs: (environmentalRequest.source_jobs ?? []).filter(job => !['emodnet-bathymetry', 'emodnet-hr-bathymetry'].includes(job.id)).map(sourceLayer),
      planned_derived_products: environmentalRequest.derived_products ?? []
    },
    extraction_contract: {
      request_schema: environmentalRequest.schema,
      requested_variables: environmentalRequest.requested_variables,
      source_jobs: environmentalRequest.source_jobs,
      package_plan: environmentalRequest.package_plan,
      validation: environmentalRequest.validation
    },
    predictor_interfaces: [
      {
        id: 'sound_speed', status: environmentalRequest.derived_products?.some(item => item.id === 'sound_speed') ? 'PLANNED' : 'INPUTS_NOT_SELECTED',
        inputs: ['temperature', 'salinity', 'depth'], output_layer: 'sound_speed', output_standard: 'NetCDF-CF'
      },
      {
        id: 'acoustic_propagation', status: 'PLANNED',
        inputs: ['bathymetry', 'sound_speed', 'seabed_substrate', 'payload_acoustic_model'],
        output_layers: ['transmission_loss', 'predicted_range', 'coverage', 'Pd'],
        model_family: 'Bellhop/Bellhop3D or validated successor'
      }
    ],
    optimizer_interface: {
      status: 'PLANNED',
      consumes: ['predictor KPI layers', 'asset constraints', 'mission constraints', 'world model quality'],
      hard_constraints_are_feasibility_gates: true,
      uncertainty_aware: true,
      authority_gate_required_for_high_impact_actions: true
    }
  };
}
