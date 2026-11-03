export const state = {
  mission: 'ASW',
  aoi: null,
  bathymetry: null,
  bathymetrySource: null,
  bathymetryGridSource: null,
  bathymetryGrid: null,
  bathymetryQuality: null,
  adaptiveContours: null,
  baseMap: 'minimal',
  bathyMode: 'aoi-adaptive',
  contours: true,
  contourDensity: 'dense',
  assets: new Set(['SIM-UUV-A', 'SIM-UUV-B', 'SIM-USV-GW', 'SIM-GLIDER'])
};

const listeners = new Set();

export function patchState(patch) {
  const previous = { ...state };
  Object.assign(state, patch);
  for (const listener of listeners) listener(state, patch, previous);
  return state;
}

export function subscribeState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
