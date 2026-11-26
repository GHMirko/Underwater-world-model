import { normalizeCoastalHydrography, coastalEvidence } from '../data/coastal-hydrography.js';
import { reconstructCoastalSeafloor, coastalModelCsv } from '../data/chart-constrained-surface.js';
import { fetchPugliaContours } from '../data/puglia-coastal-source.js';
import { buildAdaptiveContours, chooseContourScheme } from '../map/local-contours.js';
import { downloadJson, downloadText } from '../data/download.js';
import { state, patchState, subscribeState } from '../state.js';

const IDS={
  input:'coastal-import-source', inputLines:'coastal-import-lines',
  inputSoundings:'coastal-import-soundings',
  derived:'coastal-derived-source',derivedLines:'coastal-derived-lines'
};
const EMPTY={type:'FeatureCollection',features:[]};

function mapLayer(map,id,type,source,paint) {
  if (!map.getLayer(id))map.addLayer({id,type,source,paint});
}
function statusText(node,text,kind=''){
  node.textContent=text;node.className='status'+(kind?' '+kind:'');
}
export function attachCoastalHydrography({
  root,map,onChange=()=>{},fetchImpl=fetch
}){
  const q=id=>root.querySelector('#'+id);
  let dataset=null,model=null,derivedContours=EMPTY;
  const sourceStatus=q('coastalSourceStatus'),modelStatus=q('coastalModelStatus');
  const toggleButtons=()=>{
    q('coastalBuildModel').disabled=!dataset||!state.aoi;
    q('coastalDownloadSource').disabled=!dataset;
    q('coastalDownloadModel').disabled=!model;
    q('coastalDownloadXyz').disabled=!model||model.coverage_ratio<=0;
  };
  const displayData=()=>{
    if(!dataset){
      statusText(sourceStatus,'Nessuna carta importata. S-57 richiede conversione locale con GDAL; per Taranto è disponibile la sorgente Puglia.','warn');
      return;
    }
    const c=dataset.counts;
    statusText(sourceStatus,`${dataset.source.name} · SOUNDG ${c.SOUNDG} · DEPCNT ${c.DEPCNT} · DEPARE/DRGARE ${c.DEPARE+c.DRGARE} · M_QUAL ${c.M_QUAL} · datum ${dataset.source.sounding_datum} (NON verificato)`,'good');
  };
  const displayModel=()=>{
    if(!model) {
      statusText(modelStatus,dataset
        ?(state.aoi?'Carta caricata. Generare modello PROVVISORIO da vincoli idrografici.':'Selezionare un\'AOI per la ricostruzione.')
        :'Nessun modello numerico cartografico. Bellhop3D non alimentato.','warn');
      return;
    }
    const g=model.grid,ev=model.evidence;
    statusText(modelStatus,`Griglia derivata ${g.nx}×${g.ny}, passo COMPUTAZIONALE ${g.nominal_step_m} m · copertura ${(model.coverage_ratio*100).toFixed(1)}% · ${ev.soundings} scandagli, ${ev.contours} curve · Bellhop3D: BLOCCATO, datum/QA non validati`,model.coverage_ratio?'warn':'warn');
  };
  function updateMap(){
    if(!map.getLayer('background'))return;
    const inputFeatures=dataset?.geometry?.features.filter(f=>
      f.properties.chart_object==='DEPCNT'||f.properties.chart_object==='SOUNDG')??[];
    const inputCollection={type:'FeatureCollection',features:inputFeatures};
    if(!map.getSource(IDS.input))map.addSource(IDS.input,{type:'geojson',data:inputCollection});
    else map.getSource(IDS.input).setData(inputCollection);
    mapLayer(map,IDS.inputLines,'line',IDS.input,{
      'line-color':'#8b6cbe','line-width':1.75,'line-opacity':0.9,'line-dasharray':[2,1]
    });
    mapLayer(map,IDS.inputSoundings,'circle',IDS.input,{
      'circle-color':'#f1d7a7','circle-radius':3,'circle-stroke-width':1,'circle-stroke-color':'#4d355e'
    });
    map.setFilter(IDS.inputLines,['==',['get','chart_object'],'DEPCNT']);
    map.setFilter(IDS.inputSoundings,['==',['get','chart_object'],'SOUNDG']);
    if(!map.getSource(IDS.derived))map.addSource(IDS.derived,{type:'geojson',data:derivedContours});
    else map.getSource(IDS.derived).setData(derivedContours);
    mapLayer(map,IDS.derivedLines,'line',IDS.derived,{
      'line-color':'#d79533','line-width':2.2,'line-opacity':0.92,'line-dasharray':[5,2]
    });
    const visible=state.contours && state.bathyMode==='coastal-charts' ? 'visible':'none';
    for(const id of [IDS.inputLines,IDS.inputSoundings,IDS.derivedLines]){
      if(map.getLayer(id))map.setLayoutProperty(id,'visibility',visible);
    }
  }
  const invalidateModel=()=>{
    if(!model)return;
    model=null;derivedContours=EMPTY;
    updateMap();displayModel();toggleButtons();onChange();
  };
  function rebuildDerivedPreview(){
    if(!model||model.min_depth_m==null||model.max_depth_m==null||
      model.min_depth_m===model.max_depth_m){
      derivedContours=EMPTY;return;
    }
    const scheme=chooseContourScheme(model.min_depth_m,model.max_depth_m,state.contourCount);
    const samples=model.cells.filter(c=>c.depth_m!=null).map(c=>({
      ix:c.ix,iy:c.iy,lon:c.lon,lat:c.lat,depth:c.depth_m
    }));
    derivedContours=buildAdaptiveContours({
      samples,nx:model.grid.nx,ny:model.grid.ny,scheme,
      metadata:{source:'CHART_CONSTRAINED_INTERPOLATION_UNVALIDATED',
        confidence:'UNVALIDATED',predictor_eligible:false}
    });
  }
  function commitDataset(next){
    dataset=next;model=null;derivedContours=EMPTY;
    patchState({bathyMode:'coastal-charts'});
    const picker=q('bathyMode');
    if(picker)picker.value='coastal-charts';
    displayData();displayModel();toggleButtons();updateMap();onChange();
  }
  q('coastalImportFile').addEventListener('change',async event=>{
    try{
      const file=event.target.files?.[0];if(!file)return;
      if(file.size>30*1024*1024)throw Error('GeoJSON >30 MB: ritaglia la cella S-57 con --bbox');
      const geojson=JSON.parse(await file.text());
      commitDataset(normalizeCoastalHydrography(geojson,{
        sourceId:'ENC_S57_USER_SUPPLIED',
        sourceName:geojson.metadata?.source_file??file.name,
        provider:'S-57 converted locally by GDAL',
        verticalDatum:q('coastalDatum').value.trim()||'UNVERIFIED',
        licence:'VERIFY_PROVIDER_TERMS'
      }));
    }catch(error){statusText(sourceStatus,'Importazione ENC: '+error.message,'warn');}
    finally{event.target.value='';}
  });
  q('coastalFetchPuglia').addEventListener('click',async()=>{
    const button=q('coastalFetchPuglia');
    if(!state.aoi){statusText(sourceStatus,'Definire prima un\'AOI in Puglia.','warn');return;}
    button.disabled=true;statusText(sourceStatus,'Interrogazione isobate Puglia via ArcGIS REST…');
    try{
      const geojson=await fetchPugliaContours(state.aoi,{fetchImpl});
      if(!geojson.features.length)throw Error('Nessuna isobata pubblicata per l\'AOI');
      commitDataset(normalizeCoastalHydrography(geojson,{
        sourceId:'PUGLIA_BATIMETRIA_ARCGIS',provider:'Regione Puglia - SIT',
        sourceName:'BATIMETRIA / MapServer 0 · AOI',
        verticalDatum:'UNVERIFIED',licence:'CHECK_REGIONE_PUGLIA_TERMS'
      }));
    }catch(error){statusText(sourceStatus,'Isobate Puglia non acquisite: '+error.message,'warn');}
    finally{button.disabled=false;}
  });
  q('coastalBuildModel').addEventListener('click',()=>{
    try{
      if(!dataset||!state.aoi)throw Error('Importare un dato e selezionare AOI');
      model=reconstructCoastalSeafloor({
        aoi:state.aoi,dataset,
        targetGridM:Number(q('coastalGridM').value),
        maxSupportDistanceM:Number(q('coastalRadiusM').value)
      });
      rebuildDerivedPreview();updateMap();toggleButtons();displayModel();onChange();
    }catch(error){statusText(modelStatus,'Ricostruzione: '+error.message,'warn');}
  });
  q('coastalDownloadSource').addEventListener('click',()=>{
    if(dataset)downloadJson('coastal-hydrography-normalized.geojson',{
      ...dataset.geometry,metadata:{...dataset.source,schema:dataset.schema,counts:dataset.counts}
    });
  });
  q('coastalDownloadModel').addEventListener('click',()=>{
    if(model)downloadJson('coastal-chart-reconstruction.json',model);
  });
  q('coastalDownloadXyz').addEventListener('click',()=>{
    if(model)downloadText('coastal-chart-reconstruction-UNVALIDATED.csv',
      coastalModelCsv(model),'text/csv;charset=utf-8');
  });
  map.on('style.load',updateMap);
  subscribeState((_,patch)=>{
    if(Object.prototype.hasOwnProperty.call(patch,'aoi'))invalidateModel();
    if(Object.prototype.hasOwnProperty.call(patch,'contourCount')){
      rebuildDerivedPreview();updateMap();
    }
    if(Object.prototype.hasOwnProperty.call(patch,'aoi')){displayModel();toggleButtons();}
    if(Object.prototype.hasOwnProperty.call(patch,'bathyMode') ||
       Object.prototype.hasOwnProperty.call(patch,'contours'))updateMap();
  });
  displayData();displayModel();toggleButtons();
  if(map.isStyleLoaded?.())updateMap();
  return {
    getDataset:()=>dataset,getModel:()=>model,
    snapshot:()=>({
      coastal_hydrography:dataset,coastal_model:model,
      coastal_controls:{grid_m:Number(q('coastalGridM').value),
        support_radius_m:Number(q('coastalRadiusM').value),
        datum_label:q('coastalDatum').value}
    }),
    restore(snapshot){
      dataset=snapshot?.coastal_hydrography??null;
      const candidate=snapshot?.coastal_model??null;
      const matches=Boolean(candidate?.aoi && state.aoi &&
        ['minLon','minLat','maxLon','maxLat'].every(k=>candidate.aoi[k]===state.aoi[k]));
      model=matches?candidate:null;
      const controls=snapshot?.coastal_controls??{};
      if(Number.isFinite(controls.grid_m))q('coastalGridM').value=controls.grid_m;
      if(Number.isFinite(controls.support_radius_m))q('coastalRadiusM').value=controls.support_radius_m;
      q('coastalDatum').value=controls.datum_label??'UNVERIFIED';
      rebuildDerivedPreview();updateMap();displayData();displayModel();toggleButtons();
    }
  };
}
