export const state = {
  mission: 'ASW',
  aoi: null,
  bathymetry: null,
  baseMap: 'chart',
  bathyMode: 'chart-relief',
  contours: true,
  contourDensity: 'dense',
  assets: new Set(['SIM-UUV-A', 'SIM-UUV-B', 'SIM-USV-GW', 'SIM-GLIDER'])
};

export function patchState(patch) {
  Object.assign(state, patch);
  return state;
}
