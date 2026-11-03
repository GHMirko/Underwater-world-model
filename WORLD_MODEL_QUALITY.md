# World Model Quality Contract

## Principle: Best Available Information, uncertainty-aware

The World Model may use the best information currently available even when it is incomplete, coarse or inferred, provided its quality is explicit and machine-readable.

No layer becomes `REAL` merely because it is visible. Every source or derived layer must retain provenance, native resolution, coverage, derivation and uncertainty/quality metadata.

## Bathymetry quality hierarchy

Preferred order:

1. validated local / HR numeric bathymetry;
2. harmonised numeric DTM;
3. numeric point/grid sampling and interpolation;
4. inference from rendered bathymetry, only if explicitly marked `RENDERED_INFERENCE`;
5. no data.

A lower-priority source may still be used for planning or prediction if its confidence and fitness-for-use permit it.

## Confidence fields

Bathymetry and derived isobaths expose, where available:

- `confidence`: `HIGH | MEDIUM | LOW | VERY_LOW`;
- `confidence_score`: normalized 0..1;
- `coverage_ratio`;
- `native_resolution_m`;
- `estimated_horizontal_uncertainty_m`;
- `vertical_uncertainty_m` when supported by source metadata;
- `uncertainty_note`;
- `fitness_for_use`;
- `caution`;
- source and derivation method.

The initial confidence model is operational metadata, not a certified hydrographic accuracy class. It must not be presented as IHO/CATZOC or survey-grade accuracy unless backed by the corresponding source metadata.

## Fitness for use

Typical classes:

- `MISSION_PLANNING`;
- `PREDICTOR` / `PREDICTOR_BACKGROUND`;
- `PREDICTOR_WITH_UNCERTAINTY`;
- `PREDICTOR_SENSITIVITY_ONLY`;
- `LOCAL_NAVIGATION_SUPPORT` only when data quality is adequate;
- `SITUATIONAL_AWARENESS`;
- `VISUAL_REFERENCE`;
- `REACQUIRE_DATA_TRIGGER`.

Coarse or low-confidence bathymetry is never the sole source for close-proximity bottom or obstacle avoidance.

## Adaptive isobaths

Local isobaths are a `DERIVED` World Model layer generated from the selected numeric bathymetry grid.

Current method:

`numeric bathymetry grid -> adaptive contour interval -> marching squares -> GeoJSON line features`

Each contour feature retains:

- `depth_m`;
- `major`;
- `layer_class=DERIVED`;
- `derivation=MARCHING_SQUARES_NUMERIC_GRID`;
- source;
- native resolution;
- confidence and score;
- coverage ratio;
- estimated horizontal uncertainty;
- fitness for use;
- validity when available.

Contour spacing is selected from the local AOI depth range. Finer visual spacing does not increase native bathymetric information content.

## Autonomy / behaviour consequence

World Model quality is allowed to affect decision policy. Examples:

- `HIGH`: delegated behaviour may be allowed inside an authorised envelope;
- `MEDIUM`: planning/predictor use with conservative margins;
- `LOW`: operator confirmation, sensitivity analysis, or reacquisition may be required;
- `VERY_LOW`: visual/reference use only or trigger acquisition of better local data.

A quality degradation can become an event-driven trigger such as `WORLD_MODEL_QUALITY_DEGRADED`, causing reassessment, speed/clearance margin changes, local sensing, re-planning or operator escalation according to the authorised behaviour policy.
