# Environmental Data Package — G1 contract

## Purpose

Turn a mission scenario selection into a reproducible, source-resolved environmental request:

`AOI + time + depth + variables -> source jobs -> validated Environmental State -> predictors`

The map is the request composer, not the scientific data store.

## G1A — implemented in v0.9

The browser creates a canonical `environmental-data-request/0.1` manifest containing:

- AOI as GeoJSON Polygon and bounding box;
- UTC start/end time;
- minimum/maximum depth;
- requested environmental variables;
- source-resolved jobs with provider, dataset/service and provenance;
- output/normalisation targets;
- derived-product plan;
- explicit validation state.

### Initial variable registry

| Logical variable | Provider | Dataset / service | Canonical target |
| --- | --- | --- | --- |
| Temperature | Copernicus Marine | `cmems_mod_med_phy-tem_anfc_4.2km-3D_PT1H-m` / `thetao` | NetCDF |
| Salinity | Copernicus Marine | `cmems_mod_med_phy-sal_anfc_4.2km-3D_PT1H-m` / `so` | NetCDF |
| Horizontal currents | Copernicus Marine | `cmems_mod_med_phy-cur_anfc_4.2km-3D_PT1H-m` / `uo`,`vo` | NetCDF |
| Bathymetry | EMODnet Bathymetry | WCS `emodnet:mean` | GeoTIFF source -> NetCDF normalisation |
| Seabed substrate | EMODnet Geology | WFS, current feature type discovered from capabilities | GeoJSON / GeoPackage |

The three Copernicus datasets belong to product `MEDSEA_ANALYSISFORECAST_PHY_006_013` and are the 3D hourly Mediterranean analysis/forecast datasets.

## Package layout

Target package:

```text
scenario_<id>/
  manifest.json
  aoi.geojson
  environment.nc
  seabed.geojson
```

`environment.nc` is intended for gridded, multidimensional environmental fields. Vector substrate geometry remains vector data; it must not be forced into NetCDF merely to have one file format.

## Provenance and validity

A request that has been built is **SOURCE-RESOLVED**, not yet **REAL-VALIDATED**.

`validation.environmental_state_real` remains false until:

1. all mandatory source jobs execute successfully;
2. files are readable and spatial/temporal/depth coverage is checked;
3. units, axes and fill values are normalised;
4. provenance is retained in the package manifest;
5. mandatory environmental variables pass quality/availability gates.

A visual map layer never satisfies this gate.

## Browser vs backend responsibility

### Browser-safe

- AOI / time / depth / variable request composition;
- request and AOI export;
- public OGC request construction;
- direct EMODnet Bathymetry WCS download link;
- visualisation.

### Backend-required

- authenticated Copernicus Marine subset execution;
- source file validation and normalisation;
- NetCDF package assembly;
- polygon clipping where server/tool dependencies are required;
- future derived products such as sound-speed fields.

Credentials must never be stored in the static GitHub Pages client.

## Derived products

If both temperature and salinity are requested, the manifest adds a planned `sound_speed` derived product. No sound-speed formula is executed in G1A. The approved formulation and pressure/depth handling are a separate G2 validation decision before Bellhop integration.

## Next gate — G1B

Add a small remote Data Executor that accepts the canonical request and returns the package above. Its first implementation shall:

1. execute Copernicus Marine subsets for `thetao`, `so`, `uo`, `vo`;
2. retrieve the AOI bathymetric grid;
3. discover and retrieve the applicable EMODnet substrate feature type;
4. validate dimensions, units, time and spatial coverage;
5. produce `environment.nc`, `seabed.geojson` and final `manifest.json`;
6. change `environmental_state_real` to true only after all mandatory validation gates pass.
