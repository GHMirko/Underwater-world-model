/**
 * Bathymetric rendering has exactly one selected data authority.
 * AUTO: EMODnet numeric AOI plus independently labelled published WFS context.
 * WCS: EMODnet numeric AOI ONLY. WFS: published official isobaths ONLY.
 * GEBCO: real operator-imported GeoTIFF ONLY. ENC/Puglia: their own vectors.
 * Never paint a hidden WMS as if it were the active numerical model.
 */
import { state, subscribeState } from '../state.js';
import { regionalBathymetryRegion } from './bathymetry-context.js';
import { contourPresentationPolicy } from './contour-presentation-policy.js';
import { sourceSpec } from './bathymetry-source-policy.js';
import { selectContextContourLevels } from './contour-model.js';

function waitForApp(){
  return new Promise(resolve=>{
    const tick=()=>window.__MSO__?.contours&&window.__MSO__?.map
      ?resolve(window.__MSO__):requestAnimationFrame(tick);
    tick();
  });
}
const app=await waitForApp(),engine=app.contours,map=app.map;
let isContextActive=false;
function region(){
  const focus=state.aoi
    ?{lng:(state.aoi.minLon+state.aoi.maxLon)/2,lat:(state.aoi.minLat+state.aoi.maxLat)/2}
    :map.getCenter();
  return regionalBathymetryRegion(focus);
}
function getPolicy(){
  return contourPresentationPolicy({
    aoi:state.aoi,contours:state.contours,bathyMode:state.bathyMode,
    bathymetryGridSource:state.bathymetryGridSource,
    hasRegionalContext:Boolean(region()),summary:state.adaptiveContours,
    gebcoAvailable:Boolean(state.gebcoContoursSummary?.feature_count),
    coastalAvailable:Boolean(window.__MSO__?.coastalHydrography?.getDataset()?.geometry?.features?.length)
  });
}
function setStatus(message,kind='',mode='unavailable'){
  for(const id of ['contourStatus','mapContourStatus']){
    const node=document.querySelector('#'+id);
    if(!node)continue;
    node.textContent=message;
    if(id==='contourStatus')node.className='status'+(kind?' '+kind:'');
    else node.dataset.mode=mode;
  }
}
function setSourceStatus(policy){
  const node=document.querySelector('#selectedBathyDataStatus');
  if(!node)return;
  const detail=sourceSpec(state.bathyMode);
  const local=state.adaptiveContours,gebco=state.gebcoContoursSummary;
  let text=detail.description+' · ';
  if(!state.contours||state.bathyMode==='none')text+='visualizzazione disattivata';
  else if(policy.mode==='published-only'){
    if(engine.raw?.features?.length){
      const selection=selectContextContourLevels(engine.raw,state.contourCount);
      text+=`${state.contourCount} livelli richiesti / ${selection.metadata.displayed_levels_m.length} pubblicati visibili nella vista · sorgente EMODnet WFS (NON AOI)`;
    }else text+='WFS vettoriale non ancora disponibile; WMS contorni di riferimento (numero non controllabile)';
  }else if(['aoi-provisional','aoi-validated'].includes(policy.mode)){
    text+=`${state.contourCount} livelli richiesti / ${local?.available_levels??local?.levels_m?.length??0} ottenuti · ${local?.feature_count??0} segmenti · ${state.bathymetryGridSource??'EMODNET_REST'}`;
  }else if(policy.mode==='gebco-imported'){
    text+=`${state.contourCount} richiesti / ${gebco?.available_levels??0} ottenuti · GEBCO GeoTIFF importato (datum da validare)`;
  }else if(policy.mode==='gebco-await'){
    text+='DATI MANCANTI: importare il subset numerico GeoTIFF GEBCO 2026';
  }else if(policy.mode==='coastal-imported'){
    const d=app.coastalHydrography?.getDataset?.(),m=app.coastalHydrography?.getModel?.();
    text+=`${d?.counts?.DEPCNT??0} isobate pubblicate, ${d?.counts?.SOUNDG??0} scandagli · ${m?'modello ricostruito NON VALIDATO':'ricostruzione disponibile nel pannello Dati'}`;
  }else if(policy.mode==='coastal-await'){
    text+='DATI MANCANTI: importare ENC / acquisire Puglia in Dati';
  }else if(policy.mode==='aoi-numeric-unavailable'){
    text+='WCS numerico non disponibile o senza isobate valide; nessun fallback da diversa sorgente';
  }else if(policy.mode==='aoi-context-fallback'){
    text+='DTM AOI in acquisizione/non idoneo; contesto pubblicato EMODnet distinto dal dato numerico';
  }else if(policy.mode==='context')text+='EMODnet WFS di contesto; disegnare AOI per il DTM numerico';
  else if(policy.mode==='legacy-disabled')text+='modalità legacy senza sorgente dati attiva';
  else text+='nessuna batimetria disponibile per la scelta corrente';
  node.textContent=text;
  node.className=['gebco-await','coastal-await','aoi-numeric-unavailable','aoi-context-fallback','unavailable'].includes(policy.mode)
    ?'status warn':'status';
}
function setContextMode(enabled){
  if(!enabled){
    isContextActive=false;
    if(engine.visible)engine.setVisible(false);
    return;
  }
  engine.setContextOnly(true,state.contourCount);
  if(engine.bathymetryMode!=='emodnet-multicolour')
    engine.setBathymetryMode('emodnet-multicolour');
  if(engine.density!==state.contourDensity)engine.setDensity(state.contourDensity);
  isContextActive=true;
  if(!engine.visible)engine.setVisible(true);
  else engine.setContextCount(state.contourCount);
}
function applyPolicy(){
  const policy=getPolicy();
  setContextMode(policy.contextVisible);
  setSourceStatus(policy);
  switch(policy.mode){
    case 'off':setStatus('Isobate disattivate','','unavailable');break;
    case 'published-only':setStatus('EMODnet WFS · isobate pubblicate (fonte attiva). '+state.contourCount+' livelli richiesti: sono mostrati solo livelli realmente disponibili.','',
      'context');break;
    case 'context':setStatus('AUTO · CONTESTO EMODnet WFS · selezionare AOI per il DTM numerico','',
      'context');break;
    case 'aoi-context-fallback':setStatus('AUTO · DTM numerico AOI in acquisizione/insufficiente: curve EMODnet WFS di contesto mantenute, NON numeriche AOI','warn','context-with-aoi');break;
    case 'aoi-provisional':setStatus('AOI · DTM numerico EMODnet · '+state.contourCount+' richieste / '+(state.adaptiveContours?.available_levels??0)+' disponibili · PROVVISORIE · QA insufficiente','warn','aoi-provisional');break;
    case 'aoi-validated':setStatus('AOI · DTM numerico EMODnet · '+state.contourCount+' richieste / '+(state.adaptiveContours?.available_levels??0)+' disponibili · controllo qualità superato','good','aoi-validated');break;
    case 'gebco-await':setStatus('GEBCO 2026 selezionato · importare subset GeoTIFF numerico per mostrare isobate, nessun dato EMODnet sostitutivo','warn','unavailable');break;
    case 'gebco-imported':setStatus('GEBCO 2026 · '+state.contourCount+' richieste / '+(state.gebcoContoursSummary?.available_levels??0)+' isobate disponibili · dato importato, datum da verificare','good','aoi-provisional');break;
    case 'coastal-await':setStatus('ENC/Puglia selezionata · acquisire oggetti idrografici dal pannello Dati','warn','unavailable');break;
    case 'coastal-imported':setStatus('ENC/Puglia · vincoli idrografici effettivamente importati (viola) e modello provvisorio se ricostruito (ocra)','good','aoi-provisional');break;
    case 'aoi-numeric-unavailable':setStatus('EMODnet WCS selezionato · nessuna curva numerica: WCS ancora in acquisizione, non disponibile o AOI sottorisolta','warn','aoi-unavailable');break;
    case 'legacy-disabled':setStatus('Stile precedente non numerico disattivato. Selezionare una sorgente di dati.','warn','unavailable');break;
    default:setStatus('Sorgente batimetrica non disponibile nella vista corrente','warn','unavailable');
  }
}
const underlying=engine.onStatus;
engine.onStatus=message=>{
  if(!isContextActive||!state.contours)return;
  if(!state.aoi||state.bathyMode==='emodnet-rainbow'){
    underlying(message);
    const overlay=document.querySelector('#mapContourStatus');
    if(overlay){overlay.textContent=message;overlay.dataset.mode='context';}
  }
  setSourceStatus(getPolicy());
};
subscribeState((_,patch)=>{
  if(['aoi','adaptiveContours','bathymetryGridSource','bathyMode',
      'contours','contourDensity','contourCount','gebcoContoursSummary',
      'coastalSourceRevision'].some(key=>Object.prototype.hasOwnProperty.call(patch,key)))
    queueMicrotask(applyPolicy);
});
map.on('style.load',applyPolicy);
map.on('moveend',()=>{if(!state.aoi)applyPolicy();});
applyPolicy();
window.__MSO__.getContourPresentationPolicy=getPolicy;
