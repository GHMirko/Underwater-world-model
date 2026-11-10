import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperimentDocument,parseExperimentDocument,updateExperimentDocument,
  validateExperimentAoi,safeExperimentSlug,saveExperimentFolder,readExperimentFolder
} from '../src/experiments/experiment-store.js';
import {placeSearchUrl} from '../src/map/place-search.js';

test('Photon Italian location query no longer includes unsupported lang=it HTTP 400 parameter',()=>{
  const url=new URL(placeSearchUrl('Catania'));
  assert.equal(url.searchParams.get('q'),'Catania');
  assert.equal(url.searchParams.get('limit'),'5');
  assert.equal(url.searchParams.has('lang'),false);
});

test('experiment schema preserves AOI, parameters, plans and does not fabricate acquired data',()=>{
  const doc=createExperimentDocument({name:'Catania · Area 001',id:'expt-001',snapshot:{
    aoi:{minLon:15,minLat:37.4,maxLon:15.2,maxLat:37.6},
    mission:'REA',
    environment_request:{schema:'environmental-request/0.1',source_jobs:[{id:'copernicus'}]},
    acoustic_inventory:{readiness:{status:'NOT_READY'}}
  }});
  assert.equal(doc.folder_name,'catania-area-001-expt-001');
  assert.equal(doc.schema,'underwater-experiment/0.1');
  assert.equal(doc.snapshot.environment_request_state,'PLAN_ONLY_UNLESS_INPUT_FILES_ATTACHED');
  assert.equal(doc.snapshot.bellhop3d_state,'NOT_RUN');
  assert.deepEqual(parseExperimentDocument(JSON.parse(JSON.stringify(doc))).snapshot.aoi,doc.snapshot.aoi);
  assert.deepEqual(updateExperimentDocument(doc,{aoi:doc.snapshot.aoi,mission:'ASW'}).snapshot.mission,'ASW');
  assert.equal(safeExperimentSlug('../../PROVA \\ test'),'prova-test');
  assert.throws(()=>validateExperimentAoi({minLon:20,maxLon:18,minLat:30,maxLat:31}),/AOI non valida/);
  assert.throws(()=>parseExperimentDocument({schema:'unexpected',id:'evil'}),/incompatibile/);
});

function fakeDirectory(){
  const files=new Map(),subdirs=new Map();
  return {
    files,subdirs,
    async getDirectoryHandle(name,{create=false}={}){
      if(subdirs.has(name))return subdirs.get(name);
      if(!create)throw Object.assign(Error('missing'),{name:'NotFoundError'});
      const value=fakeDirectory();subdirs.set(name,value);return value;
    },
    async getFileHandle(name,{create=false}={}){
      if(!files.has(name)&&!create)throw Object.assign(Error('missing'),{name:'NotFoundError'});
      return {
        async createWritable(){
          let buffer='';
          return {async write(value){buffer+=String(value);},async close(){files.set(name,buffer);},async abort(){}};
        },
        async getFile(){return {async text(){return files.get(name);}};}
      };
    },
    async removeEntry(name){
      if(!files.has(name))throw Object.assign(Error('missing'),{name:'NotFoundError'});
      files.delete(name);
    }
  };
}
test('experiment folder writes aoi/manifests and removes stale generated manifests but keeps raw files',async()=>{
  const dir=fakeDirectory();
  const aoi={minLon:14,minLat:37,maxLon:15,maxLat:38};
  const doc=createExperimentDocument({name:'Catania Area',id:'expt-001',snapshot:{
    aoi,environment_request:{source_jobs:[{id:'planned-only'}]},
    acoustic_inventory:{readiness:{status:'NOT_READY'}},
    svp_candidates:[{id:'cast-1',samples:[{depth_m:0,sound_speed_m_s:1500}]}]
  }});
  await saveExperimentFolder(dir,doc);
  assert.equal(JSON.parse(dir.files.get('experiment.json')).schema,'underwater-experiment/0.1');
  assert.equal(JSON.parse(dir.files.get('aoi.geojson')).features.length,1);
  const wm=dir.subdirs.get('world-model');
  assert.ok(wm.files.has('environmental-request.json'));
  const raw=dir.subdirs.get('inputs').subdirs.get('raw');
  assert.ok(raw.files.has('svp-observations-imported.json'));
  raw.files.set('actual-ctd.nc','binary-bytes-reference');
  const restored=await readExperimentFolder(dir);
  assert.deepEqual(restored.snapshot.aoi,aoi);
  await saveExperimentFolder(dir,updateExperimentDocument(doc,{aoi:null,environment_request:null,acoustic_inventory:null,svp_candidates:[]}));
  assert.equal(dir.files.has('aoi.geojson'),false);
  assert.equal(wm.files.has('environmental-request.json'),false);
  assert.equal(raw.files.has('svp-observations-imported.json'),false);
  assert.equal(raw.files.get('actual-ctd.nc'),'binary-bytes-reference');
});
