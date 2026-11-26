import test from 'node:test';
import assert from 'node:assert/strict';
import { readGebcoGeoTiff, generateGebcoContours } from '../src/data/gebco-geotiff.js';
import { sourceSpec, localContoursMatchSource } from '../src/map/bathymetry-source-policy.js';
import { contourPresentationPolicy } from '../src/map/contour-presentation-policy.js';

export const GEBCO_TEST_TIF_BASE64='SUkqAAgAAAARAAABAwABAAAACAAAAAEBAwABAAAACAAAAAIBAwABAAAAIAAAAAMBAwABAAAAAQAAAAYBAwABAAAAAQAAABEBBAABAAAAgAEAABUBAwABAAAAAQAAABYBAwABAAAACAAAABcBBAABAAAAAAEAABwBAwABAAAAAQAAAFMBAwABAAAAAwAAAA6DDAADAAAA2gAAAIKEDAAGAAAA8gAAAK+HAwAgAAAAIgEAALCHDAACAAAAYgEAALGHAgAIAAAAcgEAAIGkAgAGAAAAegEAAAAAAAD8qfHSTWJQP/yp8dJNYlA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC4HoXrUTgxQLByaJHtPERAAAAAAAAAAAABAAEAAAAHAAAEAAABAAIAAQQAAAEAAQAACAAAAQDmEAEIsYcHAAAABggAAAEAjiMJCLCHAQABAAsIsIcBAAAAiG10lh2kckAAAABAplRYQVdHUyA4NHwALTk5OTkAAAAQQQAAAMEAADDBAABgwQAAiMEAAKDBAAC4wQAA0MEAAODAAAAgwQAAUMEAAIDBAACYwQAAsMEAAMjBAADgwQAAEMEAAEDBAABwwQAAkMEAAKjBAADAwQAA2MEAAPDBAAAwwQAAYMEAAIjBAACgwQAAuMEAANDBAADowQAAAMIAAFDBAACAwQAAmMEAALDBAADIwQAA4MEAAPjBAAAIwgAAcMEAAJDBAACowQAAwMEAANjBAADwwQAABMIAABDCAACIwQAAoMEAALjBAADQwQAA6MEAAADCAAAMwgAAGMIAAJjBAACwwQAAyMEAAODBAAD4wQAACMIAABTCAAAgwg==';
const area={minLon:17.220,minLat:40.468,maxLon:17.228,maxLat:40.476};
function bytes(){const b=Buffer.from(GEBCO_TEST_TIF_BASE64,'base64');return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}

test('real georeferenced GeoTIFF is cropped to AOI; negative elevations are marine depths and positive land stays absent',async()=>{
  const parsed=await readGebcoGeoTiff(bytes(),area);
  assert.equal(parsed.horizontal_source,'GEBCO_2026_USER_SUPPLIED_GEOTIFF');
  assert.equal(parsed.source_vertical_convention,'elevation-positive-up');
  assert.ok(parsed.data.valid_cells>0);
  assert.equal(parsed.data.total_cells,64);
  assert.equal(parsed.data.valid_cells,63);
  assert.ok(parsed.data.samples.every(x=>x.depth>=0));
  assert.equal(parsed.data.min,8);
  assert.equal(parsed.data.max,40);
  assert.equal(parsed.reference_level,'ASSUMED_MSL_MUST_VERIFY');
});

test('operator request for 2 vs 6 GEBCO levels changes actual numeric contour feature geometry',async()=>{
  const parsed=await readGebcoGeoTiff(bytes(),area);
  const two=generateGebcoContours(parsed,2),six=generateGebcoContours(parsed,6);
  assert.equal(two.summary.requested_levels,2);
  assert.equal(six.summary.requested_levels,6);
  assert.ok(two.geometry.features.length>0);
  assert.ok(six.geometry.features.length>two.geometry.features.length);
  const d2=[...new Set(two.geometry.features.map(f=>f.properties.depth_m))];
  const d6=[...new Set(six.geometry.features.map(f=>f.properties.depth_m))];
  assert.ok(d6.length>d2.length);
  assert.notDeepEqual(d2,d6);
  assert.ok(six.geometry.features.every(f=>f.properties.source==='GEBCO_2026_USER_SUPPLIED_GEOTIFF'));
});

test('source authority forbids WCS contours when published WFS, GEBCO or coastal ENC is selected',()=>{
  assert.equal(sourceSpec('emodnet-rainbow').authority,'EMODNET_WFS');
  assert.equal(sourceSpec('emodnet-multicolour').authority,'EMODNET_WCS');
  assert.equal(sourceSpec('gebco-global').authority,'GEBCO_IMPORTED_GRID');
  assert.equal(sourceSpec('coastal-charts').authority,'COASTAL_CHARTS');
  assert.equal(localContoursMatchSource('gebco-global','EMODNET_WCS'),false);
  assert.equal(localContoursMatchSource('emodnet-rainbow','EMODNET_WCS'),false);
  assert.equal(localContoursMatchSource('emodnet-multicolour','EMODNET_WCS'),true);
  assert.equal(localContoursMatchSource('emodnet-multicolour',null),false);
  const aoi=area,summary={levels_m:[12,20],feature_count:10,coverage_ratio:1};
  const base={aoi,contours:true,hasRegionalContext:true,summary,bathymetryGridSource:'EMODNET_WCS'};
  const wcs=contourPresentationPolicy({...base,bathyMode:'emodnet-multicolour'});
  assert.equal(wcs.numericVisible,true);assert.equal(wcs.contextVisible,false);
  const wfs=contourPresentationPolicy({...base,bathyMode:'emodnet-rainbow'});
  assert.equal(wfs.numericVisible,false);assert.equal(wfs.contextVisible,true);
  const gebco=contourPresentationPolicy({...base,bathyMode:'gebco-global'});
  assert.equal(gebco.numericVisible,false);assert.equal(gebco.contextVisible,false);
  assert.equal(gebco.mode,'gebco-await');
  const enc=contourPresentationPolicy({...base,bathyMode:'coastal-charts'});
  assert.equal(enc.numericVisible,false);assert.equal(enc.contextVisible,false);
});
