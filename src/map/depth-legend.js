const WATER_STOPS = [
  { depth: 0, color: '#f8fdff' },
  { depth: 20, color: '#e2f2fa' },
  { depth: 50, color: '#d2eaf6' },
  { depth: 100, color: '#bddcf0' },
  { depth: 200, color: '#9cc8e6' },
  { depth: 500, color: '#75afd8' },
  { depth: 1000, color: '#4d94c6' },
  { depth: 2000, color: '#2879b3' },
  { depth: 4000, color: '#0b4f83' },
  { depth: 6000, color: '#062b55' }
];

const AOI_ADAPTIVE_COLORS = ['#d9f3ff', '#98d9ef', '#52b6d8', '#2386bd', '#0b4f83'];

export const CHART_RELIEF_STOPS = Object.freeze(WATER_STOPS.map(stop => Object.freeze({ ...stop })));
export const AOI_ADAPTIVE_PALETTE = Object.freeze([...AOI_ADAPTIVE_COLORS]);

export function chartReliefExpression() {
  const LSB = 1 / 256;
  const expression = ['interpolate', ['linear'], ['elevation']];
  [...CHART_RELIEF_STOPS]
    .filter(stop => stop.depth > 0)
    .reverse()
    .forEach(({ depth, color }) => expression.push(-depth, color));

  expression.push(
    -LSB, '#f8fdff',
    0, 'rgba(248,253,255,0)',
    LSB, 'rgba(0,0,0,0)',
    10000, 'rgba(0,0,0,0)'
  );
  return expression;
}

function rangeOf(bathymetry) {
  if (!bathymetry || !Number.isFinite(bathymetry.min) || !Number.isFinite(bathymetry.max)) return null;
  const min = Number(bathymetry.min);
  const max = Number(bathymetry.max);
  if (max < min) return null;
  return { min, max: max === min ? min + 0.1 : max };
}

function adaptiveTicks(range, count = 5) {
  const span = range.max - range.min;
  return Array.from({ length: count }, (_, index) => {
    const value = range.min + (span * index) / (count - 1);
    return `${value.toFixed(span < 20 ? 1 : 0)}`;
  });
}

const MODE_LEGENDS = {
  'chart-relief': {
    title: 'Depth context',
    subtitle: 'Seascape DEM · EMODnet gap-fill · visual context only',
    colors: CHART_RELIEF_STOPS.map(stop => stop.color),
    ticks: ['0', '20', '50', '100', '200', '500', '1k', '2k', '4k', '6k+'],
    quantitative: true
  },
  'emodnet-rainbow': {
    title: 'EMODnet context depth',
    subtitle: 'rainbow WMS · context only · native grid ~115 m',
    colors: ['#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#91cf60', '#1a9850', '#2c7bb6'],
    ticks: ['shallow', '', '', '', '', '', 'deep'],
    quantitative: false
  },
  'gebco-global': {
    title: 'GEBCO 2026 global context',
    subtitle: 'GEBCO_Latest_2 WMS · visual context only · global 15 arc-second grid',
    colors: ['#d9f0ff', '#9ecae1', '#6baed6', '#3182bd', '#08519c'],
    ticks: ['shallow', '', '', '', 'deep'],
    quantitative: false
  },
  'emodnet-multicolour': {
    title: 'EMODnet context depth',
    subtitle: 'multicolour WMS · context only · native grid ~115 m',
    colors: ['#d9f0ff', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    ticks: ['shallow', '', '', '', '', 'deep'],
    quantitative: false
  }
};

export function legendModel(mode, bathymetry = null) {
  if (mode === 'aoi-adaptive') {
    const range = rangeOf(bathymetry);
    if (!range) return null;
    return {
      title: 'AOI REAL bathymetry',
      subtitle: `EMODnet numeric samples · adaptive colour scale · native source ~115 m`,
      colors: AOI_ADAPTIVE_COLORS,
      ticks: adaptiveTicks(range),
      quantitative: true,
      range: `AOI colour scale: ${range.min.toFixed(1)}–${range.max.toFixed(1)} m`
    };
  }

  const base = MODE_LEGENDS[mode] ?? null;
  if (!base) return null;
  const range = rangeOf(bathymetry);
  const rangeText = range
    ? `AOI REAL reference: ${range.min.toFixed(0)}–${range.max.toFixed(0)} m`
    : 'AOI range: not sampled';
  return { ...base, range: rangeText };
}

export function renderDepthLegend(element, mode, bathymetry = null) {
  const model = legendModel(mode, bathymetry);
  if (!model) {
    element.hidden = true;
    element.innerHTML = '';
    return;
  }
  element.hidden = false;
  const gradient = `linear-gradient(90deg, ${model.colors.join(', ')})`;
  element.innerHTML = `
    <div class="depth-legend-title">${model.title} <span>m</span></div>
    <div class="depth-legend-subtitle">${model.subtitle}</div>
    <div class="depth-legend-bar" style="background:${gradient}"></div>
    <div class="depth-legend-ticks">${model.ticks.map(tick => `<span>${tick}</span>`).join('')}</div>
    <div class="depth-legend-range">${model.range}</div>`;
}
