# Bathymetry Source Broker and Synthetic World Model

## Purpose

The Underwater Mission Optimizer must work on arbitrary AOIs, not on a CSSN/La Spezia-specific bathymetry stack.

CSSN is retained as a deliberately difficult shallow-water harbour test case because it exposes the main failure modes: coarse standard DTM resolution, coastline/mole aliasing, sparse local depth variation, mixed vertical datums and incomplete public high-resolution coverage.

The architecture therefore separates:

1. **source discovery and access**;
2. **analytical numeric bathymetry**;
3. **hydrographic constraints and supplemental observations**;
4. **uncertainty-aware synthesis on a common World Model grid**;
5. **display-derived colormap/isobaths**.

The viewer is never the scientific source.

## Source roles

### PRIMARY_NUMERIC

Qualified numeric source used directly or resampled into the World Model:
- local/institutional hydrographic survey;
- regional/national HR DTM;
- EMODnet HR DTM;
- source survey or composite DTM discovered through EMODnet provenance;
- provider-specific hydrographic surfaces.

### HYDROGRAPHIC_CONSTRAINT

Official chart/ENC information such as soundings, depth areas, depth contours, dredged areas, coastline and quality objects.

ENC constraints can validate, bound or flag numeric evidence. They do not silently become a measured raster.

### SUPPLEMENTAL_OBSERVATION

Point or track observations such as IHO DCDB/CSB. These can improve awareness, validate a prior or identify disagreement, but are not automatically equivalent to a qualified survey.

### CONDITIONAL_GAP_FILL

Satellite-Derived Bathymetry can help in optically suitable shallow water. It requires explicit scene-quality, calibration/physics and uncertainty gates. Pixel size is not accuracy.

### FALLBACK

- Europe: EMODnet harmonised DTM.
- Global: GEBCO current global grid.

Fallback is retained when higher-quality sources are unavailable, but fitness-for-use is downgraded for harbour and close-proximity navigation.

## Availability states

A source may be the **best potential source** without being the **current executable baseline**.

Typical states:
- QUERYABLE
- DISCOVERY_REQUIRED
- COVERAGE_TEST_REQUIRED
- USER_OR_LICENCE_REQUIRED
- DERIVATION_REQUIRED

A source is promoted only after coverage, access/licence, metadata, resolution and vertical-datum gates are satisfied.

## Regional extensibility

The broker is provider-pluggable.

Current catalog families include:
- EMODnet standard/HR/source-reference;
- GEBCO global;
- IHO DCDB/CSB;
- SHOM/IGN Litto3D;
- UKHO Marine Data Portal;
- Rijkswaterstaat;
- Liguria PTAMC selective multibeam;
- official ENC S-57/S-101;
- Sentinel-2 SDB;
- user/institutional local survey;
- generic national/regional open-HR discovery slot.

Additional providers should implement the same metadata contract rather than introduce special-case viewer code.

## Source adapter contract

A provider adapter should resolve, where available:

```json
{
  "source_id": "provider-dataset-id",
  "provider": "provider",
  "source_class": "SURVEY | REGIONAL_HR_DTM | ...",
  "coverage_geometry": "GeoJSON or bbox",
  "native_resolution_m": 1.0,
  "horizontal_uncertainty_m": null,
  "vertical_uncertainty_m": null,
  "vertical_datum": "source datum",
  "crs": "EPSG:...",
  "time_or_epoch": null,
  "access": "OPEN | LICENSED | ...",
  "licence": "licence identifier",
  "source_format": "BAG | GeoTIFF | NetCDF | XYZ | ...",
  "request_or_download_url": "provider URL",
  "quality_metadata": {},
  "lineage": {}
}
```

No field should be invented when the provider metadata does not support it.

## Common-grid synthesis

The World Model may use a target grid finer than a source for computational consistency. This never upgrades source information.

Every populated bathymetry cell retains:

```text
depth_m
source_id
source_class
native_resolution_m
vertical_datum
derivation
horizontal_uncertainty_m
vertical_uncertainty_m
confidence_score
confidence
supporting_sources[]
constraints[]
flags[]
fitness_for_use[]
predictor_eligible
```

A 25 m World Model cell populated from a 115 m DTM remains a 115 m-native observation/resampling for quality purposes.

## Constraint conflict

Hydrographic constraints are applied as independent evidence.

Example:

```text
SDB estimate: 3 m
ENC DEPARE: 8–15 m
          ↓
CONSTRAINT_CONFLICT
          ↓
confidence decreases
predictor eligibility may be removed
operator/viewer can inspect the disagreement
```

By default, a constraint-only cell has no invented numeric depth.

## Display contract

The viewer derives:
- continuous bathymetry colormap;
- adaptive isobaths;
- labels;
- uncertainty overlay;
- source/provenance inspection.

Display interpolation is DISPLAY_DERIVED and is not a predictor input.

The engineering/native grid is available only as debug/diagnostic view.

## Environmental extension

Bathymetry is one World Model layer.

For the water column:
- Mediterranean AOIs use the higher-resolution Mediterranean Copernicus Marine physics product where available;
- other ocean AOIs fall back to the Copernicus Marine global physics product;
- T/S/currents are normalized to the same AOI/time/depth request contract;
- T/S/depth will derive sound speed/SSP;
- bathymetry + SSP + seabed + payload model will feed Bellhop/Bellhop3D or validated successor.

A missing global substrate provider remains UNRESOLVED; the broker must not pretend an out-of-coverage regional source is global.

## Operational update

The initial World Model is a prior.

Mission observations may later update cells:
- altimeter;
- FLS/MBES;
- SSS-derived evidence;
- CTD;
- local current measurements;
- vehicle observations.

Higher-confidence local evidence can supersede lower-confidence prior values while retaining lineage and previous-source references.

A quality degradation or significant update can trigger:
- predictor rerun;
- mission re-optimization;
- reduced speed / increased clearance recommendations;
- local sensing request;
- operator authorization gate when required.

## Validation gates

A bathymetry source must not become authoritative until the relevant gates pass:

1. AOI coverage;
2. source access/licence;
3. CRS;
4. vertical datum;
5. depth sign/units;
6. native resolution;
7. no-data semantics;
8. quality/uncertainty metadata;
9. epoch/age where relevant;
10. fitness-for-use for the requested mission.

## Current implementation boundary

Implemented:
- source catalog and ranking;
- potential vs executable-source distinction;
- regional/global environmental routing;
- global GEBCO fallback contract;
- World Model synthesis cell schema;
- constraint conflict handling;
- source-catalog traceability;
- continuous viewer surface and derived contours;
- debug/native grid separation.

Not yet implemented:
- automatic download/normalization for every national provider;
- licensed ENC ingestion/decryption;
- automatic SDB processing;
- BAG/point-cloud local survey ingestion;
- full vertical-datum transformation service;
- global seabed-substrate resolver;
- operational Bellhop/Bellhop3D execution.

Those capabilities should be added as provider/processor adapters without changing the World Model contract.
