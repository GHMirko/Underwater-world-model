
import {
  createExperimentDocument,updateExperimentDocument,parseExperimentDocument,
  saveLocalExperiment,listLocalExperiments,loadLocalExperiment,
  saveExperimentFolder,readExperimentFolder,rememberExperimentHandle,getExperimentHandle,
  permissionToWrite,attachFileToExperiment
} from './experiment-store.js';
import { downloadJson } from '../data/download.js';

/** Wire project ownership and explicit filesystem actions to a single operator panel. */
export function attachExperimentWorkspace({root,getSnapshot,restoreSnapshot,openMission}){
  const q=id=>root.querySelector('#'+id);
  let active=null,dir=null,dirty=false;
  const status=q('experimentStatus'),list=q('experimentLibrary'),label=q('activeExperimentName');
  const stateTag=q('activeExperimentDirty');
  const message=(text,kind='')=>{
    status.textContent=text;status.className='status'+(kind?' '+kind:'');
  };
  function reflect(){
    label.textContent=active?active.name:'NESSUN ESPERIMENTO';
    stateTag.textContent=active?(dirty?'MODIFICHE NON SALVATE':'SALVATO'):'NON ASSEGNATO';
    q('saveExperiment').disabled=!active;
    q('chooseExperimentFolder').disabled=!active || typeof window.showDirectoryPicker!=='function';
    q('exportExperiment').disabled=!active;
    q('attachExperimentFiles').disabled=!active || !dir;
    q('currentExperiment').textContent=active
      ?active.name+' · '+active.folder_name+(dir?' · cartella collegata':' · solo archivio browser')
      :'Crea o apri un esperimento prima di salvare i dati.';
  }
  async function refresh(){
    try{
      const local=await listLocalExperiments();
      const selected=active?.id??'';
      list.replaceChildren();
      const empty=document.createElement('option');
      empty.value='';empty.textContent='Seleziona un esperimento salvato';list.append(empty);
      for(const entry of local){
        const option=document.createElement('option');
        option.value=entry.id;
        option.textContent=entry.name+' · '+(entry.updated_at_utc||'').slice(0,16).replace('T',' ');
        list.append(option);
      }
      list.value=local.some(e=>e.id===selected)?selected:'';
    }catch(error){message('Archivio browser indisponibile: '+error.message,'warn');}
  }
  async function save({promptForWrite=false}={}){
    if(!active)throw Error('Apri o crea prima un esperimento');
    active=updateExperimentDocument(active,getSnapshot());
    let folderError=null;
    if(dir){
      try{
        if(!await permissionToWrite(dir,{allowPrompt:promptForWrite}))
          throw Error('Permesso scrittura cartella non concesso');
        active.storage.folder='LINKED';
        await saveExperimentFolder(dir,active);
      }catch(error){folderError=error;active.storage.folder='RECONNECT_REQUIRED';}
    }
    await saveLocalExperiment(active);
    dirty=false;reflect();
    await refresh();
    if(folderError)message('Snapshot salvato nel browser; NON scritto nella cartella: '+folderError.message,'warn');
    else if(dir)message('Esperimento salvato nel browser e nella cartella '+active.folder_name+'.','good');
    else message('Esperimento salvato SOLO in questo browser. Collega una cartella o esporta una copia JSON.','warn');
    return active;
  }
  async function load(doc,handle=null){
    active=parseExperimentDocument(doc);
    dir=handle;
    if(!dir) {
      try{dir=await getExperimentHandle(active.id);}catch{dir=null;}
    }
    active.storage.folder=dir?'LINKED':'RECONNECT_REQUIRED';
    await saveLocalExperiment(active);
    restoreSnapshot(active.snapshot);
    dirty=false;reflect();await refresh();
    message('Esperimento riaperto. I manifesti sono snapshot; i dati remoti non vengono ricreati automaticamente.'+(dir?' Cartella associata.':' Ricollega la cartella per usare i file raw.'),'good');
    openMission?.();
    return active;
  }
  q('createExperiment').addEventListener('click',async()=>{
    try{
      const name=q('experimentName').value.trim();
      active=createExperimentDocument({name,snapshot:getSnapshot()});
      dir=null;dirty=true;reflect();
      await save();
    }catch(error){message('Nuovo esperimento: '+error.message,'warn');}
  });
  q('saveExperiment').addEventListener('click',()=>save({promptForWrite:true}).catch(error=>message('Salvataggio: '+error.message,'warn')));
  q('openLocalExperiment').addEventListener('click',async()=>{
    try{
      if(!list.value)throw Error('Seleziona un esperimento dalla lista');
      const doc=await loadLocalExperiment(list.value);
      if(!doc)throw Error('Esperimento non trovato');
      await load(doc);
    }catch(error){message('Apertura: '+error.message,'warn');}
  });
  q('chooseExperimentFolder').addEventListener('click',async()=>{
    try{
      if(!active)throw Error('Crea prima un esperimento');
      if(!window.showDirectoryPicker)throw Error('Il browser non supporta la selezione di cartelle: usa esportazione JSON');
      const parent=await window.showDirectoryPicker({mode:'readwrite',id:'underwater-experiments'});
      if(!await permissionToWrite(parent,{allowPrompt:true}))throw Error('Accesso alla cartella negato');
      const target=await parent.getDirectoryHandle(active.folder_name,{create:true});
      dir=target;active.storage.folder='LINKED';
      await rememberExperimentHandle(active.id,dir);
      await save({promptForWrite:true});
    }catch(error){if(error?.name!=='AbortError')message('Cartella: '+error.message,'warn');}
  });
  q('openExperimentFolder').addEventListener('click',async()=>{
    try{
      if(!window.showDirectoryPicker)throw Error('Funzione non supportata: importa experiment.json');
      const chosen=await window.showDirectoryPicker({mode:'readwrite',id:'underwater-experiments'});
      const doc=await readExperimentFolder(chosen);
      await rememberExperimentHandle(doc.id,chosen);
      await load(doc,chosen);
    }catch(error){if(error?.name!=='AbortError')message('Apri cartella: '+error.message,'warn');}
  });
  q('importExperiment').addEventListener('change',async(event)=>{
    try{
      const file=event.target.files?.[0];
      if(!file)return;
      if(file.size>15*1024*1024)throw Error('Manifest troppo grande');
      const doc=parseExperimentDocument(JSON.parse(await file.text()));
      await load(doc,null);
    }catch(error){message('Importazione: '+error.message,'warn');}
    finally{event.target.value='';}
  });
  q('exportExperiment').addEventListener('click',()=>{
    if(!active)return;
    const doc=updateExperimentDocument(active,getSnapshot());
    downloadJson('experiment-'+doc.folder_name+'.json',doc);
    message('Manifest JSON esportato. File NetCDF/GeoTIFF NON inclusi: conservarli nella cartella esperimento.','warn');
  });
  q('attachExperimentFiles').addEventListener('change',async event=>{
    try{
      if(!active||!dir)throw Error('Collega prima una cartella esperimento');
      if(!await permissionToWrite(dir,{allowPrompt:true}))throw Error('Accesso cartella negato');
      const files=[...(event.target.files||[])];
      if(!files.length)return;
      for(const file of files)active=await attachFileToExperiment(dir,active,file);
      await save({promptForWrite:true});
      message(files.length+' file raw salvato/i nella cartella. Contenuti ancora DA VALIDARE.','good');
    }catch(error){message('Allegati: '+error.message,'warn');}
    finally{event.target.value='';}
  });
  const onSaveKey=event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&active){
      event.preventDefault();save().catch(error=>message(error.message,'warn'));
    }
  };
  document.addEventListener('keydown',onSaveKey);
  reflect();refresh();
  return {
    getActive:()=>active,
    markDirty(){
      if(!active)return;
      dirty=true;reflect();
    },
    isDirty:()=>dirty,
    save:()=>save(),
    destroy(){document.removeEventListener('keydown',onSaveKey);}
  };
}
