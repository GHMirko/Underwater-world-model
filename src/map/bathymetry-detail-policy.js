/**
 * Bathymetric display resolution policy.
 * Display-only: does NOT alter samples, AOI geometry, NetCDF extraction or predictors.
 * One native cell may occupy up to DISPLAY_MAX_PIXELS_PER_CELL screen pixels.
 * This is an explicit UI heuristic, not a claim about source accuracy.
 */
import { resolutionAssessment } from './spatial-scale.js';

export const DISPLAY_MAX_PIXELS_PER_CELL = 8;
export const WEB_MERCATOR_M_PER_PIXEL_Z0 = 156543.03392804097;
export const DISPLAY_MAX_ZOOM = 22;

// Conservative contextual spacing; never interpret catalogue discovery as loaded data.
const CONTEXT_SPACING_M = Object.freeze({
  'aoi-adaptive': 115,
  'emodnet-rainbow': 115,
  'emodnet-multicolour': 115,
  'gebco-global': 463
});

export function maxBathymetryDisplayZoom(nativeResolutionM, latitude = 0, pixelsPerCell = DISPLAY_MAX_PIXELS_PER_CELL) {
  if (!Number.isFinite(nativeResolutionM) || nativeResolutionM <= 0) return null;
  if (!Number.isFinite(pixelsPerCell) || pixelsPerCell <= 0) return null;
  const cosLat = Math.max(0.05, Math.cos((Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180));
  const metresPerPixel = nativeResolutionM / pixelsPerCell;
  const raw = Math.log2(WEB_MERCATOR_M_PER_PIXEL_Z0 * cosLat / metresPerPixel);
  return Math.max(1, Math.min(DISPLAY_MAX_ZOOM, Math.floor(raw * 10) / 10));
}

/**
 * Use only numeric data already acquired for the current AOI.
 * bathymetrySource describes potential/catalogue HR: never trust it to raise the limit.
 */
export function bathymetryDisplayPolicy(state, currentZoom, latitude = 0) {
  const mode = state?.bathyMode ?? 'none';
  if (mode === 'none') return { enabled: false, limited: false, zoomLimit: null, resolutionM: null };
  const actualGrid = mode === 'aoi-adaptive' &&
    Number.isFinite(state?.bathymetryQuality?.native_resolution_m) &&
    state.bathymetryQuality.native_resolution_m > 0;
  const resolutionM = actualGrid
    ? state.bathymetryQuality.native_resolution_m
    : (CONTEXT_SPACING_M[mode] ?? null);
  const hasVerifiedSpacing = actualGrid || Object.hasOwn(CONTEXT_SPACING_M, mode);
  // An unverified external rendering (e.g. Seascape) receives a conservative,
  // fixed visual-context cap, never an invented "native resolution" claim.
  const zoomLimit = hasVerifiedSpacing
    ? maxBathymetryDisplayZoom(resolutionM, latitude)
    : 13;
  const assessment = state?.aoi && Number.isFinite(resolutionM)
    ? resolutionAssessment(state.aoi, resolutionM)
    : null;
  return {
    enabled: true,
    mode,
    zoomLimit,
    resolutionM,
    sourceStatus: actualGrid ? 'ACQUIRED_NUMERIC_GRID' : hasVerifiedSpacing ? 'CONTEXT_ESTIMATE' : 'UNKNOWN_CONTEXT',
    limited: Number.isFinite(currentZoom) && currentZoom >= zoomLimit,
    spatialAdequacy: assessment?.status ?? 'UNKNOWN',
    cellsAcrossShortSide: assessment?.cellsAcrossMin ?? null
  };
}
