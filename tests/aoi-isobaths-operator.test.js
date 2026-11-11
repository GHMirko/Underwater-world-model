import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseContourScheme, normalizeContourCount, buildAdaptiveContours, contourSummary } from '../src/map/local-contours.js';
import { LayerManager } from '../src/map/layer-manager.js';

test('requested N AOI depths are exactly N adaptive thresholds, without synthetic additional curves', () => {
  for(const n of [2,3,5,8,12,20,30]) {
    const s=chooseContourScheme(3.4,21.1,n);
    assert.equal(s.requested_levels,n);
    assert.equal(s.levels.length,n);
    assert.ok(s.levels.every(l=>l.depth_m>3.4&&l.depth_m<21.1));
    assert.ok(s.levels.every((l,i)=>i===0||l.depth_m>s.levels[i-1].depth_m));
  }
  assert.equal(chooseContourScheme(50,50,6).levels.length,0);
  assert.throws(()=>normalizeContourCount(0),/2 a 30/);
  assert.throws(()=>chooseContourScheme(0,100,31),/2 a 30/);
});

test('available contour levels can be fewer than requested when numeric cells do not cross', () => {
  const samples=[
    { ix:0,iy:0,lon:15.0,lat:37.0,depth:10 },
    { ix:1,iy:0,lon:15.1,lat:37.0,depth:20 },
    { ix:0,iy:1,lon:15.0,lat:37.1,depth:10 },
    { ix:1,iy:1,lon:15.1,lat:37.1,depth:20 }
  ];
  const scheme=chooseContourScheme(0,100,8);
  const contours=buildAdaptiveContours({samples,nx:2,ny:2,scheme,metadata:{source:'numeric'}});
  const summary=contourSummary(contours,scheme,{confidence:'MEDIUM',coverage_ratio:1});
  assert.equal(summary.requested_levels,8);
  assert.ok(summary.available_levels<summary.requested_levels);
  assert.ok(summary.levels_m.every(d=>d>=10&&d<=20));
});

function fakeMap(){
  const layers=new Map([['background',{id:'background'}],['land-basemap-minimal',{id:'land-basemap-minimal',layout:{visibility:'visible'}}],['land-basemap-satellite',{id:'land-basemap-satellite',layout:{visibility:'none'}}]]);
  const sources=new Map();
  const touched=[];
  return {
    getLayer:id=>layers.get(id)||null,
    getSource:id=>sources.get(id)||null,
    addSource(id,source){touched.push('addSource:'+id);sources.set(id,source)},
    addLayer(layer){touched.push('addLayer:'+layer.id);layers.set(layer.id,layer)},
    removeLayer(id){touched.push('removeLayer:'+id);layers.delete(id)},
    removeSource(id){touched.push('removeSource:'+id);sources.delete(id)},
    getCenter:()=>({lng:15,lat:40}),
    on(){},off(){},
    touched
  };
}
test('all bathymetry modes retain selectable sources but never paint a WMS or relief raster on land', () => {
  const map=fakeMap();
  const manager=new LayerManager(map);
  for(const mode of ['aoi-adaptive','emodnet-rainbow','emodnet-multicolour','gebco-global','chart-relief','none']) {
    manager.setBathymetry(mode);
    for(const id of ['bathymetry-layer','bathymetry-fallback-layer']){
      const layer=map.getLayer(id);
      if(layer)assert.equal(layer.layout?.visibility,'none',mode+' '+id);
    }
  }
  assert.ok(map.touched.every(op=>!op.includes('land-basemap-')),map.touched.join(','));
  assert.equal(map.getLayer('land-basemap-minimal').layout.visibility,'visible');
  assert.equal(map.getLayer('land-basemap-satellite').layout.visibility,'none');
  manager.destroy();
});
