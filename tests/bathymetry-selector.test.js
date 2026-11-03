import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bboxCoverageRatio,
  buildHrBathymetryDiscoveryUrl,
  discoverBathymetrySource,
  inferLinks,
  inferResolutionM,
  resolveBathymetrySelection,
  selectBestHrCandidate
} from '../src/data/bathymetry-selector.js';

const AOI = { minLon: 15, minLat: 40, maxLon: 15.0047, maxLat: 40.0036 };

function feature({ id, bbox, resolution = '1/128 arc minute', download = null, metadata = null }) {
  const [w, s, e, n] = bbox;
  return {
    type: 'Feature', id,
    properties: {
      title: id,
      resolution,
      ...(download ? { download_url: download } : {}),
      ...(metadata ? { metadata_url: metadata } : {})
    },
    geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
  };
}

test('HR discovery URL targets official hr_bathymetry_area layer', () => {
  const url = buildHrBathymetryDiscoveryUrl(AOI);
  assert.match(url, /typeName=emodnet%3Ahr_bathymetry_area/);
  assert.match(url, /outputFormat=application%2Fjson/);
});

test('resolution parser understands EMODnet HR arc-minute families and metric metadata', () => {
  assert.ok(Math.abs(inferResolutionM({ resolution: '1/512 arc minute' }) - (1852 / 512)) < 0.01);
  assert.equal(inferResolutionM({ cell_size: 'grid resolution 20 m' }), 20);
});

test('link parser prefers direct download over catalogue metadata', () => {
  const links = inferLinks({
    metadata: 'https://catalog.example/product/123',
    download: 'https://data.example/hr_dtm.nc'
  });
  assert.equal(links.download_url, 'https://data.example/hr_dtm.nc');
  assert.equal(links.metadata_url, 'https://catalog.example/product/123');
});

test('coverage ratio distinguishes full and partial HR footprints', () => {
  assert.ok(bboxCoverageRatio({ minLon: 14.9, minLat: 39.9, maxLon: 15.1, maxLat: 40.1 }, AOI) > 0.99);
  const partial = bboxCoverageRatio({ minLon: 15, minLat: 40, maxLon: 15.00235, maxLat: 40.0036 }, AOI);
  assert.ok(partial > 0.45 && partial < 0.55);
});

test('selector prefers full AOI coverage before finer partial product', () => {
  const fc = { type: 'FeatureCollection', features: [
    feature({ id: 'partial-fine', bbox: [15, 40, 15.002, 40.0036], resolution: '1/512 arc minute', download: 'https://data.example/fine.nc' }),
    feature({ id: 'full-coarser', bbox: [14.99, 39.99, 15.02, 40.02], resolution: '1/64 arc minute', download: 'https://data.example/full.nc' })
  ] };
  const { best } = selectBestHrCandidate(fc, AOI);
  assert.equal(best.name, 'full-coarser');
});

test('full HR footprint with direct data link becomes selected source', () => {
  const fc = { type: 'FeatureCollection', features: [
    feature({ id: 'hr-full', bbox: [14.99, 39.99, 15.02, 40.02], resolution: '1/256 arc minute', download: 'https://data.example/hr.tif' })
  ] };
  const selection = resolveBathymetrySelection(fc, AOI);
  assert.equal(selection.status, 'HR_SELECTED');
  assert.equal(selection.selected_source, 'EMODNET_HR_DTM');
  assert.equal(selection.primary.download_url, 'https://data.example/hr.tif');
  assert.ok(selection.native_horizontal_resolution_m < 10);
});

test('HR footprint without direct data link stays candidate and executable standard fallback', () => {
  const fc = { type: 'FeatureCollection', features: [
    feature({ id: 'hr-meta', bbox: [14.99, 39.99, 15.02, 40.02], resolution: '1/128 arc minute', metadata: 'https://catalog.example/hr-meta' })
  ] };
  const selection = resolveBathymetrySelection(fc, AOI);
  assert.equal(selection.status, 'HR_CANDIDATE_METADATA_REQUIRED');
  assert.equal(selection.selected_source, 'EMODNET_STANDARD_DTM');
  assert.equal(selection.native_horizontal_resolution_m, 115);
});

test('network discovery failure degrades to standard DTM without throwing', async () => {
  const fetchImpl = async () => { throw new Error('offline'); };
  const selection = await discoverBathymetrySource(AOI, { fetchImpl, timeoutMs: 10 });
  assert.equal(selection.status, 'STANDARD_FALLBACK');
  assert.equal(selection.discovery, 'UNAVAILABLE');
  assert.equal(selection.selected_source, 'EMODNET_STANDARD_DTM');
});
