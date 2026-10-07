import { analyzeSkpModel, mapSceneMaterials } from './quantity.engine.js';

const OPENSKP_URL = 'https://cdn.jsdelivr.net/npm/openskp@1.3.0/+esm';
let openskpPromise = null;
function loadOpenSkp(){
  if(!openskpPromise) openskpPromise=import(OPENSKP_URL);
  return openskpPromise;
}

function stageText(stage=''){
  const map={tlv_walk:'讀取 SketchUp 模型資料',legacy_defs:'讀取舊版元件資料',build_scene:'建立 3D 預覽幾何'};
  return map[stage]||stage||'處理模型';
}

function postProgress(phase,percent,detail=''){
  self.postMessage({type:'progress',phase,percent:Math.max(0,Math.min(100,Math.round(percent||0))),detail});
}

function safeError(err){
  return {message:String(err?.message||err||'未知錯誤'),name:String(err?.name||'Error'),stage:String(err?.stage||err?.context?.stage||'')};
}

function reduceHierarchy(node,hiddenGuids,hiddenLayers,isRoot=false){
  if(!node)return null;
  const guid=String(node.guid||'');
  if(!isRoot&&((guid&&hiddenGuids?.has(guid))||hiddenLayers?.has(String(node.layer||''))))return null;
  return {name:String(node.name||''),definitionName:String(node.definitionName||''),layer:String(node.layer||''),positionMm:Array.isArray(node.positionMm)?node.positionMm:[0,0,0],matrix:Array.isArray(node.matrix)?node.matrix:null,meshResourceId:node.meshResourceId||null,guid,children:(node.children||[]).map(child=>reduceHierarchy(child,hiddenGuids,hiddenLayers,false)).filter(Boolean)};
}

self.addEventListener('message',async event=>{
  const msg=event.data||{};
  if(msg.type!=='parse')return;
  const buffer=msg.buffer;const fileName=String(msg.fileName||'model.skp');
  const started=performance.now();
  try{
    postProgress('dependency',3,'載入本機 SKP Reader…');
    const openskp=await loadOpenSkp();
    if(typeof openskp.parseSkp!=='function'||typeof openskp.buildInstancedScene!=='function')throw new Error('OpenSKP browser API 不完整');
    postProgress('parse',8,'解析 SKP 材質、元件與 Face…');
    const parseOptions={
      onProgress:info=>{
        const ratio=Number(info?.total)>0?Number(info.current)/Number(info.total):0;
        postProgress('parse',8+ratio*35,`${stageText(info?.stage)} ${info?.current||0}/${info?.total||0}`);
      }
    };
    let model=openskp.parseSkp(buffer,parseOptions);
    postProgress('quantity',45,'計算材質面積與模型覆蓋率…');
    const summary=analyzeSkpModel(model,{includeHidden:false});

    // Keep just the lightweight material metadata needed to recover render
    // material names before dropping the raw model reference.
    const materialModel={materials:model.materials};
    model=null;

    postProgress('scene',52,'建立低負擔 Instanced 3D 預覽…');
    const sceneOptions={
      respectEdgeVisibility:true,
      onProgress:info=>{
        const ratio=Number(info?.total)>0?Number(info.current)/Number(info.total):0;
        postProgress('scene',52+ratio*30,`${stageText(info?.stage)} ${info?.current||0}`);
      }
    };
    const scene=openskp.buildInstancedScene(buffer,sceneOptions);
    const renderMaterialMap=mapSceneMaterials(materialModel,scene);
    const hiddenGuids=new Set(summary?.visibility?.hiddenInstanceGuids||[]);
    const hiddenLayers=new Set(summary?.visibility?.hiddenLayerNames||[]);

    postProgress('transfer',86,'整理 3D Viewer 資料…');
    const transfer=[];
    const resources=(scene.meshResources||[]).map(resource=>({
      id:resource.id,
      definitionName:String(resource.definitionName||''),
      primitives:(resource.primitives||[]).map(prim=>{
        transfer.push(prim.positions.buffer,prim.normals.buffer,prim.indices.buffer);
        return {positions:prim.positions,normals:prim.normals,indices:prim.indices,materialIndex:Number(prim.materialIndex||0)};
      })
    }));
    const materials=(scene.gltfMaterials||[]).map((gm,index)=>{
      const pbr=gm?.pbrMetallicRoughness||{};const f=pbr.baseColorFactor||[.58,.58,.58,1];const mapped=renderMaterialMap[index]||{};
      return {index,color:[Number(f[0]??.58),Number(f[1]??.58),Number(f[2]??.58),Number(f[3]??1)],doubleSided:!!gm?.doubleSided,alphaMode:String(gm?.alphaMode||'OPAQUE'),mappedName:String(mapped.name||''),confidence:String(mapped.confidence||'none'),candidates:Array.isArray(mapped.candidates)?mapped.candidates:[]};
    });
    const payload={
      fileName,
      summary,
      render:{bounds:scene.bounds||null,materials,resources,hierarchy:reduceHierarchy(scene.sceneHierarchy,hiddenGuids,hiddenLayers,true)},
      timingMs:Math.round(performance.now()-started),
      parser:{name:'OpenSKP',version:'1.3.0',mode:'browser-worker-instanced'}
    };
    postProgress('done',98,'完成');
    self.postMessage({type:'result',payload},transfer);
  }catch(err){
    self.postMessage({type:'error',error:safeError(err),fileName});
  }
});
