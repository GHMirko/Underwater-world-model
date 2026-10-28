export const ASSETS = [
  { id: 'SIM-UUV-A', type: 'UUV', maxDepth: 3000, speed: 3, endurance: 40, energy: 80, sensor: 0.86, cost: 1.0, robustness: 0.78 },
  { id: 'SIM-UUV-B', type: 'UUV', maxDepth: 1500, speed: 4.2, endurance: 28, energy: 62, sensor: 0.92, cost: 1.18, robustness: 0.73 },
  { id: 'SIM-USV-GW', type: 'USV', maxDepth: 0, speed: 8, endurance: 60, energy: 120, sensor: 0.48, cost: 0.72, robustness: 0.84 },
  { id: 'SIM-GLIDER', type: 'GLIDER', maxDepth: 1000, speed: 0.7, endurance: 240, energy: 25, sensor: 0.55, cost: 0.36, robustness: 0.88 }
];

export const DEFAULT_WEIGHTS = {
  ASW: { coverage: 40, time: 20, energy: 10, cost: 10, robustness: 20 },
  MCM: { coverage: 35, time: 15, energy: 10, cost: 15, robustness: 25 },
  REA: { coverage: 25, time: 10, energy: 10, cost: 10, robustness: 45 }
};

const DIRECTIONS = { coverage: 1, time: -1, energy: -1, cost: -1, robustness: 1 };

export function areaKm2(aoi) {
  if (!aoi) return 0;
  const lat = ((aoi.minLat + aoi.maxLat) / 2) * Math.PI / 180;
  return Math.abs((aoi.maxLon - aoi.minLon) * 111.32 * Math.cos(lat) * (aoi.maxLat - aoi.minLat) * 110.57);
}

export function combinations(items) {
  const output = [];
  for (let mask = 1; mask < (1 << items.length); mask += 1) {
    const combo = items.filter((_, index) => mask & (1 << index));
    output.push(combo);
  }
  return output;
}

export function evaluateCandidate(candidate, context) {
  const area = Math.max(10, areaKm2(context.aoi));
  const dmax = context.maxDepth ?? 500;
  const bathy = context.bathymetry;
  const underwater = candidate.filter(asset => asset.type !== 'USV');
  const feasible = underwater.every(asset => asset.maxDepth >= dmax);
  if (!feasible) return { feasible: false };

  const sensor = candidate.reduce((sum, asset) => sum + asset.sensor, 0);
  const speed = candidate.reduce((sum, asset) => sum + asset.speed, 0);
  const complexityPenalty = bathy ? Math.min(0.28, bathy.complexity * 0.55) : 0.10;
  const coverage = Math.max(12, Math.min(98, (48 + 18 * sensor + 4 * candidate.length - Math.sqrt(area) / 7) * (1 - complexityPenalty)));
  const timeFactor = 1 + (bathy ? Math.min(0.18, bathy.complexity * 0.35) : 0.05);
  const time = Math.max(1.5, ((Math.sqrt(area) * 4.4) / Math.max(1, speed) + 5 / candidate.length) * timeFactor);
  const energy = candidate.reduce((sum, asset) => sum + asset.energy * (0.045 + 0.006 * time), 0);
  const cost = candidate.reduce((sum, asset) => sum + asset.cost * (1 + 0.065 * time), 0);
  const robustness = Math.max(25, Math.min(98, 35 + 11 * candidate.length + 10 * candidate.reduce((sum, asset) => sum + asset.robustness, 0) - (bathy ? bathy.complexity * 8 : 3)));

  return {
    feasible: true,
    id: candidate.map(asset => asset.id).join(' + '),
    assets: candidate.map(asset => asset.id),
    metrics: { coverage, time, energy, cost, robustness },
    provenance: bathy ? 'REAL_ENVIRONMENT + SURROGATE_PERFORMANCE' : 'SURROGATE'
  };
}

export function dominates(a, b) {
  let strictlyBetter = false;
  for (const [key, direction] of Object.entries(DIRECTIONS)) {
    const av = a.metrics[key];
    const bv = b.metrics[key];
    if (direction > 0 && av < bv) return false;
    if (direction < 0 && av > bv) return false;
    if ((direction > 0 && av > bv) || (direction < 0 && av < bv)) strictlyBetter = true;
  }
  return strictlyBetter;
}

export function paretoFront(candidates) {
  return candidates.filter(candidate => !candidates.some(other => other !== candidate && dominates(other, candidate)));
}

export function rankPareto(front, weights) {
  if (!front.length) return [];
  const keys = Object.keys(DIRECTIONS);
  const mins = Object.fromEntries(keys.map(key => [key, Math.min(...front.map(item => item.metrics[key]))]));
  const maxs = Object.fromEntries(keys.map(key => [key, Math.max(...front.map(item => item.metrics[key]))]));
  const weightSum = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;

  return front.map(item => {
    let score = 0;
    for (const key of keys) {
      const min = mins[key];
      const max = maxs[key];
      const utility = max === min ? 1 : DIRECTIONS[key] > 0
        ? (item.metrics[key] - min) / (max - min)
        : (max - item.metrics[key]) / (max - min);
      score += utility * (weights[key] ?? 0) / weightSum;
    }
    return { ...item, score };
  }).sort((a, b) => b.score - a.score);
}

export function optimize({ aoi, bathymetry, selectedAssetIds, mission = 'ASW', maxDepth = 500, weights }) {
  const selected = ASSETS.filter(asset => selectedAssetIds.includes(asset.id));
  const evaluated = combinations(selected)
    .map(candidate => evaluateCandidate(candidate, { aoi, bathymetry, maxDepth }))
    .filter(candidate => candidate.feasible);
  const front = paretoFront(evaluated);
  return rankPareto(front, weights ?? DEFAULT_WEIGHTS[mission] ?? DEFAULT_WEIGHTS.ASW);
}
