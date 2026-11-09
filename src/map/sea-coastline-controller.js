/**
 * Optional SEA cartographic mask.
 *
 * The core map and all marine data layers must initialize even when the
 * external OpenFreeMap host is offline/blocked. Keep its vector layer hidden
 * until a lightweight CORS availability check succeeds.
 *
 * This mask improves visual land/sea separation. It is NOT a hydrographic
 * coastline or source of predictor geometry.
 */
import { SEA_BACKGROUND_LAYER_ID } from './land-sea-style.js';

const METADATA_URL = 'https://tiles.openfreemap.org/planet/latest';

export function initializeSeaCoastlineMask(map, statusElement = null) {
  const setStatus = (message, kind = '') => {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.className = kind ? 'status ' + kind : 'status';
  };

  setStatus('Coastline display mask: checking OpenFreeMap availability.');
  map.once('load', async () => {
    try {
      const response = await fetch(METADATA_URL, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) throw new Error('OpenFreeMap HTTP ' + response.status);
      if (!map.getLayer(SEA_BACKGROUND_LAYER_ID)) return;
      map.setLayoutProperty(SEA_BACKGROUND_LAYER_ID, 'visibility', 'visible');
      setStatus('Coastline display mask enabled · sea background independent of land style.', 'good');
    } catch {
      // Do not compromise numeric bathymetry, AOI layers or the marine overlay
      // when a visual coastline provider is unavailable.
      setStatus('Coastline mask unavailable · marine data unaffected; coastal colours may follow land imagery.', 'warn');
    }
  });
}
