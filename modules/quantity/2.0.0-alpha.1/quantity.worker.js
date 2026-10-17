import { parseSkp } from 'https://cdn.jsdelivr.net/npm/openskp@1.3.0/+esm';
import earcut from 'https://cdn.jsdelivr.net/npm/earcut@3.2.4/+esm';
import { analyzeModel } from './quantity.engine.js';

const WASM_JS_URL='https://cdn.jsdelivr.net/gh/iamahsanmehmood/openskp@bff2f8dc7414173e744805bd5ea84e545df5dc7f/examples/web-viewer/wasm/openskp.js';
let busy=false,wasmPromise=null,activeJobId=null;
const report=(phase,percent,label='',extra={})=>self.postMessage({type:'progress',jobId:activeJobId,phase,percent,label,...extra});
const safeError=e=>({message:String(e?.message||e||'未知錯誤'),name:String(e?.name||'Error'),code:String(e?.code||'SKP_PARSE_FAILED')});

async function readFile(file){
  return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onprogress=e=>report('read',e.lengthComputable?Math.round(e.loaded/e.total*100):null,'讀取本機 SKP');
    reader.onerror=()=>reject(reader.error||new Error('無法讀取 SKP 檔案'));
    reader.onload=()=>resolve(reader.result);
    reader.readAsArrayBuffer(file);
  });
}
async function loadWasm(){
  if(!wasmPromise)wasmPromise=import(WASM_JS_URL).then(mod=>mod.default());
  return wasmPromise;
}
async function fullParse(file,buffer,options={}){
  report('parse',0,'解析 SketchUp 幾何／材質／Component');
  const model=parseSkp(buffer,{onProgress:info=>{
    if(Number(info?.total)>0)report('parse',Math.min(99,Math.round(Number(info.current||0)/Number(info.total)*100)),String(info.stage||'解析模型'));
    else report('parse',null,String(info?.stage||'解析模型'));
  }});
  report('quantity',0,'計算材質面積與智慧施工面');
  const result=analyzeModel(model,{earcut,preview:true,maxPlacedFaces:Number(options.maxPlacedFaces||4_000_000),progress:info=>report('quantity',null,info.label||`已計算 ${Number(info.current||0).toLocaleString()} 個面`)});
  report('quantity',100,'完整算量完成');
  const transfers=[];for(const g of result.previewGroups||[])if(g.positions?.buffer&&!transfers.includes(g.positions.buffer))transfers.push(g.positions.buffer);
  self.postMessage({type:'ready',jobId:activeJobId,mode:'full',result,file:{name:file.name,size:file.size}},transfers);
}
async function wasmSafeParse(file,buffer){
  report('wasm-load',null,'啟動大型模型 WASM 引擎');
  const Module=await loadWasm();
  report('wasm-parse',null,'WASM 正在解析大型 SKP；可隨時按取消');
  const started=performance.now();
  const result=Module.parseSkpToGLB(new Uint8Array(buffer));
  if(result?.error)throw new Error(result.error);
  const bytes=result?.glbBytes;
  if(!bytes?.byteLength)throw new Error('WASM 沒有產生可用的 GLB 預覽資料');
  const view=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes:new Uint8Array(bytes);
  report('wasm-transfer',96,'大型模型解析完成，移交 3D 預覽');
  self.postMessage({type:'ready',jobId:activeJobId,mode:'wasm-safe',file:{name:file.name,size:file.size},wasm:{faceCount:Number(result.faceCount||0),materialCount:Number(result.materialCount||0),componentCount:Number(result.componentCount||0),parseTimeMs:Number(result.parseTimeMs||performance.now()-started)},glb:view},[view.buffer]);
}

self.onmessage=async event=>{
  const msg=event.data||{};if(msg.type!=='load'||busy)return;busy=true;
  activeJobId=String(msg.jobId||'');const file=msg.file,mode=String(msg.mode||'full');
  try{
    if(!file||!/\.skp$/i.test(String(file.name||'')))throw new Error('請選擇 .skp 模型。');
    report('read',0,'讀取本機檔案');
    let buffer=await readFile(file);report('read',100,'本機檔案讀取完成');
    if(mode==='wasm-safe')await wasmSafeParse(file,buffer);else await fullParse(file,buffer,msg.options||{});
    buffer=null;
  }catch(err){self.postMessage({type:'error',jobId:activeJobId,error:safeError(err),mode,fileName:String(file?.name||'')});}
  finally{busy=false;}
};
