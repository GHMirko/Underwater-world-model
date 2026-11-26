/**
 * Bathymetry selection is a DATA AUTHORITY, not a cosmetic WMS theme.
 * Historic option IDs are retained for experiment compatibility.
 */
export const BATHY_SOURCE_MODES=Object.freeze({
  'aoi-adaptive':Object.freeze({authority:'EMODNET_BEST_NUMERIC',allowsWcs:true,allowsRest:true,allowsPublishedContext:true,description:'AUTO · DTM EMODnet numerico; contesto pubblicato separato'}),
  'emodnet-multicolour':Object.freeze({authority:'EMODNET_WCS',allowsWcs:true,allowsRest:false,allowsPublishedContext:false,description:'EMODnet DTM · griglia numerica WCS'}),
  'emodnet-rainbow':Object.freeze({authority:'EMODNET_WFS',allowsWcs:false,allowsRest:false,allowsPublishedContext:true,description:'EMODnet · isobate pubblicate WFS (livelli nativi)'}),
  'gebco-global':Object.freeze({authority:'GEBCO_IMPORTED_GRID',allowsWcs:false,allowsRest:false,allowsPublishedContext:false,description:'GEBCO 2026 · GeoTIFF numerico importato'}),
  'coastal-charts':Object.freeze({authority:'COASTAL_CHARTS',allowsWcs:false,allowsRest:false,allowsPublishedContext:false,description:'ENC / Puglia · oggetti idrografici importati'}),
  'chart-relief':Object.freeze({authority:'UNSUPPORTED_LEGACY_VIEW',allowsWcs:false,allowsRest:false,allowsPublishedContext:false,description:'Chart Relief legacy (nessuna griglia utilizzabile)'}),
  'none':Object.freeze({authority:'NONE',allowsWcs:false,allowsRest:false,allowsPublishedContext:false,description:'Nessuna batimetria'})
});
export function sourceSpec(mode){return BATHY_SOURCE_MODES[mode]??BATHY_SOURCE_MODES.none;}
export function numericEmodnetVisible(mode,gridSource){
  const source=sourceSpec(mode);
  return source.allowsWcs || (source.allowsRest && gridSource!=='EMODNET_WCS');
}
export function localContoursMatchSource(mode,gridSource){
  if(mode==='aoi-adaptive')return gridSource==='EMODNET_WCS'||gridSource==null||gridSource==='EMODNET_REST';
  if(mode==='emodnet-multicolour')return gridSource==='EMODNET_WCS';
  return false;
}
export function publishedContextAllowed(mode,regionAvailable){
  return Boolean(regionAvailable)&&sourceSpec(mode).allowsPublishedContext;
}
