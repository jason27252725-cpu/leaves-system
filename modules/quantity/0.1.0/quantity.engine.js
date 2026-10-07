export const QUANTITY_ENGINE_VERSION = '0.1.0';
export const SQ_INCH_TO_M2 = 0.00064516;

export const IDENTITY_13 = Object.freeze([
  1,0,0,
  0,1,0,
  0,0,1,
  0,0,0,
  1,
]);

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

export function multiplyMatrix13(a,b){
  if(!a?.length) return Array.from(b||IDENTITY_13);
  if(!b?.length) return Array.from(a||IDENTITY_13);
  const ap=a.length<13?[...a,...new Array(13-a.length).fill(0)]:a;
  const bp=b.length<13?[...b,...new Array(13-b.length).fill(0)]:b;
  if(ap[12]===0)ap[12]=1;if(bp[12]===0)bp[12]=1;
  const r0=[ap[0],ap[1],ap[2],ap[9]],r1=[ap[3],ap[4],ap[5],ap[10]],r2=[ap[6],ap[7],ap[8],ap[11]];
  const c0=[bp[0],bp[3],bp[6],0],c1=[bp[1],bp[4],bp[7],0],c2=[bp[2],bp[5],bp[8],0],c3=[bp[9],bp[10],bp[11],1];
  const dot=(r,c)=>r[0]*c[0]+r[1]*c[1]+r[2]*c[2]+r[3]*c[3];
  return [dot(r0,c0),dot(r0,c1),dot(r0,c2),dot(r1,c0),dot(r1,c1),dot(r1,c2),dot(r2,c0),dot(r2,c1),dot(r2,c2),dot(r0,c3),dot(r1,c3),dot(r2,c3),ap[12]*bp[12]];
}

export function transformPoint13(m,p){
  const a=m?.length>=12?m:IDENTITY_13;const [x,y,z]=p;
  return [a[0]*x+a[1]*y+a[2]*z+a[9],a[3]*x+a[4]*y+a[5]*z+a[10],a[6]*x+a[7]*y+a[8]*z+a[11]];
}

export function polygonArea3D(points){
  if(!Array.isArray(points)||points.length<3)return 0;
  let cx=0,cy=0,cz=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    cx+=a[1]*b[2]-a[2]*b[1];
    cy+=a[2]*b[0]-a[0]*b[2];
    cz+=a[0]*b[1]-a[1]*b[0];
  }
  return 0.5*Math.hypot(cx,cy,cz);
}

function definitionCache(def){
  const vertices=new Map((def?.vertices||[]).map(v=>[v.id,[Number(v.x)||0,Number(v.y)||0,Number(v.z)||0]]));
  const edges=new Map((def?.edges||[]).map(e=>[e.id,[e.v1Id,e.v2Id]]));
  return {vertices,edges};
}

export function reconstructLoopVertexIds(loop,edgeMap){
  const ids=[];
  for(const item of loop||[]){
    const edge=edgeMap.get(item?.edgeId);if(!edge)continue;
    const id=Number(item?.orientation)===1?edge[0]:edge[1];
    if(id===null||id===undefined)continue;
    if(ids.length===0||ids[ids.length-1]!==id)ids.push(id);
  }
  if(ids.length>1&&ids[0]===ids[ids.length-1])ids.pop();
  return ids;
}

export function faceAreaWorldIn2(face,cache,matrix){
  const loopAreas=[];
  for(const loop of face?.loops||[]){
    const ids=reconstructLoopVertexIds(loop,cache.edges);
    const pts=ids.map(id=>cache.vertices.get(id)).filter(Boolean).map(p=>transformPoint13(matrix,p));
    const area=polygonArea3D(pts);
    if(area>1e-10)loopAreas.push(area);
  }
  if(loopAreas.length===0)return 0;
  loopAreas.sort((a,b)=>b-a);
  return Math.max(0,loopAreas[0]-loopAreas.slice(1).reduce((s,v)=>s+v,0));
}

export function inferMaterialCategory(name=''){
  const n=String(name).toLowerCase();
  if(/木皮|veneer|kd\b|科定/.test(n))return '木皮';
  if(/玻璃|glass|明鏡|灰鏡|茶鏡|鏡面/.test(n))return '玻璃／鏡面';
  if(/特殊漆|油漆|paint|塗料|乳膠漆/.test(n))return '漆面';
  if(/石材|大理石|石英|stone|岩板/.test(n))return '石材';
  if(/磁磚|tile|磚/.test(n))return '磁磚';
  if(/美耐板|laminate|板材|木芯|夾板|plywood/.test(n))return '板材';
  if(/金屬|鐵件|不鏽鋼|steel|metal|鋁/.test(n))return '金屬';
  return '其他';
}

function normalizedColor(mat){
  const c=mat?.color||{};
  return {r:clamp(Math.round(Number(c.r)||0),0,255),g:clamp(Math.round(Number(c.g)||0),0,255),b:clamp(Math.round(Number(c.b)||0),0,255),a:clamp(Math.round(c.a===undefined?255:Number(c.a)||0),0,255)};
}

function textureBaseName(mat){
  const raw=String(mat?.texture?.filename||'').replace(/\\/g,'/');
  return raw.split('/').pop()?.toLowerCase()||'';
}

export function analyzeSkpModel(model,{includeHidden=false}={}){
  if(!model?.root)throw new Error('SKP model has no root definition');
  const cacheByDef=new WeakMap();
  const getCache=def=>{let c=cacheByDef.get(def);if(!c){c=definitionCache(def);cacheByDef.set(def,c);}return c;};
  const materialMap=new Map();
  const hiddenLayerNames=new Set((model.layers||[]).filter(l=>l?.hidden).map(l=>String(l.name||'')).filter(Boolean));
  const warnings=[];
  let instanceCount=0,faceSeen=0,faceCounted=0,hiddenFacesSkipped=0,hiddenInstancesSkipped=0,recursiveSkips=0;
  let unpaintedAreaM2=0,unpaintedFaces=0,paintedAreaM2=0,backDifferentFaces=0;
  const objectPaths=new Set(),hiddenInstanceGuids=new Set();

  const getMaterialById=id=>id===null||id===undefined?null:(model.materialsById?.get?.(id)||null);
  const ensureMaterial=mat=>{
    const name=String(mat?.name||'未指定材質').trim()||'未指定材質';
    if(!materialMap.has(name)){
      const color=normalizedColor(mat);
      materialMap.set(name,{name,category:inferMaterialCategory(name),areaM2:0,frontAreaM2:0,backFallbackAreaM2:0,backSecondaryAreaM2:0,faceCount:0,backFaceCount:0,_objects:new Set(),color,opacity:clamp((color.a/255)*(Number(mat?.transparency??1)||0),0,1),texture:textureBaseName(mat),materialId:mat?.id??null});
    }
    return materialMap.get(name);
  };
  const addPrimary=(mat,areaM2,path,kind='front')=>{
    if(!mat||areaM2<=0)return;
    const item=ensureMaterial(mat);item.areaM2+=areaM2;item.faceCount++;item._objects.add(path);
    if(kind==='back-fallback')item.backFallbackAreaM2+=areaM2;else item.frontAreaM2+=areaM2;
    paintedAreaM2+=areaM2;
  };
  const addSecondaryBack=(mat,areaM2,path)=>{
    if(!mat||areaM2<=0)return;
    const item=ensureMaterial(mat);item.backSecondaryAreaM2+=areaM2;item.backFaceCount++;item._objects.add(path);
  };

  const walk=(def,matrix,inheritedMaterial,path,activeIds)=>{
    if(!def)return;
    objectPaths.add(path);
    const cache=getCache(def);
    for(const face of def.faces||[]){
      faceSeen++;
      if(face.hidden&&!includeHidden){hiddenFacesSkipped++;continue;}
      const areaIn2=faceAreaWorldIn2(face,cache,matrix);if(areaIn2<=1e-9)continue;
      const areaM2=areaIn2*SQ_INCH_TO_M2;faceCounted++;
      const explicitFront=getMaterialById(face.materialId);
      const explicitBack=getMaterialById(face.backMaterialId);
      const front=explicitFront||inheritedMaterial||null;
      const back=explicitBack||inheritedMaterial||null;
      if(front){
        addPrimary(front,areaM2,path,'front');
        if(back&&back.name!==front.name){backDifferentFaces++;addSecondaryBack(back,areaM2,path);}
      }else if(back){
        // A common modelling mistake is painting only the back side. Keep it in
        // the primary takeoff rather than silently losing the material, but mark
        // it separately so the UI can explain why it was counted.
        addPrimary(back,areaM2,path,'back-fallback');
      }else{
        unpaintedAreaM2+=areaM2;unpaintedFaces++;
      }
    }
    for(const inst of def.instances||[]){
      instanceCount++;
      if((inst.hidden||hiddenLayerNames.has(String(inst.layer||'')))&&!includeHidden){hiddenInstancesSkipped++;if(inst.guid)hiddenInstanceGuids.add(String(inst.guid));continue;}
      const ref=inst.refIdx;const child=model.definitions?.get?.(ref);if(!child)continue;
      if(activeIds.has(ref)){recursiveSkips++;warnings.push(`略過遞迴元件：${inst.name||child.name||ref}`);continue;}
      const nextMatrix=multiplyMatrix13(matrix,inst.matrix||IDENTITY_13);
      const ownMat=getMaterialById(inst.materialId);const inherited=ownMat||inheritedMaterial||null;
      const label=String(inst.name||child.name||`Component_${ref}`).trim()||`Component_${ref}`;
      activeIds.add(ref);walk(child,nextMatrix,inherited,`${path} / ${label}`,activeIds);activeIds.delete(ref);
    }
  };

  walk(model.root,Array.from(IDENTITY_13),null,'ROOT',new Set());
  const materials=[...materialMap.values()].map(item=>({
    name:item.name,category:item.category,
    areaM2:Number(item.areaM2.toFixed(4)),frontAreaM2:Number(item.frontAreaM2.toFixed(4)),backFallbackAreaM2:Number(item.backFallbackAreaM2.toFixed(4)),backSecondaryAreaM2:Number(item.backSecondaryAreaM2.toFixed(4)),
    faceCount:item.faceCount,backFaceCount:item.backFaceCount,objectCount:item._objects.size,color:item.color,opacity:item.opacity,texture:item.texture,materialId:item.materialId,
  })).sort((a,b)=>b.areaM2-a.areaM2||a.name.localeCompare(b.name,'zh-Hant'));
  const totalSurface=paintedAreaM2+unpaintedAreaM2;
  return {
    version:String(model.version||'Unknown'),units:model.units||'Unknown',
    stats:{definitionCount:Number(model.definitions?.size||0),layerCount:Number(model.layers?.length||0),materialCount:Number(model.materials?.length||0),instanceCount,objectCount:objectPaths.size,faceSeen,faceCounted,hiddenFacesSkipped,hiddenInstancesSkipped,recursiveSkips},
    coverage:{paintedAreaM2:Number(paintedAreaM2.toFixed(4)),unpaintedAreaM2:Number(unpaintedAreaM2.toFixed(4)),unpaintedFaces,coveragePercent:totalSurface>0?Number((paintedAreaM2/totalSurface*100).toFixed(1)):0,backDifferentFaces},
    visibility:{hiddenInstanceGuids:[...hiddenInstanceGuids],hiddenInstanceGuidCount:hiddenInstanceGuids.size,hiddenLayerNames:[...hiddenLayerNames]},
    materials,warnings,
  };
}

function nearlyColor(a,b,tol=1){return Math.abs(a.r-b.r)<=tol&&Math.abs(a.g-b.g)<=tol&&Math.abs(a.b-b.b)<=tol;}
function baseName(s=''){return String(s).replace(/\\/g,'/').split('/').pop()?.toLowerCase()||'';}

/**
 * OpenSKP's render scene deliberately batches geometry by resolved render
 * appearance, not by material name. This helper recovers a best-effort name
 * for viewer highlighting by matching RGB/opacity and, when present, the
 * original texture filename. Quantity totals never depend on this mapping.
 */
export function mapSceneMaterials(model,scene){
  const raw=(model?.materials||[]).map(m=>({name:String(m.name||''),color:normalizedColor(m),opacity:clamp((normalizedColor(m).a/255)*(Number(m.transparency??1)||0),0,1),texture:baseName(m?.texture?.filename||'')}));
  return (scene?.gltfMaterials||[]).map((gm,index)=>{
    const pbr=gm?.pbrMetallicRoughness||{};const f=pbr.baseColorFactor||[.5,.5,.5,1];
    const color={r:Math.round((Number(f[0])||0)*255),g:Math.round((Number(f[1])||0)*255),b:Math.round((Number(f[2])||0)*255)};const alpha=Number(f[3]??1);
    let candidates=raw.filter(m=>nearlyColor(m.color,color,1)&&Math.abs(m.opacity-alpha)<=0.02);
    const texIndex=pbr?.baseColorTexture?.index;const sceneTex=Number.isInteger(texIndex)?baseName(scene?.textures?.[texIndex]?.filename||''):'';
    if(sceneTex){const textured=candidates.filter(m=>m.texture&&m.texture===sceneTex);if(textured.length)candidates=textured;}
    if(candidates.length===1)return {index,name:candidates[0].name,confidence:sceneTex?'texture':'color',candidates:[candidates[0].name]};
    if(candidates.length>1)return {index,name:'',confidence:'ambiguous',candidates:candidates.map(x=>x.name).slice(0,8)};
    return {index,name:'',confidence:'none',candidates:[]};
  });
}

export function buildAiQuantityContext(snapshot,{maxMaterials=24}={}){
  if(!snapshot?.summary)return '';
  const s=snapshot.summary;const lines=[];
  lines.push('[LEAVES SKP DIRECT READER]');
  lines.push(`檔案：${snapshot.fileName||'未命名.skp'}`);
  lines.push(`SKP 版本：${s.version}；模型單位：${s.units}`);
  lines.push(`可計算面積覆蓋率：${s.coverage.coveragePercent}%；未指定材質：${s.coverage.unpaintedAreaM2.toFixed(2)} m² / ${s.coverage.unpaintedFaces} faces`);
  lines.push(`模型統計：${s.stats.instanceCount} instances；${s.stats.faceCounted} counted faces；${s.materials.length} 個已使用材質`);
  lines.push('材質面積（模型幾何估算，非採購量）：');
  for(const m of s.materials.slice(0,maxMaterials))lines.push(`- ${m.name}｜${m.areaM2.toFixed(2)} m²｜${m.faceCount} faces｜${m.objectCount} objects｜推測分類:${m.category}${m.backFallbackAreaM2>0?`｜其中 ${m.backFallbackAreaM2.toFixed(2)} m² 來自背面材質 fallback`:''}${m.backSecondaryAreaM2>0?`｜背面另記 ${m.backSecondaryAreaM2.toFixed(2)} m²（未併入主面積）`:''}`);
  if(s.coverage.backDifferentFaces)lines.push(`注意：有 ${s.coverage.backDifferentFaces} 個 face 的正反面材質不同；目前主要算量以正面材質為主，背面材質另記錄但不重複併入主要面積。`);
  lines.push('重要限制：這些數字是從 SKP 幾何與材質得到的面積估算，不等於木皮片數、油漆桶數或施工採購數量；後者仍需材料規格、損耗與施工規則。');
  return lines.join('\n');
}

export function runQuantityEngineSelfTest(){
  const matA={id:1,name:'KD木皮_TEST',color:{r:120,g:80,b:40,a:255},transparency:1,texture:null};
  const matB={id:2,name:'特殊漆_TEST',color:{r:80,g:80,b:80,a:255},transparency:1,texture:null};
  const def={id:1,name:'Panel',vertices:[{id:1,x:0,y:0,z:0},{id:2,x:10,y:0,z:0},{id:3,x:10,y:10,z:0},{id:4,x:0,y:10,z:0}],edges:[{id:1,v1Id:1,v2Id:2},{id:2,v1Id:2,v2Id:3},{id:3,v1Id:3,v2Id:4},{id:4,v1Id:4,v2Id:1}],faces:[{id:1,loops:[[{edgeId:1,orientation:1},{edgeId:2,orientation:1},{edgeId:3,orientation:1},{edgeId:4,orientation:1}]],materialId:1,backMaterialId:null,hidden:false}],instances:[]};
  const defPainted={id:2,name:'PaintedByInstance',vertices:def.vertices,edges:def.edges,faces:[{...def.faces[0],materialId:null}],instances:[]};
  const root={id:0,name:'ROOT',vertices:[],edges:[],faces:[],instances:[
    {name:'ScaledPanel',refIdx:1,matrix:[2,0,0,0,1,0,0,0,1,0,0,0,1],materialId:null,hidden:false},
    {name:'PaintedPanel',refIdx:2,matrix:[1,0,0,0,1,0,0,0,1,0,0,0,1],materialId:2,hidden:false}
  ]};
  const model={version:'TEST',units:'Inch',root,definitions:new Map([[1,def],[2,defPainted]]),layers:[],materials:[matA,matB],materialsById:new Map([[1,matA],[2,matB]])};
  const out=analyzeSkpModel(model);const a=out.materials.find(x=>x.name===matA.name),b=out.materials.find(x=>x.name===matB.name);
  const expectedA=200*SQ_INCH_TO_M2,expectedB=100*SQ_INCH_TO_M2;
  const errors=[];
  if(!a||Math.abs(a.areaM2-expectedA)>0.0002)errors.push(`scaled area mismatch ${a?.areaM2} != ${expectedA}`);
  if(!b||Math.abs(b.areaM2-expectedB)>0.0002)errors.push(`inherited material mismatch ${b?.areaM2} != ${expectedB}`);
  if(out.stats.instanceCount!==2)errors.push('instance count mismatch');
  return {ok:errors.length===0,errors,engine:QUANTITY_ENGINE_VERSION,probe:{materials:out.materials.map(x=>({name:x.name,areaM2:x.areaM2})),coverage:out.coverage}};
}
