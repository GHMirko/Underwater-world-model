/**
 * Regione Puglia public MapServer 0: line features, negative Z elevations
 * (e.g. -5, -10, -25 m). ArcGIS REST JSON, spatial ref requested WGS84.
 * Public service availability/CORS/licensing are not under our control.
 */
export const PUGLIA_BATHY_URL='https://webapps.sit.puglia.it/arcgis/rest/services/ServicesArcIMS/batimetria/MapServer/0/query';
export const PUGLIA_APPROX_BOUNDS={minLon:14.4,maxLon:19.3,minLat:39.2,maxLat:42.5};
function intersects(a,b){
  return a.minLon<b.maxLon&&a.maxLon>b.minLon&&a.minLat<b.maxLat&&a.maxLat>b.minLat;
}
function validateAoi(aoi){
  if(!aoi||!['minLon','minLat','maxLon','maxLat'].every(k=>Number.isFinite(aoi[k])) ||
    aoi.minLon>=aoi.maxLon||aoi.minLat>=aoi.maxLat)throw Error('Definire AOI valida');
  if(!intersects(aoi,PUGLIA_APPROX_BOUNDS))
    throw Error('AOI esterna alla fascia indicativa della Puglia: sorgente non applicabile');
}
export function pugliaRequestUrl(aoi,{objectIds=null,endpoint=PUGLIA_BATHY_URL}={}){
  validateAoi(aoi);
  const url=new URL(endpoint);
  url.searchParams.set('f','json');
  url.searchParams.set('where','1=1');
  url.searchParams.set('geometry',[aoi.minLon,aoi.minLat,aoi.maxLon,aoi.maxLat].join(','));
  url.searchParams.set('geometryType','esriGeometryEnvelope');
  url.searchParams.set('inSR','4326');
  url.searchParams.set('outSR','4326');
  url.searchParams.set('spatialRel','esriSpatialRelIntersects');
  if(objectIds==null){
    url.searchParams.set('returnIdsOnly','true');
    url.searchParams.set('returnGeometry','false');
  }else{
    url.searchParams.set('objectIds',objectIds.join(','));
    url.searchParams.set('outFields','*');
    url.searchParams.set('returnGeometry','true');
  }
  return url.toString();
}
export function parsePugliaArcgisFeatures(payload){
  if(payload?.error)throw Error('ArcGIS: '+(payload.error.message??'query error'));
  const output=[];
  for(const item of payload?.features??[]){
    const p=item.attributes??{},depth=Number(p.Z);
    if(!Number.isFinite(depth))continue;
    for(const path of item.geometry?.paths??[]){
      if(!Array.isArray(path)||path.length<2||!path.every(pt=>Array.isArray(pt)&&
        Number.isFinite(pt[0])&&Number.isFinite(pt[1])&&Math.abs(pt[0])<=180&&Math.abs(pt[1])<=90))continue;
      output.push({type:'Feature',properties:{...p,_s57_layer:'DEPCNT',
        _raw_puglia_elevation_m:depth,
        _source_id:'PUGLIA_BATIMETRIA_ARCGIS'},
        geometry:{type:'LineString',coordinates:path.map(pt=>pt.slice(0,2))}});
    }
  }
  return {type:'FeatureCollection',features:output};
}
export async function fetchPugliaContours(aoi,{fetchImpl=fetch,signal,endpoint=PUGLIA_BATHY_URL,maxFeatures=2000}={}){
  validateAoi(aoi);
  const request=async (url)=>{
    let response;
    try{response=await fetchImpl(url,{method:'GET',signal,credentials:'omit',mode:'cors'});}
    catch(error){throw Error('Connessione/CORS del servizio Puglia non disponibile: '+error.message);}
    if(!response.ok)throw Error('Servizio Puglia HTTP '+response.status);
    const json=await response.json();
    if(json?.error)throw Error('Servizio Puglia: '+json.error.message);
    return json;
  };
  const lookup=await request(pugliaRequestUrl(aoi,{endpoint}));
  if(!Array.isArray(lookup.objectIds)){
    throw Error('Il servizio non restituisce gli ID degli oggetti: esportazione diretta non disponibile');
  }
  const ids=[...new Set(lookup.objectIds)];
  if(ids.length>maxFeatures)throw Error(`Troppe isobate (${ids.length}); ridurre l'AOI (max ${maxFeatures})`);
  const features=[];
  for(let start=0;start<ids.length;start+=150){
    const chunk=ids.slice(start,start+150);
    const payload=await request(pugliaRequestUrl(aoi,{objectIds:chunk,endpoint}));
    features.push(...parsePugliaArcgisFeatures(payload).features);
  }
  return {type:'FeatureCollection',features,metadata:{
    source:'Regione Puglia BATIMETRIA MapServer 0',
    source_url:endpoint,coordinate_system:'EPSG:4326',
    limitation:'Direct public ArcGIS REST, not official S-57 ENC. Datum and licence to verify.',
    object_count:ids.length
  }};
}
