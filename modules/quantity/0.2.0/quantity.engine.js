// LEAVES Quantity 0.2.0
// Deterministic SKP geometry facts. Preview geometry is never authoritative.
export const QUANTITY_ENGINE_VERSION='0.2.0';
export const INCH2_TO_M2=0.00064516;
export const PREVIEW_TRIANGLE_BUDGET=60000;
export const DEFAULT_MATERIAL_ID='default';
export const DEFAULT_MATERIAL_NAME='未指定材質';

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const round=(n,d=4)=>Number(Number(n||0).toFixed(d));

export function identity(){return[1,0,0,0,1,0,0,0,1,0,0,0,1];}
function asRowAffine(m){
  if(m?.length===13)return m;
  if(m?.length===16)return[m[0],m[4],m[8],m[1],m[5],m[9],m[2],m[6],m[10],m[12],m[13],m[14],1];
  return identity();
}
export function multiply(a,b){
  const x=asRowAffine(a),y=asRowAffine(b),out=new Array(13).fill(0);
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)for(let k=0;k<3;k++)out[r*3+c]+=x[r*3+k]*y[k*3+c];
  for(let r=0;r<3;r++)out[9+r]=x[9+r]+x[r*3]*y[9]+x[r*3+1]*y[10]+x[r*3+2]*y[11];
  out[12]=1;return out;
}
export function point(m,p){
  const x=asRowAffine(m);return[
    x[0]*p[0]+x[1]*p[1]+x[2]*p[2]+x[9],
    x[3]*p[0]+x[4]*p[1]+x[5]*p[2]+x[10],
    x[6]*p[0]+x[7]*p[1]+x[8]*p[2]+x[11]
  ];
}
export function polygonArea(vertices){
  if(!Array.isArray(vertices)||vertices.length<3)return 0;
  let x=0,y=0,z=0;
  for(let i=0;i<vertices.length;i++){
    const a=vertices[i],b=vertices[(i+1)%vertices.length];
    x+=(a[1]-b[1])*(a[2]+b[2]);y+=(a[2]-b[2])*(a[0]+b[0]);z+=(a[0]-b[0])*(a[1]+b[1]);
  }
  return Math.hypot(x,y,z)/2;
}
export function polygonNormal(vertices){
  if(!Array.isArray(vertices)||vertices.length<3)return[0,0,1];
  let x=0,y=0,z=0;
  for(let i=0;i<vertices.length;i++){
    const a=vertices[i],b=vertices[(i+1)%vertices.length];
    x+=(a[1]-b[1])*(a[2]+b[2]);y+=(a[2]-b[2])*(a[0]+b[0]);z+=(a[0]-b[0])*(a[1]+b[1]);
  }
  const len=Math.hypot(x,y,z)||1;return[x/len,y/len,z/len];
}
export function faceLoops(face,verticesById,edgesById){
  return(face?.loops||[]).map(loop=>loop.map(co=>{
    const e=edgesById.get(co.edgeId);if(!e)return null;
    const v=verticesById.get(co.orientation===1?e.v1Id:e.v2Id);return v?[v.x,v.y,v.z]:null;
  }).filter(Boolean)).filter(loop=>loop.length>=3);
}
function faceAreaM2(loops,transform){
  if(!loops.length)return 0;
  const outer=polygonArea(loops[0].map(v=>point(transform,v)));
  const holes=loops.slice(1).reduce((s,r)=>s+polygonArea(r.map(v=>point(transform,v))),0);
  return Math.max(0,outer-holes)*INCH2_TO_M2;
}
function materialId(id){return id==null?DEFAULT_MATERIAL_ID:String(id);}
function materialColor(mat){return mat?.color?[mat.color.r??170,mat.color.g??183,mat.color.b??180]:[155,172,175];}
function stepProgress(progress,phase,current,total,label=''){if(typeof progress==='function')progress({phase,current,total,label});}

function localBounds(def){
  const vs=def?.vertices||[];if(!vs.length)return{dims:[0,0,0],thinAxis:2,thinRatio:1};
  let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const v of vs){const p=[Number(v.x)||0,Number(v.y)||0,Number(v.z)||0];for(let i=0;i<3;i++){if(p[i]<min[i])min[i]=p[i];if(p[i]>max[i])max[i]=p[i];}}
  const dims=max.map((v,i)=>Math.max(0,v-min[i]));let thinAxis=0;if(dims[1]<dims[thinAxis])thinAxis=1;if(dims[2]<dims[thinAxis])thinAxis=2;
  const sorted=[...dims].sort((a,b)=>a-b);const thinRatio=sorted[1]>1e-9?sorted[0]/sorted[1]:1;
  return{dims,thinAxis,thinRatio};
}
function smartObjectClassification(records,def){
  const bounds=localBounds(def);const isThin=bounds.thinRatio<=0.12&&bounds.dims[bounds.thinAxis]<=8;
  const out=new Map();
  const groups=new Map();
  for(const r of records){
    if(!r.isInherited)continue;
    if(!groups.has(r.key))groups.set(r.key,[]);groups.get(r.key).push(r);
  }
  for(const [key,items] of groups){
    if(!isThin){for(const r of items)out.set(r.key+':'+r.seq,{smartArea:r.area,include:true,confidence:'low',reason:'not-thin'});continue;}
    const axis=bounds.thinAxis;const pos=[],neg=[],edge=[];
    for(const r of items){const n=r.normal||[0,0,1],a=Math.abs(n[axis]);if(a>=0.82)(n[axis]>=0?pos:neg).push(r);else edge.push(r);}
    const sum=a=>a.reduce((s,r)=>s+r.area,0),p=sum(pos),n=sum(neg),all=sum(items),chosen=p>=n?pos:neg,chosenArea=Math.max(p,n);
    const broadShare=all>0?chosenArea/all:0;const confidence=bounds.thinRatio<=0.06&&broadShare>=0.38?'high':broadShare>=0.28?'medium':'low';
    if(!chosen.length||broadShare<0.2){for(const r of items)out.set(r.key+':'+r.seq,{smartArea:r.area,include:true,confidence:'low',reason:'ambiguous-solid'});continue;}
    const chosenSet=new Set(chosen.map(r=>r.seq));
    for(const r of items)out.set(r.key+':'+r.seq,{smartArea:chosenSet.has(r.seq)?r.area:0,include:chosenSet.has(r.seq),confidence,reason:'thin-board-single-side'});
  }
  return{map:out,bounds,isThin};
}
function addPreview(buckets,key,loops,matrix,earcut,stats){
  if(!earcut||stats.triangles>=PREVIEW_TRIANGLE_BUDGET||!loops.length)return;
  const rings=loops.map(r=>r.map(p=>point(matrix,p)));const normal=polygonNormal(rings[0]);const axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
  const flat=[],holes=[],vertices=[];
  for(let r=0;r<rings.length;r++){if(r)holes.push(vertices.length);for(const v of rings[r]){vertices.push(v);if(axis===0)flat.push(v[1],v[2]);else if(axis===1)flat.push(v[0],v[2]);else flat.push(v[0],v[1]);}}
  if(vertices.length>2500)return;let idx;try{idx=earcut(flat,holes,2);}catch{return;}
  const bucket=buckets.get(key)||[];
  for(let k=0;k<idx.length&&stats.triangles<PREVIEW_TRIANGLE_BUDGET;k+=3){for(const i of idx.slice(k,k+3)){const v=vertices[i];bucket.push(v[0]*.0254,v[2]*.0254,-v[1]*.0254);}stats.triangles++;}
  buckets.set(key,bucket);
}

export function quickSheetEstimate(areaM2,widthCm=122,heightCm=244,wastePct=10){
  const w=Math.max(0,Number(widthCm)||0)/100,h=Math.max(0,Number(heightCm)||0)/100,sheetArea=w*h;
  if(areaM2<=0||sheetArea<=0)return{sheetAreaM2:round(sheetArea),netSheets:0,wasteSheets:0,wasteAreaM2:0};
  const wasteArea=areaM2*(1+Math.max(0,Number(wastePct)||0)/100);
  return{sheetAreaM2:round(sheetArea),netSheets:Math.ceil(areaM2/sheetArea),wasteSheets:Math.ceil(wasteArea/sheetArea),wasteAreaM2:round(wasteArea)};
}


function collectMaterialReferences(model){
  const refs=new Set(),defs=model?.definitions instanceof Map?[...model.definitions.values()]:[];
  const all=[model?.root,...defs].filter(Boolean);
  for(const def of all){
    for(const face of def.faces||[]){if(face.materialId!=null)refs.add(String(face.materialId));if(face.backMaterialId!=null)refs.add(String(face.backMaterialId));}
    for(const inst of def.instances||[])if(inst.materialId!=null)refs.add(String(inst.materialId));
  }
  return refs;
}

export function analyzeModel(model,{progress,earcut,preview=true,maxPlacedFaces=4_000_000}={}){
  const mats=model?.materials||[],materialsById=new Map(mats.filter(m=>m.id!=null).map(m=>[String(m.id),m]));
  const totals=new Map(),buckets=new Map(),components=new Map(),previewStats={triangles:0},defs=model.definitions instanceof Map?model.definitions:new Map();
  const cache=new Map();let cachedFaces=0,placedFaces=0,hiddenInstances=0,hiddenFaces=0,placements=0,recursiveSkips=0,truncated=false,seq=0;
  const usedIds=new Set(),referencedIds=collectMaterialReferences(model);
  function local(def){
    if(cache.has(def))return cache.get(def);const vertices=new Map((def?.vertices||[]).map(v=>[v.id,v])),edges=new Map((def?.edges||[]).map(e=>[e.id,e]));
    const faces=(def?.faces||[]).map(f=>({face:f,loops:faceLoops(f,vertices,edges)}));
    if(faces.length<=20000&&cachedFaces+faces.length<=120000){cache.set(def,faces);cachedFaces+=faces.length;}return faces;
  }
  function ensure(key){
    let t=totals.get(key);if(t)return t;const mat=materialsById.get(key);t={id:key,name:key===DEFAULT_MATERIAL_ID?DEFAULT_MATERIAL_NAME:(mat?.name||`材質 #${key}`),color:materialColor(mat),frontAreaM2:0,backAreaM2:0,smartAreaM2:0,frontFaces:0,backFaces:0,smartIncludedFaces:0,smartExcludedFaces:0,smartAdjustedObjects:0,smartLowConfidenceObjects:0,explicitAreaM2:0,inheritedAreaM2:0,backFallbackAreaM2:0,objectBreakdown:new Map(),_lowPaths:new Set(),samples:[]};totals.set(key,t);return t;
  }
  function addFront(key,area,path,{smartArea=area,source='explicit',confidence='high',reason='explicit-face'}={}){
    const t=ensure(key);t.frontAreaM2+=area;t.frontFaces++;t.smartAreaM2+=smartArea;if(smartArea>0)t.smartIncludedFaces++;else t.smartExcludedFaces++;if(source==='explicit')t.explicitAreaM2+=area;else if(source==='inherited')t.inheritedAreaM2+=area;else if(source==='back-fallback')t.backFallbackAreaM2+=area;
    if(t.samples.length<4&&path)t.samples.push(path);if(key!==DEFAULT_MATERIAL_ID)usedIds.add(key);
    if(confidence==='low'&&!t._lowPaths.has(path)){t._lowPaths.add(path);t.smartLowConfidenceObjects++;}
    const old=t.objectBreakdown.get(path)||{path,rawAreaM2:0,smartAreaM2:0,faces:0,reason,confidence};old.rawAreaM2+=area;old.smartAreaM2+=smartArea;old.faces++;if(confidence==='low')old.confidence='low';old.reason=reason;t.objectBreakdown.set(path,old);
  }
  function addBack(key,area){const t=ensure(key);t.backAreaM2+=area;t.backFaces++;if(key!==DEFAULT_MATERIAL_ID)usedIds.add(key);}
  function visit(def,matrix,inherited,path,stack){
    if(!def||stack.size>64||truncated)return;
    const records=[];
    for(const {face,loops} of local(def)){
      if(face.hidden){hiddenFaces++;continue;}if(placedFaces>=maxPlacedFaces){truncated=true;break;}placedFaces++;
      const area=faceAreaM2(loops,matrix);if(area<=1e-10)continue;const explicitFront=face.materialId!=null?materialId(face.materialId):null,explicitBack=face.backMaterialId!=null?materialId(face.backMaterialId):null;
      let front=explicitFront||(inherited!=null?materialId(inherited):null);let source=explicitFront?'explicit':front?'inherited':'none';
      if(!front&&explicitBack){front=explicitBack;source='back-fallback';}
      if(!front)front=DEFAULT_MATERIAL_ID;
      const normal=loops[0]?.length>=3?polygonNormal(loops[0]):[0,0,1];records.push({seq:seq++,key:front,area,loops,normal,isInherited:source==='inherited',source,back:explicitBack,path});
    }
    const smart=smartObjectClassification(records,def);
    const adjustedKeys=new Set();
    for(const r of records){
      const sm=r.isInherited?smart.map.get(r.key+':'+r.seq):null;
      const smartArea=sm?.smartArea??r.area,confidence=sm?.confidence||'high',reason=sm?.reason||'explicit-face';addFront(r.key,r.area,path,{smartArea,source:r.source,confidence,reason});
      if(r.isInherited&&smartArea!==r.area)adjustedKeys.add(r.key);
      if(r.back&&r.back!==r.key)addBack(r.back,r.area);
      if(preview){const k=JSON.stringify([r.key,buckets.size<350?path:'其餘物件']);addPreview(buckets,k,r.loops,matrix,earcut,previewStats);}
      if(placedFaces%25000===0)stepProgress(progress,'quantity',placedFaces,maxPlacedFaces,`已計算 ${placedFaces.toLocaleString()} 個面`);
    }
    for(const k of adjustedKeys)ensure(k).smartAdjustedObjects++;
    if(truncated)return;
    for(const inst of def.instances||[]){
      if(inst.hidden){hiddenInstances++;continue;}const child=defs.get(inst.refIdx);if(!child)continue;if(stack.has(inst.refIdx)){recursiveSkips++;continue;}
      placements++;const label=String(inst.name||child.name||`Component ${inst.refIdx}`),childPath=path?`${path} / ${label}`:label;components.set(label,(components.get(label)||0)+1);
      const next=new Set(stack);next.add(inst.refIdx);visit(child,multiply(matrix,inst.matrix),inst.materialId??inherited,childPath,next);
      if(truncated)return;
    }
  }
  visit(model.root,identity(),null,'ROOT',new Set());
  const materials=[...totals.values()].map(t=>({
    id:t.id,name:t.name,color:t.color,frontAreaM2:round(t.frontAreaM2),backAreaM2:round(t.backAreaM2),smartAreaM2:round(t.smartAreaM2),frontFaces:t.frontFaces,backFaces:t.backFaces,smartIncludedFaces:t.smartIncludedFaces,smartExcludedFaces:t.smartExcludedFaces,smartAdjustedObjects:t.smartAdjustedObjects,smartLowConfidenceObjects:t.smartLowConfidenceObjects,explicitAreaM2:round(t.explicitAreaM2),inheritedAreaM2:round(t.inheritedAreaM2),backFallbackAreaM2:round(t.backFallbackAreaM2),objects:[...t.objectBreakdown.values()].sort((a,b)=>b.rawAreaM2-a.rawAreaM2).slice(0,250).map(x=>({...x,rawAreaM2:round(x.rawAreaM2),smartAreaM2:round(x.smartAreaM2)}))
  })).sort((a,b)=>b.frontAreaM2-a.frontAreaM2||a.name.localeCompare(b.name,'zh-Hant'));
  const unused=mats.filter(m=>m.id!=null&&!usedIds.has(String(m.id))).map(m=>{const id=String(m.id),referenced=referencedIds.has(id);return{id,name:String(m.name||`材質 #${m.id}`),color:materialColor(m),unusedStatus:referenced?'not-visible':'orphan',unusedLabel:referenced?'檔案內仍有引用 · 目前可見場景未使用':'材質表殘留候選 · 未發現幾何/元件引用'};});
  const orphanCount=unused.filter(m=>m.unusedStatus==='orphan').length,referencedNotVisible=unused.length-orphanCount;
  const previewGroups=[...buckets].map(([key,positions])=>{const[id,path]=JSON.parse(key);return{id,path,positions:new Float32Array(positions)};});
  return{
    mode:'full',version:String(model.version||'Unknown'),units:model.units||'英吋（SKP 幾何單位）',sourceMaterialCount:mats.length,materials,unused,
    totals:{placedFaces,hiddenInstances,hiddenFaces,placements,recursiveSkips,previewTriangles:previewStats.triangles,previewComplete:!truncated&&previewStats.triangles<PREVIEW_TRIANGLE_BUDGET,truncated},
    materialAudit:{source:mats.length,usedVisible:materials.filter(m=>m.id!==DEFAULT_MATERIAL_ID).length,unusedVisible:unused.length,orphan:orphanCount,referencedNotVisible,defaultFaces:materials.find(m=>m.id===DEFAULT_MATERIAL_ID)?.frontFaces||0},
    components:[...components].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count).slice(0,800),previewGroups
  };
}

export function buildAiQuantityContext(snapshot,{maxMaterials=30}={}){
  const r=snapshot?.result||snapshot;if(!r?.materials)return'';const lines=['[LEAVES SKP DIRECT READER 0.2.0]'];
  if(snapshot?.fileName)lines.push(`檔案：${snapshot.fileName}`);lines.push(`模式：${r.mode||'full'}；SKP：${r.version||'Unknown'}`);
  if(r.mode==='wasm-safe')lines.push('大型模型安全模式：面積來自 GLB 三角網格與 instancing 的近似換算，保留大模型可用性，但不是原始 SKP Face metadata。');
  lines.push(`材質：${r.materials.length}；來源材質庫：${r.sourceMaterialCount??'未知'}；未使用/未在可見場景：${r.unused?.length??'安全模式不可判定'}`);
  for(const m of r.materials.slice(0,maxMaterials))lines.push(`- ${m.name}: 幾何 ${Number(m.frontAreaM2||m.areaM2||0).toFixed(2)} m²；智慧施工面 ${Number(m.smartAreaM2??m.frontAreaM2??m.areaM2??0).toFixed(2)} m²；${m.frontFaces??m.triangleCount??0} ${r.mode==='wasm-safe'?'triangles':'faces'}`);
  lines.push('板材快速估算需使用使用者輸入的板材長寬（cm）與損耗率；快速片數不是 2D nesting 最終裁切圖。');return lines.join('\n');
}

export function runQuantityEngineSelfTest(){
  const errors=[];
  const e=quickSheetEstimate(10,122,244,10);if(e.netSheets!==4||e.wasteSheets!==4)errors.push('sheet estimate mismatch');
  const p=[[0,0,0],[10,0,0],[10,10,0],[0,10,0]];if(Math.abs(polygonArea(p)-100)>1e-9)errors.push('polygon area mismatch');
  const scaled=multiply(identity(),[2,0,0,0,1,0,0,0,1,0,0,0,1]);const q=point(scaled,[2,3,0]);if(Math.abs(q[0]-4)>1e-9||Math.abs(q[1]-3)>1e-9)errors.push('matrix mismatch');
  return{ok:errors.length===0,errors,engine:QUANTITY_ENGINE_VERSION,probe:{sheet:e}};
}
