import { state, subscribeState } from '../state.js';

function waitForApp() {
  return new Promise(resolve => {
    const tick = () => {
      if (window.__MSO__?.map && window.__MSO__?.layers) resolve(window.__MSO__);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

const app = await waitForApp();
const map = app.map;
let applying = false;

function enforceViewMode() {
  if (applying || !map.isStyleLoaded()) return;
  if (state.bathyMode === 'aoi-adaptive') return;
  applying = true;
  try {
    app.layers.setBathymetry(state.bathyMode);
  } finally {
    applying = false;
  }
}

function schedule() {
  [0, 80, 220].forEach(delay => setTimeout(() => {
    try { enforceViewMode(); } catch { /* style graph still settling */ }
  }, delay));
}

subscribeState((next, patch) => {
  if (
    Object.prototype.hasOwnProperty.call(patch, 'bathyMode') ||
    Object.prototype.hasOwnProperty.call(patch, 'baseMap')
  ) schedule();
});

map.on('style.load', schedule);

schedule();
