import test from 'node:test';
import assert from 'node:assert/strict';
import { contourPresentationPolicy } from '../src/map/contour-presentation-policy.js';
import { contourDisplayAssessment } from '../src/map/contour-quality.js';

const base={aoi:null,contours:true,bathyMode:'aoi-adaptive',hasRegionalContext:true,summary:null};
const area={minLon:17,minLat:40,maxLon:17.3,maxLat:40.2};

test('before AOI there is contextual bathymetry, and defining an AOI cannot remove it before data arrive',()=>{
  const before=contourPresentationPolicy(base);
  assert.equal(before.mode,'context');
  assert.equal(before.contextVisible,true);
  assert.equal(before.numericVisible,false);
  const inProgress=contourPresentationPolicy({...base,aoi:area});
  assert.equal(inProgress.mode,'aoi-context-fallback');
  assert.equal(inProgress.contextVisible,true);
  assert.equal(inProgress.numericVisible,false);
});

test('numeric contours that genuinely exist stay displayed despite failing strict analysis QA',()=>{
  const lowQuality={coverage_ratio:0.18,levels_m:[55],feature_count:1};
  const assessment=contourDisplayAssessment(lowQuality);
  assert.equal(assessment.ready,false);
  assert.equal(assessment.displayable,true);
  const policy=contourPresentationPolicy({...base,aoi:area,summary:lowQuality});
  assert.equal(policy.mode,'aoi-provisional');
  assert.equal(policy.contextVisible,true);
  assert.equal(policy.numericVisible,true);
  assert.equal(policy.numericQaAccepted,false);
});

test('accepted AOI numeric contours coexist with visual context but never turn context into measurements',()=>{
  const valid={coverage_ratio:0.97,levels_m:[25,50,75],feature_count:5};
  const policy=contourPresentationPolicy({...base,aoi:area,summary:valid});
  assert.equal(policy.mode,'aoi-validated');
  assert.equal(policy.contextVisible,true);
  assert.equal(policy.numericVisible,true);
  assert.equal(policy.numericQaAccepted,true);
});

test('outside geographic coverage, local AOI numeric contours can remain while context is unavailable',()=>{
  const valid={coverage_ratio:0.9,levels_m:[50,100],feature_count:3};
  const policy=contourPresentationPolicy({...base,aoi:area,hasRegionalContext:false,summary:valid});
  assert.equal(policy.contextVisible,false);
  assert.equal(policy.numericVisible,true);
  assert.equal(policy.mode,'aoi-validated');
});

test('disabled bathymetry or disabled isobaths suppress both independent authorities',()=>{
  for(const patch of [{contours:false},{bathyMode:'none'}]){
    const policy=contourPresentationPolicy({...base,aoi:area,
      summary:{coverage_ratio:1,levels_m:[5,10],feature_count:4},...patch});
    assert.equal(policy.mode,'off');
    assert.equal(policy.contextVisible,false);
    assert.equal(policy.numericVisible,false);
  }
});

test('empty/incomplete data cannot be exported as valid; no fictitious lines are declared',()=>{
  for(const sample of [null,{coverage_ratio:1,levels_m:[],feature_count:0},
    {coverage_ratio:0,levels_m:[20],feature_count:1}]){
    const assessment=contourDisplayAssessment(sample);
    assert.equal(assessment.ready,false);
    assert.equal(assessment.displayable,false);
    const policy=contourPresentationPolicy({...base,aoi:area,summary:sample});
    assert.equal(policy.mode,'aoi-context-fallback');
    assert.equal(policy.numericVisible,false);
  }
});
