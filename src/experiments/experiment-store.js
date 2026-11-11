/**
 * Versioned, locally reopenable experiment contract and IndexedDB repository.
 * This application has no backend. Browser data are local to this origin/profile.
 * Source jobs do NOT imply the corresponding NetCDF/GeoTIFF was downloaded.
 */
export const EXPERIMENT_SCHEMA = 'underwater-experiment/0.1';
const DB_NAME = 'underwater-mission-experiments-v1';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const HANDLES = 'handles';

export function safeExperimentSlug(value) {
  const normalized = String(value ?? '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52);
  return normalized || 'esperimento';
}

export function validateExperimentAoi(aoi) {
  if (aoi == null) return null;
  const keys = ['minLon','minLat','maxLon','maxLat'];
  if (!keys.every(k => typeof aoi[k] === 'number' && Number.isFinite(aoi[k])))
    throw new Error('AOI non valida: coordinate numeriche mancanti');
  if (aoi.minLon < -180 || aoi.maxLon > 180 || aoi.minLat < -90 || aoi.maxLat > 90 ||
      aoi.minLon >= aoi.maxLon || aoi.minLat >= aoi.maxLat)
    throw new Error('AOI non valida: limiti geografici non coerenti');
  return Object.fromEntries(keys.map(k=>[k,aoi[k]]));
}

export function createExperimentDocument({name,id,now=new Date().toISOString(),snapshot={}}) {
  const title = String(name ?? '').trim();
  if(title.length < 3 || title.length > 100)
    throw new Error('Nome esperimento: da 3 a 100 caratteri');
  const identifier = id || crypto.randomUUID();
  return {
    schema:EXPERIMENT_SCHEMA, id:identifier, name:title,
    created_at_utc:now,updated_at_utc:now,
    folder_name:safeExperimentSlug(title)+'-'+identifier.slice(0,8),
    snapshot:validateExperimentSnapshot(snapshot),
    attached_files:[],
    storage:{browser:'INDEXEDDB',folder:'NOT_LINKED'},
    notes:'Sorgenti cartografiche non equivalgono a dati numerici acquisiti.'
  };
}

export function validateExperimentSnapshot(snapshot) {
  if (!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot)) throw Error('Snapshot esperimento non valido');
  const aoi=validateExperimentAoi(snapshot.aoi ?? null);
  const data=JSON.parse(JSON.stringify({...snapshot,aoi}));
  // Keep a stable distinction between data status and model readiness.
  if(data.environment_request) data.environment_request_state='PLAN_ONLY_UNLESS_INPUT_FILES_ATTACHED';
  if(data.acoustic_inventory) data.bellhop3d_state='NOT_RUN';
  return data;
}
export function parseExperimentDocument(value) {
  if(!value || value.schema!==EXPERIMENT_SCHEMA || typeof value.id!=='string' ||
     !/^[a-zA-Z0-9_-]{6,100}$/.test(value.id) ||
     typeof value.name!=='string') throw Error('File esperimento incompatibile o non valido');
  const name=value.name.trim();
  if(name.length<3||name.length>100)throw Error('Nome esperimento non valido');
  const snapshot=validateExperimentSnapshot(value.snapshot ?? {});
  if(!Array.isArray(value.attached_files)||value.attached_files.length>1000)
    throw Error('Elenco degli allegati non valido');
  return {
    schema:EXPERIMENT_SCHEMA,id:value.id,name,
    created_at_utc:String(value.created_at_utc||new Date().toISOString()),
    updated_at_utc:String(value.updated_at_utc||new Date().toISOString()),
    folder_name:safeExperimentSlug(value.folder_name||name),
    snapshot,attached_files:value.attached_files.map(file=>({
      path:String(file.path||''),name:String(file.name||''),bytes:Number(file.bytes||0),
      imported_at_utc:String(file.imported_at_utc||''),
      classification:'UNVALIDATED_OPERATOR_INPUT'
    })),
    storage:{browser:'INDEXEDDB',folder:['LINKED','NOT_LINKED','RECONNECT_REQUIRED'].includes(value.storage?.folder)?value.storage.folder:'RECONNECT_REQUIRED'},
    notes:String(value.notes||'')
  };
}
export function updateExperimentDocument(document,snapshot,now=new Date().toISOString()) {
  const current=parseExperimentDocument(document);
  current.updated_at_utc=now;
  current.snapshot=validateExperimentSnapshot(snapshot);
  current.storage={...document.storage};
  return current;
}

export function openExperimentDatabase(idb=globalThis.indexedDB){
  if(!idb) return Promise.reject(Error('IndexedDB non disponibile nel browser'));
  return new Promise((resolve,reject)=>{
    const request=idb.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(PROJECTS))db.createObjectStore(PROJECTS,{keyPath:'id'});
      if(!db.objectStoreNames.contains(HANDLES))db.createObjectStore(HANDLES);
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('Apertura archivio fallita'));
  });
}
async function withStore(storeName,mode,runner){
  const db=await openExperimentDatabase();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,mode);
      const store=tx.objectStore(storeName);
      let result;
      try { result=runner(store); } catch(error) { reject(error);return; }
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error||Error('Errore archivio browser'));
      tx.onabort=()=>reject(tx.error||Error('Transazione archiviazione annullata'));
    });
  }finally{db.close();}
}
export async function saveLocalExperiment(doc){
  const valid=parseExperimentDocument(doc);
  await withStore(PROJECTS,'readwrite',store=>{store.put(valid);});
  return valid;
}
export async function listLocalExperiments(){
  const db=await openExperimentDatabase();
  try {
    return await new Promise((resolve,reject)=>{
      const req=db.transaction(PROJECTS,'readonly').objectStore(PROJECTS).getAll();
      req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>b.updated_at_utc.localeCompare(a.updated_at_utc)));
      req.onerror=()=>reject(req.error);
    });
  }finally{db.close();}
}
export async function loadLocalExperiment(id){
  const db=await openExperimentDatabase();
  try{return await new Promise((resolve,reject)=>{
    const req=db.transaction(PROJECTS,'readonly').objectStore(PROJECTS).get(id);
    req.onsuccess=()=>resolve(req.result?parseExperimentDocument(req.result):null);
    req.onerror=()=>reject(req.error);
  });}finally{db.close();}
}
export async function rememberExperimentHandle(id,handle){
  await withStore(HANDLES,'readwrite',store=>store.put(handle,id));
}
export async function getExperimentHandle(id){
  const db=await openExperimentDatabase();
  try{return await new Promise((resolve,reject)=>{
    const req=db.transaction(HANDLES,'readonly').objectStore(HANDLES).get(id);
    req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
  });}finally{db.close();}
}

export async function permissionToWrite(handle,{allowPrompt=false}={}){
  if(!handle)return false;
  if(typeof handle.queryPermission!=='function')return true; // test doubles
  if(await handle.queryPermission({mode:'readwrite'})==='granted')return true;
  return allowPrompt&&typeof handle.requestPermission==='function'&&
    await handle.requestPermission({mode:'readwrite'})==='granted';
}
async function writeFile(dir,name,value){
  const handle=await dir.getFileHandle(name,{create:true});
  const stream=await handle.createWritable();
  try{await stream.write(value);await stream.close();}
  catch(error){await stream.abort?.();throw error;}
}
async function ensureSubdir(dir,parts){
  let current=dir;
  for(const name of parts)current=await current.getDirectoryHandle(name,{create:true});
  return current;
}
async function clearGeneratedFile(dir,parts,name){
  const target=await ensureSubdir(dir,parts);
  try{await target.removeEntry(name);}catch(error){
    if(error?.name!=='NotFoundError')throw error;
  }
}
export async function saveExperimentFolder(dir,doc){
  const parsed=parseExperimentDocument(doc);
  await Promise.all([
    ensureSubdir(dir,['inputs','raw']),
    ensureSubdir(dir,['inputs','derived']),
    ensureSubdir(dir,['world-model']),
    ensureSubdir(dir,['acoustic']),
    ensureSubdir(dir,['runs']),
    ensureSubdir(dir,['results'])
  ]);
  const snapshot=parsed.snapshot;
  if(!snapshot.aoi) await clearGeneratedFile(dir,[],'aoi.geojson');
  if(!snapshot.environment_request)await clearGeneratedFile(dir,['world-model'],'environmental-request.json');
  if(!snapshot.isobaths_geojson)await clearGeneratedFile(dir,['world-model'],'isobaths.geojson');
  if(!snapshot.world_model_package)await clearGeneratedFile(dir,['world-model'],'world-model-package.json');
  if(!snapshot.acoustic_inventory)await clearGeneratedFile(dir,['acoustic'],'bellhop3d-environment.json');
  if(!snapshot.svp_candidates?.length)await clearGeneratedFile(dir,['inputs','raw'],'svp-observations-imported.json');
  if(snapshot.aoi){
    const aoi=snapshot.aoi;
    await writeFile(dir,'aoi.geojson',JSON.stringify({
      type:'FeatureCollection',features:[{type:'Feature',properties:{experiment_id:parsed.id},
      geometry:{type:'Polygon',coordinates:[[
      [aoi.minLon,aoi.minLat],[aoi.maxLon,aoi.minLat],[aoi.maxLon,aoi.maxLat],
      [aoi.minLon,aoi.maxLat],[aoi.minLon,aoi.minLat]
    ]]}}]},null,2));
  }
  if(snapshot.environment_request){
    const p=await ensureSubdir(dir,['world-model']);
    await writeFile(p,'environmental-request.json',JSON.stringify(snapshot.environment_request,null,2));
  }
  if(snapshot.isobaths_geojson){
    const p=await ensureSubdir(dir,['world-model']);
    await writeFile(p,'isobaths.geojson',JSON.stringify(snapshot.isobaths_geojson,null,2));
  }
  if(snapshot.world_model_package){
    const p=await ensureSubdir(dir,['world-model']);
    await writeFile(p,'world-model-package.json',JSON.stringify(snapshot.world_model_package,null,2));
  }
  if(snapshot.acoustic_inventory){
    const p=await ensureSubdir(dir,['acoustic']);
    await writeFile(p,'bellhop3d-environment.json',JSON.stringify(snapshot.acoustic_inventory,null,2));
  }
  if(snapshot.svp_candidates?.length){
    const p=await ensureSubdir(dir,['inputs','raw']);
    await writeFile(p,'svp-observations-imported.json',JSON.stringify({profiles:snapshot.svp_candidates},null,2));
  }
  // Commit experiment.json LAST: it is the index of a successfully written snapshot.
  await writeFile(dir,'experiment.json',JSON.stringify(parsed,null,2));
  return parsed;
}
export async function readExperimentFolder(dir){
  const file=await (await dir.getFileHandle('experiment.json')).getFile();
  return parseExperimentDocument(JSON.parse(await file.text()));
}
export async function attachFileToExperiment(dir,doc,file){
  if(!file || !file.name || !Number.isFinite(file.size)) throw Error('File allegato non valido');
  if(file.size>1024*1024*1024)throw Error('File superiore al limite iniziale di 1 GiB');
  const current=parseExperimentDocument(doc);
  const raw=await ensureSubdir(dir,['inputs','raw']);
  const safe=String(file.name).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,150);
  if(!safe || safe==='.' || safe==='..')throw Error('Nome file non valido');
  const destination=await raw.getFileHandle(safe,{create:true});
  const writable=await destination.createWritable();
  try{await writable.write(file);await writable.close();}
  catch(error){await writable.abort?.();throw error;}
  const relative='inputs/raw/'+safe;
  current.attached_files=current.attached_files.filter(x=>x.path!==relative);
  current.attached_files.push({path:relative,name:file.name,bytes:file.size,
    imported_at_utc:new Date().toISOString(),classification:'UNVALIDATED_OPERATOR_INPUT'});
  return current;
}
