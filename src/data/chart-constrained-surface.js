/**
 * Conservative chart-constrained prototype bathymetry.
 *
 * SOUNDG: true depth observations (within chart generalization/age limits).
 * DEPCNT: equal-depth isoline constraints, spatially sampled along geometry.
 * DEPARE / DRGARE: inequalities / water-domain mask, NEVER depth observations.
 * M_QUAL: provenance only; CATZOC is not converted to a made-up RMS accuracy.
 *
 * An inverse-distance weighted surface is possible where distinct depth
 * evidence spatially brackets a cell. No extrapolation outside the evidence
 * convex hull or beyond the declared support radius.
 * This is NOT automatically an analysis-ready Bellhop3D bottom model.
 */
import { coastalEvidence, COASTAL_SCHEMA } from './coastal-hydrography.js';

const EARTH_LON_M=111320;
const EARTH_LAT_M=110540;
const MAX_CELLS=20000, MAX_EVIDENCE=14000;

function project(lon,lat,origin){
  return {x:(lon-origin.lon)*EARTH_LON_M*Math.cos(origin.lat*Math.PI/180),
    y:(lat-origin.lat)*EARTH_LAT_M};
}
function pointInRing(lon,lat,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if(((a[1]>lat)!==(b[1]>lat)) &&
       lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function inPolygon(lon,lat,polygon) {
  const rings=polygon?.geometry?.coordinates;
  return Boolean(rings?.length && pointInRing(lon,lat,rings[0]) &&
    !rings.slice(1).some(ring=>pointInRing(lon,lat,ring)));
}
function convexHull(points) {
  const uniq=[...new Map(points.map(p=>[p.x.toFixed(3)+','+p.y.toFixed(3),p])).values()]
    .sort((a,b)=>a.x-b.x||a.y-b.y);
  if(uniq.length<3)return [];
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const bottom=[],top=[];
  for(const p of uniq){while(bottom.length>=2&&cross(bottom.at(-2),bottom.at(-1),p)<=0)bottom.pop();bottom.push(p);}
  for(const p of [...uniq].reverse()){while(top.length>=2&&cross(top.at(-2),top.at(-1),p)<=0)top.pop();top.push(p);}
  return bottom.slice(0,-1).concat(top.slice(0,-1));
}
function inHull(x,y,hull) {
  if(hull.length<3)return false;
  for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length];
    if((b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x)<-0.01)return false;
  }
  return true;
}
function buildPointEvidence(input,origin,gridM,limits){
  const observations=[];
  const accept=(lon,lat,depth,kind,sourceFeatureId)=>{
    if(observations.length>=MAX_EVIDENCE)return;
    const p=project(lon,lat,origin);
    if(p.x<limits.minX||p.x>limits.maxX||p.y<limits.minY||p.y>limits.maxY)return;
    observations.push({...p,lon,lat,depth_m:depth,kind,source_feature_id:sourceFeatureId});
  };
  for(const feature of input.soundings){
    const coords=feature.geometry.coordinates;
    accept(coords[0],coords[1],feature.properties.depth_m,'SOUNDG',feature.properties.source_feature_id);
  }
  const spacing=Math.max(gridM*1.5,20);
  for(const feature of input.contours){
    const line=feature.geometry.coordinates,depth=feature.properties.depth_m;
    let count=0;
    for(let i=1;i<line.length&&observations.length<MAX_EVIDENCE&&count<1200;i++){
      const a=line[i-1],b=line[i],p=project(a[0],a[1],origin),q=project(b[0],b[1],origin);
      const steps=Math.max(1,Math.ceil(Math.hypot(q.x-p.x,q.y-p.y)/spacing));
      for(let j=0;j<steps&&observations.length<MAX_EVIDENCE&&count<1200;j++){
        const t=j/steps;
        accept(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,depth,'DEPCNT',feature.properties.source_feature_id);
        count++;
      }
    }
    if(line.length && count<1200){
      const end=line.at(-1);
      accept(end[0],end[1],depth,'DEPCNT',feature.properties.source_feature_id);
    }
  }
  return observations;
}
function validAoi(aoi){
  return aoi && ['minLon','maxLon','minLat','maxLat'].every(k=>Number.isFinite(aoi[k])) &&
    aoi.minLon>=-180&&aoi.maxLon<=180&&aoi.minLat>=-90&&aoi.maxLat<=90 &&
    aoi.minLon<aoi.maxLon&&aoi.minLat<aoi.maxLat;
}
function localConstraints(features,lon,lat){
  return features.filter(f=>inPolygon(lon,lat,f));
}
function consistentDepth(depth,areas){
  for(const f of areas){
    const min=f.properties.min_depth_m,max=f.properties.max_depth_m;
    if(min!=null && depth<min-0.001)return false;
    if(max!=null && depth>max+0.001)return false;
  }
  return true;
}

export function reconstructCoastalSeafloor({
  aoi,dataset,targetGridM=50,maxSupportDistanceM=400
}){
  if(!validAoi(aoi))throw Error('Selezionare una AOI valida prima della ricostruzione');
  if(dataset?.schema!==COASTAL_SCHEMA)throw Error('Importare una sorgente costiera normalizzata');
  const gridM=Number(targetGridM),radius=Number(maxSupportDistanceM);
  if(!Number.isFinite(gridM)||gridM<5||gridM>1000)throw Error('Griglia: 5–1000 m');
  if(!Number.isFinite(radius)||radius<gridM||radius>5000)throw Error('Raggio vincoli: tra passo griglia e 5000 m');
  const midLat=(aoi.minLat+aoi.maxLat)/2,origin={lon:aoi.minLon,lat:midLat};
  const width=(aoi.maxLon-aoi.minLon)*EARTH_LON_M*Math.cos(midLat*Math.PI/180),
    height=(aoi.maxLat-aoi.minLat)*EARTH_LAT_M;
  const nx=Math.max(1,Math.ceil(width/gridM)),ny=Math.max(1,Math.ceil(height/gridM));
  if(nx*ny>MAX_CELLS)throw Error('AOI/griglia troppo estesa: massimo '+MAX_CELLS+' celle; aumentare il passo');
  const groups=coastalEvidence(dataset);
  const observations=buildPointEvidence(groups,origin,gridM,
    {minX:-radius,minY:-radius,maxX:width+radius,maxY:height+radius});
  const depthLevels=new Set(observations.map(s=>s.depth_m.toFixed(3)));
  const hasEnoughDepthEvidence=observations.length>=3 && depthLevels.size>=2;
  const hull=convexHull(observations);
  const bucketSize=radius;
  const buckets=new Map(),key=(x,y)=>Math.floor(x/bucketSize)+','+Math.floor(y/bucketSize);
  for(const p of observations){const k=key(p.x,p.y);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}
  const cells=[],summary={populated:0,depth_area_conflicts:0,outside_support:0,no_water_mask:0};
  const midZone=[];
  for(let iy=0;iy<ny;iy++)for(let ix=0;ix<nx;ix++){
    const lon=aoi.minLon+(ix+0.5)*(aoi.maxLon-aoi.minLon)/nx,
      lat=aoi.minLat+(iy+0.5)*(aoi.maxLat-aoi.minLat)/ny,
      pos=project(lon,lat,origin);
    const areaMatches=localConstraints(groups.depthAreas,lon,lat);
    const qualityMatches=localConstraints(groups.qualityAreas,lon,lat);
    const catzoc=[...new Set(qualityMatches.map(f=>f.properties.catzoc).filter(x=>x!=null))];
    let depth=null,nearest=null,contributors=[],reason='INSUFFICIENT_CHART_EVIDENCE';
    // When ENC depth area coverage is known, never fill outside it.
    const waterDomainSupported=!groups.depthAreas.length||areaMatches.length>0;
    const spatialSupport=inHull(pos.x,pos.y,hull);
    if(!waterDomainSupported)reason='OUTSIDE_ENC_DEPTH_AREA';
    else if(!hasEnoughDepthEvidence)reason='INSUFFICIENT_DISTINCT_DEPTH_LEVELS';
    else if(!spatialSupport){reason='OUTSIDE_EVIDENCE_CONVEX_HULL';summary.outside_support++;}
    else {
      const xBin=Math.floor(pos.x/bucketSize),yBin=Math.floor(pos.y/bucketSize);
      const matches=[];
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
        for(const p of (buckets.get((xBin+dx)+','+(yBin+dy))??[])){
          const d=Math.hypot(p.x-pos.x,p.y-pos.y);
          if(d<=radius)matches.push({...p,distance_m:d});
        }
      }
      matches.sort((a,b)=>a.distance_m-b.distance_m);
      const local=matches.slice(0,12);
      if(local.length<3||new Set(local.map(p=>p.depth_m.toFixed(3))).size<2)
        reason='INSUFFICIENT_LOCAL_DEPTH_GRADIENT';
      else{
        // IDW interpolation with a strongly weighted nearby chart contour.
        let weighted=0,sum=0;
        for(const p of local){
          const w=1/Math.pow(Math.max(p.distance_m,Math.max(0.25,gridM*0.05)),2);
          weighted+=p.depth_m*w;sum+=w;
        }
        const estimated=weighted/sum;
        nearest=local[0].distance_m;
        contributors=[...new Set(local.map(p=>p.kind))];
        if(consistentDepth(estimated,areaMatches)){
          depth=Number(estimated.toFixed(4));reason='CHART_CONSTRAINED_IDW';
          summary.populated++;
          if(!areaMatches.length)summary.no_water_mask++;
        }else{reason='CONFLICT_WITH_DEPARE_INTERVAL';summary.depth_area_conflicts++;}
      }
    }
    cells.push({
      ix,iy,lon,lat,depth_m:depth,reason,
      nearest_evidence_m:nearest,contributing_object_classes:contributors,
      catzoc,depth_area_bounds_m:areaMatches.map(f=>({
        min:f.properties.min_depth_m,max:f.properties.max_depth_m
      })),
      uncertainty_m:null,confidence:'NOT_QUANTIFIED',predictor_eligible:false
    });
  }
  const populated=cells.filter(c=>c.depth_m!=null);
  const depthValues=populated.map(c=>c.depth_m);
  return {
    schema:'coastal-chart-seafloor-reconstruction/0.1',
    created_at_utc:new Date().toISOString(),
    aoi:{...aoi},grid:{nx,ny,nominal_step_m:gridM,width_m:width,height_m:height,
      output_resolution_is_computational_only:true},
    source:dataset.source,
    method:'CONSTRAINED_IDW_CHART_ISOLINES_AND_SOUNDINGS',
    evidence:{soundings:groups.soundings.length,contours:groups.contours.length,
      depth_areas:groups.depthAreas.length,quality_areas:groups.qualityAreas.length,
      sampled_point_constraints:observations.length,distinct_depth_values:depthLevels.size},
    coverage_ratio:cells.length?populated.length/cells.length:0,
    min_depth_m:depthValues.length?Math.min(...depthValues):null,
    max_depth_m:depthValues.length?Math.max(...depthValues):null,
    flags:{
      datum_alignment:'NOT_VALIDATED',
      interpolation_cross_validation:'NOT_EXECUTED',
      source_chart_generalization:'UNQUANTIFIED',
      catzoc_uncertainty:'NOT_CONVERTED_TO_SIGMA',
      unsupported_land_interpolation:'DISALLOWED_WHERE_DEPTH_AREA_PRESENT',
      support_radius_m:radius,
      blocked_cell_counts:summary
    },
    bellhop3d_gate:{
      status:'BLOCKED_NOT_ANALYSIS_READY',
      can_export_as_model_input:false,
      blocking_gates:[
        'VERIFY_SOURCE_ENC_EDITION_AND_VERTICAL_DATUM',
        'RECONCILE_DEPTH_DATUM_WITH_SEA_LEVEL_AND_SOURCE_RECEIVER_COORDINATES',
        'VALIDATE_AGAINST_INDEPENDENT_DTM_OR_SURVEY_SOUNDINGS',
        'VALIDATE_INTERPOLATION_RESIDUALS_AND_CROSS_CONTOUR_CONSTRAINTS',
        'VERIFY_COMPLETE_WATER_DOMAIN_AND_SOURCE_RECEIVER_PATH_COVERAGE',
        'ASSIGN_MEASUREMENT_AND_INTERPOLATION_UNCERTAINTY'
      ]
    },
    cells
  };
}
export function coastalModelCsv(model){
  if(model?.schema!=='coastal-chart-seafloor-reconstruction/0.1')throw Error('Modello costiero non riconosciuto');
  const lines=['lon,lat,depth_m,ix,iy,nearest_evidence_m,reason'];
  for(const c of model.cells){
    if(c.depth_m==null)continue;
    lines.push([c.lon.toFixed(8),c.lat.toFixed(8),c.depth_m,c.ix,c.iy,
      c.nearest_evidence_m?.toFixed(2)??'',c.reason].join(','));
  }
  return lines.join('\n')+'\n';
}
