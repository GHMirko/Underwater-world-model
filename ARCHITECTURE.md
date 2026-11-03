# Underwater World Model — Architecture Contract

This document defines invariants for the project. New UI, data adapters, predictors and optimizers must preserve them.

## 1. Viewer is not the product

The map is a **Scenario / Data Request Composer**. It allows the operator to define:

- mission / task context;
- AOI geometry;
- time window;
- depth interval;
- environmental and operational layers;
- assets / payloads;
- analysis grid and other scenario parameters.

A visual tile or rendered colour map is never treated as validated scientific data merely because it is visible.

## 2. Land/background and sea-data are independent

Customer-facing basemaps provide geographic context only.

- `BACKGROUND / LAND`: Minimal or Satellite.
- `SEA DATA`: bathymetry, isobaths, currents, T/S, seabed, SSP, predicted acoustic coverage, etc.

Changing the basemap must never destroy, modify or silently replace World Model data layers.

## 3. Every layer has a data contract

Each layer must expose, where applicable:

- `id` / semantic variable;
- `layer_class`: `SOURCE`, `DERIVED`, `PREDICTED`, `DECISION`;
- `view_source`;
- `data_source`;
- provider and dataset / service identifier;
- native spatial resolution;
- temporal resolution;
- vertical resolution / depth levels;
- CRS / grid definition;
- units;
- uncertainty / quality metadata;
- provenance;
- acquisition timestamp;
- validity interval (`valid_from`, `valid_until`);
- exportability / canonical format;
- transformation / predictor version if derived.

`view_source` and `data_source` may be different. A layer without a numeric/feature data source is `VIEW_ONLY` and cannot silently feed predictors or optimizers.

## 4. Data Broker

Canonical flow:

`AOI + time + depth + variables -> Data Broker -> source jobs -> harmonisation -> World Model package`

Initial source families:

- Copernicus Marine: T, S, U/V currents and other ocean fields;
- EMODnet Bathymetry: standard DTM, HR-DTM discovery, numeric depth;
- EMODnet Geology: seabed substrate;
- EDITO / other authoritative services as added.

Source selection is resolution-aware and provenance-aware. Resampling to a finer computational grid does **not** upgrade native information content.

## 5. World Model package

The World Model is the authoritative scenario state consumed by predictors and optimizers.

Typical package:

```text
scenario/
  manifest.json
  aoi.geojson
  environment.nc
  seabed.gpkg / seabed.geojson
  provenance.json
  derived/
  predictions/
```

Preferred formats:

- gridded multidimensional ocean fields: NetCDF CF / Zarr;
- raster geospatial products: NetCDF / COG where appropriate;
- vector / categorical features: GeoPackage / GeoJSON;
- manifests, provenance and decision metadata: JSON.

## 6. Derived layers and predictors

Predictors consume World Model data and create new versioned layers.

Examples:

- `T + S + pressure/depth -> sound speed field / SSP`;
- `SSP + bathymetry + seabed + frequency + Tx/Rx geometry -> acoustic propagation / TL`;
- `TL + sensor/payload model -> Pd / predicted range / coverage`;
- `currents + vehicle dynamics -> energy / time / navigation impact`;
- `seabed + sonar model -> detection / classification performance`.

Every predictor output must retain input provenance, predictor version, assumptions and uncertainty.

## 7. Asset and payload catalogue

Platforms and payloads are separate entities linked through compatibility constraints.

Payload data required for future ASW acoustic prediction includes, as applicable:

- active/passive role;
- frequency / bandwidth;
- source level where applicable;
- receiver sensitivity / noise assumptions;
- directivity / beam pattern;
- operating depth constraints;
- processing gain / detection model parameters;
- platform self-noise / speed dependency;
- environmental dependencies;
- provenance and confidence.

Synthetic values are explicitly marked `SYNTHETIC` until replaced by validated catalogue data.

## 8. Optimization

Hard constraints are feasibility gates and cannot be compensated by weighted scores.

Optimization flow:

`World Model + assets/payloads + predictor layers + mission constraints -> feasible set -> Pareto front -> ranking / explainability`

Weighted utility may rank Pareto alternatives but does not replace feasibility or multi-objective analysis.

## 9. Planned and event-driven behaviour

The decision engine can generate:

- planned tasking / mission plans;
- re-assessment triggers;
- event-driven re-tasking proposals;
- delegated actions within an explicitly authorised envelope.

Typical triggers include:

- new detection / classification evidence;
- environmental forecast divergence;
- communication degradation;
- asset / payload failure;
- energy or endurance threshold;
- mission-priority change;
- World Model validity expiration.

Decision reassessment may use concepts such as:

`DeltaU = U_new - U_current - C_switch`

but any action remains subject to mission constraints, uncertainty, validity and authorisation policy.

## 10. Delegation / authorisation gate

Decision outputs must carry an explicit execution authority, for example:

- `ADVISORY`: recommendation only;
- `OPERATOR_CONFIRM`: operator approval required;
- `DELEGATED_WITHIN_ENVELOPE`: automatic execution allowed only inside predefined safe mission / navigation / sensing constraints;
- `NOT_AUTHORISED`: planning / analysis only.

High-impact decisions retain an operator gate. The current project scope is mission planning, sensing/search, environmental decision support, asset allocation and operator-supervised autonomy; it does not use the optimizer for offensive weapon employment or targeting.

## 11. Validity and event-driven recomputation

Keep separate:

- `valid_until`: when data / prediction ceases to be trusted;
- `rerun_at`: scheduled recomputation time;
- event triggers: conditions that force immediate reassessment.

A scenario can remain valid while still being recomputed proactively, and an event can invalidate a plan before its scheduled rerun.

## 12. Release invariants

A release is not valid unless critical browser flows pass. At minimum:

- AOI draw / clear / redraw;
- micro-AOI fit and zoom;
- basemap switch without losing World Model layers;
- bathymetry / contour switching;
- network failure degrades data layers but does not crash the app;
- Data Broker request construction;
- optimizer execution;
- provenance / resolution warnings preserved.

The architecture must prefer modular source adapters and derived-layer pipelines over UI-specific patches.
