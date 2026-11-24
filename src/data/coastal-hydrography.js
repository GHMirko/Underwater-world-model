/**
 * Chart-object-aware hydrographic input. Neither an ENC nor a vector
 * contour service constitutes a measured numerical bathymetric grid.
 *
 * GDAL/OGR provides the S-57 -> GeoJSON conversion; this module interprets
 * published objects without silently inventing depths for areas or hazards.
 */
export const COASTAL_SCHEMA = 'coastal-hydrography/0.1';
const MAX_FEATURES = 50000;
const OBJECT_CLASSES = new Set(['SOUNDG','DEPCNT','DEPARE','DRGARE','M_QUAL','COALNE','WRECKS','OBSTRN','UNSARE']);

function validPosition(coords) {
  return Array.isArray(coords) && Number.isFinite(coords[0]) && Number.isFinite(coords[1]) &&
    coords[0] >= -180 && coords[0] <= 180 && coords[1] >= -90 && coords[1] <= 90;
}
function number(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function positiveDepth(value) {
  const n=number(value);
  return n != null && n >= 0 && n <= 12000 ? n : null;
}
function canonicalClass(feature,sourceId) {
  const p=feature.properties ?? {};
  if (sourceId === 'PUGLIA_BATIMETRIA_ARCGIS') return 'DEPCNT';
  const raw=[p._s57_layer,p.S57_LAYER,p.object_class,p.objclass,p.layer,p.OBJCLASS]
    .find(v=>typeof v==='string' && v.trim());
  return String(raw??'').toUpperCase().trim();
}
function cleanGeometry(geometry) {
  return geometry && typeof geometry.type==='string' && geometry.coordinates != null ? geometry : null;
}
function asLineCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type==='LineString') return [geometry.coordinates];
  if (geometry.type==='MultiLineString') return geometry.coordinates;
  return [];
}
function asPolygonCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type==='Polygon') return [geometry.coordinates];
  if (geometry.type==='MultiPolygon') return geometry.coordinates;
  return [];
}
function normalizeSourceFeature(feature,kind,sourceId,index) {
  const props=feature.properties??{};
  const geom=cleanGeometry(feature.geometry);
  if(!geom || !OBJECT_CLASSES.has(kind))return [];
  const common={
    chart_object:kind, source_id:sourceId, source_feature_id:String(feature.id??props.LNAM??props.OBJECTID??index),
    cartographic_source_not_survey_grid:true
  };
  if(kind==='SOUNDG'){
    const coords=geom.type==='Point'?[geom.coordinates]:
      geom.type==='MultiPoint'?geom.coordinates:[];
    return coords.flatMap((c,j)=>{
      if(!validPosition(c))return [];
      // GDAL SOUNDG Z is chart depth; SPLIT_MULTIPOINT may also add DEPTH.
      const depth=positiveDepth(number(c[2])??props.DEPTH);
      if(depth==null)return [];
      return [{type:'Feature',geometry:{type:'Point',coordinates:c.slice(0,2)},
        properties:{...common,depth_m:depth,evidence_type:'OBSERVED_CHART_SOUNDING',sounding_index:j}}];
    });
  }
  if(kind==='DEPCNT'){
    const depth=sourceId==='PUGLIA_BATIMETRIA_ARCGIS'
      ? positiveDepth(Math.abs(number(props.Z)??NaN)) : positiveDepth(props.VALDCO);
    if(depth==null)return [];
    return asLineCoordinates(geom).filter(line=>Array.isArray(line) && line.length>=2 &&
      line.every(validPosition)).map((line,j)=>({
      type:'Feature',geometry:{type:'LineString',coordinates:line.map(c=>c.slice(0,2))},
      properties:{...common,depth_m:depth,evidence_type:'GENERALIZED_DEPTH_CONTOUR',part:j}
    }));
  }
  if(['DEPARE','DRGARE'].includes(kind)){
    const polygons=asPolygonCoordinates(geom);
    const minimum=positiveDepth(props.DRVAL1),maximum=positiveDepth(props.DRVAL2);
    if(minimum==null && maximum==null)return [];
    return polygons.filter(poly=>Array.isArray(poly)&&poly.length&&poly[0].every(validPosition))
      .map((poly,j)=>({
        type:'Feature',geometry:{type:'Polygon',coordinates:poly},
        properties:{...common,min_depth_m:minimum,max_depth_m:maximum,
          evidence_type:'DEPTH_INTERVAL_CONSTRAINT_NOT_MEASUREMENT',part:j}
      }));
  }
  if(kind==='M_QUAL'){
    return asPolygonCoordinates(geom).filter(poly=>poly.length&&poly[0].every(validPosition))
      .map((poly,j)=>({
        type:'Feature',geometry:{type:'Polygon',coordinates:poly},
        properties:{...common,catzoc:props.CATZOC??null,quality_text:props.INFORM??null,
          evidence_type:'QUALITY_METADATA_NO_DEPTH',part:j}
      }));
  }
  // Coast, unsurveyed areas, obstructions, wrecks: retain for context/QA,
  // but do not treat VALSOU or a hazard height as a bathymetric DTM node.
  return [{type:'Feature',geometry:geom,properties:{
    ...common,evidence_type:'CONTEXT_OR_EXCLUSION_NO_NUMERIC_GRID_NODE',
    raw_hazard_depth:props.VALSOU??null
  }}];
}

export function normalizeCoastalHydrography(input,{
  sourceId='ENC_S57_USER_SUPPLIED',provider='Operator supplied ENC',
  sourceName='Imported coastal hydrography',verticalDatum='UNVERIFIED',
  licence='SOURCE_DEPENDENT',chartScale=null
}={}){
  if(!input || input.type!=='FeatureCollection' || !Array.isArray(input.features))
    throw Error('Richiesto FeatureCollection GeoJSON convertito da S-57 oppure servizio vettoriale');
  if(input.features.length>MAX_FEATURES)throw Error('Troppi oggetti: ritaglia una singola cella ENC/AOI (max 50000)');
  const features=[];
  const counts={SOUNDG:0,DEPCNT:0,DEPARE:0,DRGARE:0,M_QUAL:0,COALNE:0,WRECKS:0,OBSTRN:0,UNSARE:0};
  for(let i=0;i<input.features.length;i++){
    const kind=canonicalClass(input.features[i],sourceId);
    const group=normalizeSourceFeature(input.features[i],kind,sourceId,i);
    for(const item of group){features.push(item);counts[kind]++;}
  }
  const geometry={type:'FeatureCollection',features};
  const usable=counts.SOUNDG+counts.DEPCNT+counts.DEPARE+counts.DRGARE;
  if(!usable)throw Error('Nessuna feature SOUNDG/DEPCNT/DEPARE/DRGARE interpretabile: controllare classi e attributi');
  return {
    schema:COASTAL_SCHEMA,
    source:{id:sourceId,provider,name:sourceName,licence,
      chart_scale_denominator:Number.isFinite(chartScale)&&chartScale>0?chartScale:null,
      sounding_datum:String(verticalDatum||'UNVERIFIED'),
      datum_status:'UNVALIDATED',
      crs:'EPSG:4326', depth_semantics:'metres_positive_down',
      source_data_type:sourceId==='PUGLIA_BATIMETRIA_ARCGIS'?'PUBLISHED_REGIONAL_CONTOURS':'ENC_CHART_OBJECTS',
      retrieved_at_utc:new Date().toISOString()
    },
    counts,
    geometry,
    limitations:[
      'DEPCNT=generalized chart contour, not surveyed raster',
      'DEPARE/DRGARE=depth interval inequalities, not numeric soundings',
      'M_QUAL CATZOC is source quality metadata, not cell-wise measured uncertainty',
      'Vertical datum, edition, scale and survey age require external verification',
      'Chart reconstruction is NOT a navigation or Bellhop3D approved bathymetric grid'
    ]
  };
}
export function coastalEvidence(dataset){
  if(dataset?.schema!==COASTAL_SCHEMA)throw Error('Dataset coastal hydrography non valido');
  const out={soundings:[],contours:[],depthAreas:[],qualityAreas:[],excluded:[]};
  for(const feature of dataset.geometry.features){
    const kind=feature.properties.chart_object;
    if(kind==='SOUNDG')out.soundings.push(feature);
    else if(kind==='DEPCNT')out.contours.push(feature);
    else if(['DEPARE','DRGARE'].includes(kind))out.depthAreas.push(feature);
    else if(kind==='M_QUAL')out.qualityAreas.push(feature);
    else out.excluded.push(feature);
  }
  return out;
}
