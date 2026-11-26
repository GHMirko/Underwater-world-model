import { readGebcoGeoTiff, generateGebcoContours } from '../data/gebco-geotiff.js';
import { state, patchState, subscribeState } from '../state.js';
import { contourDisplayAssessment } from './contour-quality.js';

const SOURCE='gebco-numeric-isobaths-source';
const LAYER='gebco-numeric-isobaths-layer';
const EMPTY={type:'FeatureCollection',features:[]};
let fileBytes=null,fileName=null,gridBundle=null,contours=EMPTY,summary=null,generation=0;

function showStatus(text,good=false) {
  const box=document.querySelector('#gebcoNumericStatus');
  if(!box)return;
  box.textContent=text;
  box.className=good?'status good':'status warn';
}
function selected() {
  return state.bathyMode==='gebco-global'&&state.contours&&Boolean(state.aoi);
}
function display(map){
  if(!map.getLayer('background'))return;
  if(!map.getSource(SOURCE))map.addSource(SOURCE,{type:'geojson',data:contours});
  else map.getSource(SOURCE).setData(contours);
  if(!map.getLayer(LAYER)){
    map.addLayer({id:LAYER,type:'line',source:SOURCE,
      layout:{visibility:'none'},
      paint:{'line-color':['case',['==',['get','major'],true],'#ffe5a0','#f4bd55'],
        'line-width':['case',['==',['get','major'],true],2.7,1.5],
        'line-opacity':0.97}});
  }
  map.setLayoutProperty(LAYER,'visibility',selected()&&contours.features.length?'visible':'none');
  map.setFilter(LAYER,state.contourDensity==='major'?['==',['get','major'],true]:null);
}
function publishSummary(){
  patchState({gebcoContoursSummary:summary});
}
function recalc(map){
  if(!gridBundle){summary=null;contours=EMPTY;publishSummary();display(map);return;}
  const result=generateGebcoContours(gridBundle,state.contourCount);
  contours=result.geometry;summary=result.summary;
  publishSummary();display(map);
  const assessment=contourDisplayAssessment(summary);
  showStatus(`GEBCO NUMERICO · ${fileName} · ${summary.grid} celle · passo nativo ~${Math.round(gridBundle.native_resolution_m)} m · ${summary.requested_levels} richieste / ${summary.available_levels} disponibili · ${summary.feature_count} segmenti · datum non verificato`,
    assessment.displayable);
}
async function rebuild(map) {
  const mine=++generation;
  if(!fileBytes || !state.aoi){
    gridBundle=null;summary=null;contours=EMPTY;
    publishSummary();display(map);
    showStatus(!fileBytes?'GEBCO 2026: importare un subset GeoTIFF numerico per la AOI. Il WMS è solo un\'immagine, non può generare isobate.':'Definire AOI per usare il GeoTIFF GEBCO.');
    return;
  }
  showStatus('GEBCO: lettura dei dati numerici dell\'AOI dal GeoTIFF…');
  try{
    const parsed=await readGebcoGeoTiff(fileBytes,state.aoi);
    if(mine!==generation)return;
    gridBundle=parsed;
    recalc(map);
  }catch(error){
    if(mine!==generation)return;
    gridBundle=null;summary=null;contours=EMPTY;
    publishSummary();display(map);
    showStatus('GEBCO non rappresentabile: '+error.message);
  }
}
function waitForApp(){
  return new Promise(resolve=>{
    const tick=()=>window.__MSO__?.map?resolve(window.__MSO__):requestAnimationFrame(tick);
    tick();
  });
}
const app=await waitForApp(),map=app.map;
const input=document.querySelector('#gebcoGeotiffFile');
input?.addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>50*1024*1024)throw Error('File > 50 MB; selezionare un subset geografico');
    fileBytes=await file.arrayBuffer();fileName=file.name;
    document.querySelector('#bathyMode').value='gebco-global';
    patchState({bathyMode:'gebco-global'});
    await rebuild(map);
  }catch(error){showStatus('Import GEBCO: '+error.message);}
  finally{event.target.value='';}
});
window.__MSO__.getGebcoContours=()=>contours;
window.__MSO__.getGebcoContoursSummary=()=>summary;
window.__MSO__.getGebcoSourceMetadata=()=>fileName?{
  file_name:fileName,grid:summary?.grid??null,
  native_resolution_m:gridBundle?.native_resolution_m??null,
  numeric_grid_input_storage:'USER_FILE_NOT_INCLUDED_IN_EXPERIMENT_SNAPSHOT',
  datum_validated:false
}:null;
subscribeState((_,patch)=>{
  if(Object.prototype.hasOwnProperty.call(patch,'aoi'))rebuild(map);
  if(Object.prototype.hasOwnProperty.call(patch,'contourCount'))recalc(map);
  if(['bathyMode','contours','contourDensity'].some(key=>
    Object.prototype.hasOwnProperty.call(patch,key)))display(map);
});
map.on('style.load',()=>setTimeout(()=>display(map),0));
display(map);rebuild(map);
