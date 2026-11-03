import { AOI_ADAPTIVE_PALETTE } from './depth-legend.js';
import { alphaAt } from '../data/emodnet-water-mask.js';

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hexToRgb(hex) {
  const clean = String(hex).replace('#', '');
  const value = Number.parseInt(clean.length === 3 ? clean.split('').map(char => char + char).join('') : clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function interpolateColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

export function colorForDepth(depth, minDepth, maxDepth, palette = AOI_ADAPTIVE_PALETTE) {
  const min = Number(minDepth);
  const max = Number(maxDepth);
  if (!Number.isFinite(depth) || !Number.isFinite(min) || !Number.isFinite(max) || !palette?.length) return [82, 182, 216];
  if (palette.length === 1) return hexToRgb(palette[0]);
  const span = Math.max(0.1, max - min);
  const scaled = clamp01((depth - min) / span) * (palette.length - 1);
  const index = Math.min(palette.length - 2, Math.floor(scaled));
  return interpolateColor(hexToRgb(palette[index]), hexToRgb(palette[index + 1]), scaled - index);
}

function sampleMatrix(grid) {
  const matrix = Array.from({ length: grid.ny }, () => Array(grid.nx).fill(null));
  for (const sample of grid.samples ?? []) {
    if (!sample || !Number.isInteger(sample.ix) || !Number.isInteger(sample.iy) || !Number.isFinite(sample.depth)) continue;
    if (sample.ix < 0 || sample.ix >= grid.nx || sample.iy < 0 || sample.iy >= grid.ny) continue;
    matrix[sample.iy][sample.ix] = sample;
  }
  return matrix;
}

function weightedDepth(candidates, tx, ty) {
  const weights = [
    (1 - tx) * (1 - ty),
    tx * (1 - ty),
    tx * ty,
    (1 - tx) * ty
  ];
  let weighted = 0;
  let weightSum = 0;
  let valid = 0;
  let coastal = false;
  candidates.forEach((sample, index) => {
    if (!sample || !Number.isFinite(sample.depth)) return;
    const weight = Math.max(1e-6, weights[index]);
    weighted += sample.depth * weight;
    weightSum += weight;
    valid += 1;
    coastal = coastal || Boolean(sample.coastal_uncertain);
  });
  if (valid < 3 || weightSum <= 0) return null;
  return { depth: weighted / weightSum, support: valid, coastal };
}

export function interpolateBathymetrySurface(grid, {
  mask = null,
  width = 512,
  height = null,
  minimumMaskAlpha = 24,
  palette = AOI_ADAPTIVE_PALETTE
} = {}) {
  if (!grid || !Number.isInteger(grid.nx) || !Number.isInteger(grid.ny) || grid.nx < 2 || grid.ny < 2) {
    throw new Error('Bathymetry grid is not suitable for surface interpolation');
  }
  if (!Array.isArray(grid.bbox) || grid.bbox.length !== 4) throw new Error('Bathymetry surface requires a georeferenced bbox');
  const [minLon, minLat, maxLon, maxLat] = grid.bbox.map(Number);
  const resolvedWidth = Math.max(128, Math.min(768, Math.round(width)));
  const aspect = Math.max(0.2, Math.min(5, (maxLat - minLat) / Math.max(1e-9, maxLon - minLon)));
  const resolvedHeight = Math.max(128, Math.min(768, Math.round(height ?? resolvedWidth * aspect)));
  const rgba = new Uint8ClampedArray(resolvedWidth * resolvedHeight * 4);
  const matrix = sampleMatrix(grid);
  const minDepth = Number.isFinite(grid.min) ? grid.min : Math.min(...(grid.samples ?? []).map(sample => sample.depth).filter(Number.isFinite));
  const maxDepth = Number.isFinite(grid.max) ? grid.max : Math.max(...(grid.samples ?? []).map(sample => sample.depth).filter(Number.isFinite));

  let renderedPixels = 0;
  let uncertainPixels = 0;
  for (let py = 0; py < resolvedHeight; py += 1) {
    const v = (py + 0.5) / resolvedHeight;
    const lat = maxLat - v * (maxLat - minLat);
    const gy = v * grid.ny - 0.5;
    const y0 = Math.max(0, Math.min(grid.ny - 2, Math.floor(gy)));
    const y1 = y0 + 1;
    const ty = clamp01(gy - y0);
    for (let px = 0; px < resolvedWidth; px += 1) {
      const u = (px + 0.5) / resolvedWidth;
      const lon = minLon + u * (maxLon - minLon);
      const maskAlpha = mask ? alphaAt(mask, lon, lat) : 255;
      if (mask && maskAlpha < minimumMaskAlpha) continue;
      const gx = u * grid.nx - 0.5;
      const x0 = Math.max(0, Math.min(grid.nx - 2, Math.floor(gx)));
      const x1 = x0 + 1;
      const tx = clamp01(gx - x0);
      const value = weightedDepth([
        matrix[y0][x0], matrix[y0][x1], matrix[y1][x1], matrix[y1][x0]
      ], tx, ty);
      if (!value) continue;
      const [r, g, b] = colorForDepth(value.depth, minDepth, maxDepth, palette);
      const supportFactor = value.support === 4 ? 1 : 0.66;
      const coastalFactor = value.coastal ? 0.58 : 1;
      const alpha = Math.round(235 * supportFactor * coastalFactor * (maskAlpha / 255));
      const offset = (py * resolvedWidth + px) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = alpha;
      renderedPixels += 1;
      if (value.support < 4 || value.coastal) uncertainPixels += 1;
    }
  }

  return {
    width: resolvedWidth,
    height: resolvedHeight,
    rgba,
    bbox: [minLon, minLat, maxLon, maxLat],
    min: minDepth,
    max: maxDepth,
    rendered_pixels: renderedPixels,
    uncertain_pixels: uncertainPixels,
    derivation: 'DISPLAY_INTERPOLATION_FROM_NUMERIC_GRID',
    analytical_source_unchanged: true
  };
}
