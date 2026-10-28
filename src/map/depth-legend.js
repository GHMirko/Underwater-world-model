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

export const CHART_RELIEF_STOPS = Object.freeze(WATER_STOPS.map(stop => Object.freeze({ ...stop })));

export function chartReliefExpression() {
  const LSB = 1 / 256;
  const expression = ['interpolate', ['linear'], ['elevation']];
  [...CHART_RELIEF_STOPS]
    .filter(stop => stop.depth > 0)
    .reverse()
    .forEach(({ depth, color }) => expression.push(-depth, color));
  expression.push(
    -LSB, '#f8fdff',
    0, '#9dcbe8',
    LSB, '#58af9c',
    1, '#58af9c',
    2 - LSB, '#58af9c',
    2, 'rgba(0,0,0,0)'
  );
  return expression;
}

const MODE_LEGENDS = {
  'chart-relief': {
    title: 'Depth shading',
    subtitle: 'dynamic DEM · darker = deeper',
    colors: CHART_RELIEF_STOPS.map(stop => stop.color),
    ticks: ['0', '20', '50', '100', '200', '500', '1k', '2k', '4k', '6k+'],
    quantitative: true
  },
  'emodnet-rainbow': {
    title: 'EMODnet depth',
    subtitle: 'rainbow WMS · provider palette',
    colors: ['#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#91cf60', '#1a9850', '#2c7bb6'],
    ticks: ['shallow', '', '', '', '', '', 'deep'],
    quantitative: false
  },
  'emodnet-multicolour': {
    title: 'EMODnet depth',
    subtitle: 'multicolour WMS · provider palette',
    colors: ['#d9f0ff', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    ticks: ['shallow', '', '', '', '', 'deep'],
    quantitative: false
  },
  'emodnet-atlas': {
    title: 'EMODnet atlas',
    subtitle: 'bathymetry + land · provider palette',
    colors: ['#f7f2df', '#d7e9f5', '#a7cfe8', '#71add3', '#397fae', '#174a73'],
    ticks: ['land/shore', '', '', '', '', 'deep'],
    quantitative: false
  },
  'gebco-relief': {
    title: 'GEBCO relief',
    subtitle: 'shaded relief · non-quantitative',
    colors: ['#dfeef6', '#abcde0', '#75a9c8', '#3d7da4', '#174e77', '#082f4f'],
    ticks: ['shallow', '', '', '', '', 'deep'],
    quantitative: false
  }
};

export function legendModel(mode, bathymetry = null) {
  const base = MODE_LEGENDS[mode] ?? null;
  if (!base) return null;
  const range = bathymetry && Number.isFinite(bathymetry.min) && Number.isFinite(bathymetry.max)
    ? `AOI REAL: ${bathymetry.min.toFixed(0)}–${bathymetry.max.toFixed(0)} m`
    : 'AOI range: not sampled';
  return { ...base, range };
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
