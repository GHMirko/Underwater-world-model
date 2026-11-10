/**
 * Optional place-name navigation.
 * Photon (komoot) performs user-triggered OSM search; never auto-complete,
 * reverse-geocode or poll the provider. Public demo is best-effort and
 * rate-limited; move to dedicated geocoding for production workloads.
 *
 * Search changes ONLY MapLibre's camera. AOI and analytical datasets are untouched.
 */
export const PLACE_SEARCH_ENDPOINT = 'https://photon.komoot.io/api';
const RATE_LIMIT_MS = 1100;
let lastRemoteRequest = 0;

export function parseCoordinateCenter(text) {
  const match = /^\s*([-+]?\d+(?:\.\d+)?)\s*[,;]\s*([-+]?\d+(?:\.\d+)?)\s*$/.exec(String(text));
  if (!match) return null;
  const lat = Number(match[1]), lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { id: 'coordinates', label: `${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E`, latitude: lat, longitude: lon, zoom: 11 };
}

function placeZoom(properties) {
  const type = properties?.osm_value;
  if (type === 'country') return 5;
  if (['state', 'region', 'province'].includes(type)) return 7;
  if (['city', 'town', 'village', 'municipality'].includes(type)) return 11;
  return 12;
}

export function normalizePhotonPlaces(payload) {
  if (!Array.isArray(payload?.features)) return [];
  return payload.features.slice(0, 5).flatMap((feature, index) => {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return [];
    const [lon, lat] = coords;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return [];
    const p = feature.properties || {};
    const nameParts = [p.name, p.city && p.city !== p.name ? p.city : null, p.state, p.country];
    const label = nameParts.filter((x, i, a) => typeof x === 'string' && x.trim() && a.indexOf(x) === i).join(', ');
    if (!label) return [];
    return {
      id: `${p.osm_type ?? 'place'}-${p.osm_id ?? index}`,
      label, latitude: lat, longitude: lon, zoom: placeZoom(p)
    };
  });
}

export function placeSearchUrl(query, endpoint = PLACE_SEARCH_ENDPOINT) {
  const clean = String(query ?? '').trim();
  if (clean.length < 2 || clean.length > 120) throw new Error('Inserisci un nome di luogo di almeno 2 caratteri (massimo 120).');
  const url = new URL(endpoint);
  url.searchParams.set('q', clean);
  url.searchParams.set('limit', '5');
  url.searchParams.set('lang', 'it');
  return url.toString();
}

export async function lookupPlaces(query, { fetchImpl = fetch, endpoint = PLACE_SEARCH_ENDPOINT, signal } = {}) {
  const coordinate = parseCoordinateCenter(query);
  if (coordinate) return [coordinate];
  // Intentional single user-triggered search, never on keystrokes.
  const url = placeSearchUrl(query, endpoint);
  const now = Date.now();
  if (now - lastRemoteRequest < RATE_LIMIT_MS) throw new Error('Attendi un secondo prima di una nuova ricerca.');
  lastRemoteRequest = now;
  const response = await fetchImpl(url, { signal, credentials: 'omit', mode: 'cors' });
  if (!response.ok) {
    if (response.status === 429) throw new Error('Limite del servizio di ricerca raggiunto. Riprova più tardi.');
    throw new Error(`Servizio di ricerca non disponibile (HTTP ${response.status}).`);
  }
  return normalizePhotonPlaces(await response.json());
}

export function attachPlaceSearch({ form, input, results, status, map, fetchImpl = fetch }) {
  if (!form || !input || !results || !status || !map) throw new Error('Missing place-search UI or map');
  let pending = null;
  const submit = form.querySelector('button[type=submit]');

  function message(text, kind = '') {
    status.textContent = text;
    status.className = 'place-search-status' + (kind ? ' status ' + kind : '');
  }

  function openPlace(place) {
    map.flyTo({
      center: [place.longitude, place.latitude],
      zoom: place.zoom,
      speed: 1.2,
      essential: true
    });
    results.replaceChildren();
    input.value = place.label;
    message(`Mappa centrata su ${place.label}. AOI esistente invariata.`, 'good');
  }

  async function onSubmit(event) {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) { message('Inserisci il nome di un luogo.', 'warn'); return; }
    if (pending) pending.abort();
    const currentRequest = new AbortController();
    pending = currentRequest;
    results.replaceChildren();
    if (submit) submit.disabled = true;
    message('Ricerca geografica…');
    try {
      const candidates = await lookupPlaces(query, { fetchImpl, signal: currentRequest.signal });
      if (!candidates.length) {
        message('Nessun luogo trovato. Prova con un nome più specifico.', 'warn');
        return;
      }
      if (candidates.length === 1 && candidates[0].id === 'coordinates') {
        openPlace(candidates[0]);
        return;
      }
      const list = document.createElement('div');
      list.className = 'place-results-list';
      for (const place of candidates) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn place-result';
        button.textContent = place.label;
        button.addEventListener('click', () => openPlace(place));
        list.append(button);
      }
      results.replaceChildren(list);
      message(`${candidates.length} risultati. Seleziona il luogo corretto.`);
    } catch (error) {
      if (error?.name !== 'AbortError') message(error?.message || 'Ricerca non disponibile.', 'warn');
    } finally {
      if (pending === currentRequest) {
        if (submit) submit.disabled = false;
        pending = null;
      }
    }
  }

  form.addEventListener('submit', onSubmit);
  return () => {
    pending?.abort();
    form.removeEventListener('submit', onSubmit);
  };
}
