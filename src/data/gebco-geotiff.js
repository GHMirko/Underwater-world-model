import { fromArrayBuffer } from 'geotiff';
import { rasterToBathymetryGrid } from './emodnet-wcs.js';
import { buildAdaptiveContours, chooseContourScheme, contourSummary, assessBathymetryConfidence } from '../map/local-contours.js';
import { aoiDimensionsMeters } from '../map/spatial-scale.js';

/**
 * Read an operator-supplied GEBCO GeoTIFF into a real numeric AOI grid.
 * GEBCO uses elevation positive up; negative raster pixels are sea bottom.
 * This module NEVER fetches an image WMS as a substitute for numeric data.
 */
const MAX_FILE_BYTES=50*1024*1024;
const MAX_CELLS=250000;
const MIN_GRID_SIZE=2;
function limited(n,lo,hi){return Math.max(lo,Math.min(hi,n));}
export async function readGebcoGeoTiff(buffer,aoi) {
  if(!aoi)throw Error('Disegnare prima una AOI per estrarre il GeoTIFF GEBCO');
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength===0||buffer.byteLength>MAX_FILE_BYTES)
    throw Error('GeoTIFF GEBCO vuoto o >50 MB: scaricare il subset relativo alla AOI');
  const tiff=await fromArrayBuffer(buffer);
  const image=await tiff.getImage();
  const keys=image.getGeoKeys();
  const epsg=keys?.ProjectedCSTypeGeoKey??keys?.GeographicTypeGeoKey??4326;
  if(epsg!==4326)throw Error('Il GeoTIFF deve essere georeferenziato in EPSG:4326; trasformare con GDAL prima di importare');
  const bbox=image.getBoundingBox();
  const [west,south,east,north]=bbox;
  if(![west,south,east,north].every(Number.isFinite) || west>=east || south>=north ||
     Math.abs(east)>540 || Math.abs(north)>90 || Math.abs(south)>90)
    throw Error('GeoTIFF non georeferenziato in coordinate geografiche EPSG:4326');
  const width=image.getWidth(),height=image.getHeight();
  const xStep=(east-west)/width,yStep=(north-south)/height;
  const x0=limited(Math.floor((aoi.minLon-west)/xStep),0,width);
  const x1=limited(Math.ceil((aoi.maxLon-west)/xStep),0,width);
  const y0=limited(Math.floor((north-aoi.maxLat)/yStep),0,height);
  const y1=limited(Math.ceil((north-aoi.minLat)/yStep),0,height);
  if(x1<=x0||y1<=y0)throw Error('La AOI non interseca la copertura del GeoTIFF GEBCO');
  const nx=x1-x0,ny=y1-y0;
  if(nx<MIN_GRID_SIZE||ny<MIN_GRID_SIZE)
    throw Error(`AOI più piccola della risoluzione GEBCO: ${nx}×${ny} celle; nessuna isobata deducibile. Utilizzare EMODnet/DTM HR.`);
  if(nx*ny>MAX_CELLS)throw Error('AOI GeoTIFF troppo estesa (>250000 celle). Ridurre AOI o campionare un subset verificato.');
  const raster=await image.readRasters({window:[x0,y0,x1,y1],samples:[0],interleave:true});
  const noDataRaw=image.getGDALNoData?.();
  const data=rasterToBathymetryGrid({
    values:raster,width:nx,height:ny,
    bbox:[west+x0*xStep,north-y1*yStep,west+x1*xStep,north-y0*yStep],
    noData:noDataRaw==null?NaN:Number(noDataRaw),
    verticalConvention:'elevation-positive-up'
  });
  const dimensions=aoiDimensionsMeters(aoi);
  const nativeLatitudeCellM=yStep*110540,nativeLongitudeCellM=xStep*111320*Math.cos((aoi.minLat+aoi.maxLat)/2*Math.PI/180);
  const native=Math.max(nativeLatitudeCellM,nativeLongitudeCellM);
  const quality=assessBathymetryConfidence({
    aoiWidthM:dimensions.width,aoiHeightM:dimensions.height,
    nativeResolutionM:native,
    validSamples:data.valid_cells,totalSamples:data.total_cells,
    sourceType:'GEBCO_GLOBAL_GRID',derivation:'NUMERIC_GRID'
  });
  return {data,quality,native_resolution_m:native,
    horizontal_source:'GEBCO_2026_USER_SUPPLIED_GEOTIFF',
    source_vertical_convention:'elevation-positive-up',
    reference_level:'ASSUMED_MSL_MUST_VERIFY',
    file_reused_for_aoi:true};
}
export function generateGebcoContours(gridBundle,count) {
  const {data,quality}=gridBundle;
  const scheme=chooseContourScheme(data.min,data.max,count);
  const geometry=buildAdaptiveContours({
    samples:data.samples,nx:data.nx,ny:data.ny,scheme,
    metadata:{source:'GEBCO_2026_USER_SUPPLIED_GEOTIFF',
      native_resolution_m:gridBundle.native_resolution_m,
      confidence:quality.confidence,confidence_score:quality.confidence_score,
      coverage_ratio:quality.coverage_ratio,
      estimated_horizontal_uncertainty_m:quality.estimated_horizontal_uncertainty_m,
      fitness_for_use:quality.fitness_for_use}
  });
  const summary=contourSummary(geometry,scheme,quality);
  summary.source='GEBCO_2026_USER_SUPPLIED_GEOTIFF';
  summary.model_datum_verification='REQUIRED';
  summary.grid=`${data.nx}x${data.ny}`;
  return {geometry,summary};
}
