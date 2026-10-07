import { createQuantityViewer } from './quantity.viewer.js';
import { attachQuantityWindow } from './quantity.window.js';
import { buildAiQuantityContext, runQuantityEngineSelfTest } from './quantity.engine.js';

export const QUANTITY_WORKSPACE_VERSION='0.1.0';
const SOFT_BYTES=20*1024*1024,HARD_CONFIRM_BYTES=50*1024*1024,ABSOLUTE_MAX_BYTES=80*1024*1024;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmtBytes=n=>`${(Number(n||0)/1024/1024).toFixed(1)} MB`;

export function createQuantityWorkspace(context){
  let root=null,viewer=null,worker=null,windowApi=null,current=null,currentFile=null,openState=false,selectedMaterial='',activeTab='materials',query='',loadNonce=0;
  let highlightable=new Set();

  function status(text,tone='neutral'){const el=root?.querySelector('[data-q-role="status"]');if(el){el.textContent=String(text||'');el.dataset.tone=tone;}}
  function progress(percent,detail=''){const wrap=root?.querySelector('.quantity-progress'),bar=root?.querySelector('.quantity-progress-bar'),label=root?.querySelector('[data-q-role="progress-label"]');if(wrap)wrap.hidden=false;if(bar)bar.style.width=`${Math.max(0,Math.min(100,Number(percent)||0))}%`;if(label)label.textContent=String(detail||'處理中…');}
  function hideProgress(){const wrap=root?.querySelector('.quantity-progress');if(wrap)wrap.hidden=true;}

  function ensureRoot(){
    if(root?.isConnected)return root;
    root=document.createElement('section');root.className='quantity-workspace';root.id='leavesQuantityWorkspace';root.innerHTML=`
      <header class="quantity-header" data-q-role="header">
        <div class="quantity-title-wrap"><div class="quantity-kicker">LEAVES · LOCAL SKP READER</div><div class="quantity-title"><i class="fa-solid fa-cube"></i><strong>3D 算量</strong><span data-q-role="file-name">尚未載入 SKP</span></div></div>
        <div class="quantity-head-actions">
          <button type="button" data-q-action="open"><i class="fa-solid fa-folder-open"></i> 開啟 SKP</button>
          <button type="button" data-q-action="fit" disabled><i class="fa-solid fa-expand"></i> 置中</button>
          <button type="button" data-q-action="clear" disabled><i class="fa-solid fa-broom"></i> 清除</button>
          <button type="button" class="quantity-close" data-q-action="close" title="關閉"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </header>
      <div class="quantity-progress" hidden><div class="quantity-progress-track"><div class="quantity-progress-bar"></div></div><span data-q-role="progress-label">準備解析…</span></div>
      <main class="quantity-main">
        <div class="quantity-viewer-pane" data-q-role="viewer-pane">
          <div class="quantity-viewer" data-q-role="viewer">
            <div class="quantity-empty" data-q-role="empty"><i class="fa-solid fa-cubes-stacked"></i><strong>把 .skp 拖進這裡</strong><span>模型只在目前瀏覽器記憶體中解析，不上傳 Supabase、不永久保存。</span><button type="button" data-q-action="open-empty">選擇 SKP</button></div>
          </div>
          <div class="quantity-selection" data-q-role="selection" hidden></div>
          <div class="quantity-viewer-toolbar" data-q-role="viewer-toolbar" hidden><button type="button" data-q-action="show-all">全部顯示</button><span data-q-role="filter-label">模型全覽</span></div>
        </div>
        <aside class="quantity-side">
          <div class="quantity-tabs"><button type="button" data-q-tab="materials" class="active">材料</button><button type="button" data-q-tab="model">模型</button></div>
          <div class="quantity-summary" data-q-role="summary"><div><span>材質</span><strong>--</strong></div><div><span>Faces</span><strong>--</strong></div><div><span>覆蓋率</span><strong>--</strong></div></div>
          <div class="quantity-material-tools" data-q-role="material-tools" hidden><input type="search" data-q-role="search" placeholder="搜尋材質…"><button type="button" data-q-action="show-all-side" title="清除材質篩選"><i class="fa-solid fa-eye"></i></button></div>
          <div class="quantity-side-scroll" data-q-role="side-scroll"><div class="quantity-side-empty">載入 SKP 後會在這裡列出材質與模型幾何面積。</div></div>
        </aside>
      </main>
      <footer class="quantity-footer"><span data-q-role="status">就緒 · Direct Reader 0.1.0</span><span>面積是模型幾何估算，不等於採購片數。</span></footer>
      <input type="file" accept=".skp" data-q-role="file-input" hidden>`;
    document.body.appendChild(root);
    bind();windowApi=attachQuantityWindow(root,root.querySelector('[data-q-role="header"]'),context,{defaultWidth:1000,defaultHeight:730,minWidth:620,minHeight:480});
    return root;
  }

  function bind(){
    root.addEventListener('click',async e=>{
      const action=e.target.closest('[data-q-action]')?.dataset.qAction;
      if(action==='open'||action==='open-empty')root.querySelector('[data-q-role="file-input"]')?.click();
      if(action==='fit')viewer?.fit?.();
      if(action==='clear')clearModel();
      if(action==='close')close();
      if(action==='show-all'||action==='show-all-side'){selectedMaterial='';viewer?.resetMaterialFilter?.();renderFilterLabel();renderMaterials();}
      const tab=e.target.closest('[data-q-tab]')?.dataset.qTab;if(tab){activeTab=tab;root.querySelectorAll('[data-q-tab]').forEach(b=>b.classList.toggle('active',b.dataset.qTab===tab));renderSide();}
      const mat=e.target.closest('[data-q-material]')?.dataset.qMaterial;if(mat){selectedMaterial=mat;const ok=viewer?.focusMaterial?.(mat);renderFilterLabel(ok?mat:`${mat} · 無法可靠分離`);renderMaterials();}
    });
    const input=root.querySelector('[data-q-role="file-input"]');input.addEventListener('change',()=>{const file=input.files?.[0];input.value='';if(file)openFile(file);});
    const search=root.querySelector('[data-q-role="search"]');search.addEventListener('input',()=>{query=search.value||'';renderMaterials();});
    const pane=root.querySelector('[data-q-role="viewer-pane"]');
    pane.addEventListener('dragover',e=>{if([...(e.dataTransfer?.items||[])].some(i=>i.kind==='file')){e.preventDefault();root.classList.add('is-file-dragover');}});
    pane.addEventListener('dragleave',()=>root.classList.remove('is-file-dragover'));
    pane.addEventListener('drop',e=>{e.preventDefault();root.classList.remove('is-file-dragover');const file=[...(e.dataTransfer?.files||[])].find(f=>/\.skp$/i.test(f.name));if(file)openFile(file);else status('只接受 .skp 檔案','warn');});
  }

  async function ensureViewer(){
    if(viewer)return viewer;
    const holder=root.querySelector('[data-q-role="viewer"]');holder.querySelector('[data-q-role="empty"]')?.remove();status('載入 3D Viewer…');
    viewer=await createQuantityViewer(holder,{onSelect:renderSelection,onReady:info=>{highlightable=new Set(info?.highlightableMaterials||[]);renderMaterials();}});return viewer;
  }

  function renderSelection(info){
    const el=root?.querySelector('[data-q-role="selection"]');if(!el)return;if(!info){el.hidden=true;el.innerHTML='';return;}el.hidden=false;const pos=(info.positionMm||[0,0,0]).map(v=>Number(v||0).toFixed(0)).join(', ');el.innerHTML=`<strong>${esc(info.nodeName||info.definitionName||'物件')}</strong><span>${esc(info.materialName||'材質未能唯一對應')} · ${esc(info.layer||'Layer0')}</span><small>${esc(info.path||'')} · ${esc(pos)} mm</small>`;
  }

  function renderSummary(){
    const box=root?.querySelector('[data-q-role="summary"]');if(!box)return;const s=current?.summary;if(!s){box.innerHTML='<div><span>材質</span><strong>--</strong></div><div><span>Faces</span><strong>--</strong></div><div><span>覆蓋率</span><strong>--</strong></div>';return;}box.innerHTML=`<div><span>材質</span><strong>${s.materials.length}</strong></div><div><span>Faces</span><strong>${s.stats.faceCounted}</strong></div><div><span>覆蓋率</span><strong>${s.coverage.coveragePercent}%</strong></div>`;
  }
  function renderFilterLabel(text){const el=root?.querySelector('[data-q-role="filter-label"]');if(el)el.textContent=text||'模型全覽';}

  function renderMaterials(){
    if(activeTab!=='materials')return;const scroll=root?.querySelector('[data-q-role="side-scroll"]');if(!scroll)return;const s=current?.summary;if(!s){scroll.innerHTML='<div class="quantity-side-empty">載入 SKP 後會在這裡列出材質與模型幾何面積。</div>';return;}
    const q=query.trim().toLowerCase();const rows=s.materials.filter(m=>!q||`${m.name} ${m.category}`.toLowerCase().includes(q));
    const warning=s.coverage.unpaintedFaces?`<button type="button" class="quantity-diagnostic"><i class="fa-solid fa-triangle-exclamation"></i><span><b>未指定材質</b><small>${s.coverage.unpaintedAreaM2.toFixed(2)} m² · ${s.coverage.unpaintedFaces} faces</small></span></button>`:'';
    scroll.innerHTML=`${warning}${rows.map(m=>{const active=selectedMaterial===m.name;const can=highlightable.has(m.name);const c=m.color||{r:128,g:128,b:128};return `<button type="button" class="quantity-material-card ${active?'is-active':''} ${can?'':'is-unmapped'}" data-q-material="${esc(m.name)}" title="${can?'點擊在 3D 中顯示':'面積可計算；3D 材質因同色/外觀對應不唯一，第一版無法可靠單獨 Highlight'}"><i style="--swatch:rgb(${c.r},${c.g},${c.b})"></i><span class="quantity-material-copy"><b>${esc(m.name)}</b><small>${esc(m.category)} · ${m.faceCount} faces · ${m.objectCount} objects</small>${m.backFallbackAreaM2>0?`<em>含 ${m.backFallbackAreaM2.toFixed(2)} m² 背面材質 fallback</em>`:m.backSecondaryAreaM2>0?`<em>背面另記 ${m.backSecondaryAreaM2.toFixed(2)} m²（未併入主面積）</em>`:''}</span><span class="quantity-material-area"><strong>${m.areaM2.toFixed(2)}</strong><small>m²</small>${can?'':'<em>3D↗?</em>'}</span></button>`;}).join('')||'<div class="quantity-side-empty">沒有符合搜尋條件的材質。</div>'}`;
  }

  function renderModelInfo(){
    if(activeTab!=='model')return;const scroll=root?.querySelector('[data-q-role="side-scroll"]');const s=current?.summary;if(!scroll)return;if(!s){scroll.innerHTML='<div class="quantity-side-empty">尚未載入模型。</div>';return;}const b=current?.render?.bounds;const size=b?.size||[0,0,0];scroll.innerHTML=`<div class="quantity-info-grid"><div><span>SKP 版本</span><strong>${esc(s.version)}</strong></div><div><span>模型單位</span><strong>${esc(s.units)}</strong></div><div><span>Definitions</span><strong>${s.stats.definitionCount}</strong></div><div><span>Instances</span><strong>${s.stats.instanceCount}</strong></div><div><span>Layers</span><strong>${s.stats.layerCount}</strong></div><div><span>材質庫</span><strong>${s.stats.materialCount}</strong></div></div><div class="quantity-info-card"><b>模型尺寸（3D Bounds）</b><span>${size.map(v=>Number(v||0).toFixed(2)).join(' × ')} m</span></div><div class="quantity-info-card"><b>材質健檢</b><span>已指定材質 ${s.coverage.coveragePercent}%</span><span>未指定 ${s.coverage.unpaintedAreaM2.toFixed(2)} m² / ${s.coverage.unpaintedFaces} faces</span><span>正反面不同材質 ${s.coverage.backDifferentFaces} faces</span><span>隱藏 faces 略過 ${s.stats.hiddenFacesSkipped}</span></div><div class="quantity-info-note">目前 v0.1 的主要面積以 Face 正面材質計算；如果只有背面有材質，會作為 fallback 計入並標記。正反面不同材質時不重複加總。</div>`;
  }
  function renderSide(){const tools=root?.querySelector('[data-q-role="material-tools"]');if(tools)tools.hidden=activeTab!=='materials'||!current;if(activeTab==='materials')renderMaterials();else renderModelInfo();}

  function updateButtons(loaded){root?.querySelectorAll('[data-q-action="fit"],[data-q-action="clear"]').forEach(b=>b.disabled=!loaded);const tools=root?.querySelector('[data-q-role="viewer-toolbar"]');if(tools)tools.hidden=!loaded;}

  function terminateWorker(){if(worker){worker.terminate();worker=null;}}
  function clearModel(){
    loadNonce++;terminateWorker();viewer?.dispose?.();viewer=null;current=null;currentFile=null;selectedMaterial='';highlightable.clear();query='';const search=root?.querySelector('[data-q-role="search"]');if(search)search.value='';
    const holder=root?.querySelector('[data-q-role="viewer"]');if(holder)holder.innerHTML='<div class="quantity-empty" data-q-role="empty"><i class="fa-solid fa-cubes-stacked"></i><strong>把 .skp 拖進這裡</strong><span>模型只在目前瀏覽器記憶體中解析，不上傳 Supabase、不永久保存。</span><button type="button" data-q-action="open-empty">選擇 SKP</button></div>';
    const name=root?.querySelector('[data-q-role="file-name"]');if(name)name.textContent='尚未載入 SKP';renderSelection(null);renderSummary();renderSide();renderFilterLabel('模型全覽');updateButtons(false);hideProgress();status('已清除模型 · 記憶體已釋放','neutral');
  }

  async function parseFile(file){
    const nonce=++loadNonce;terminateWorker();viewer?.dispose?.();viewer=null;current=null;selectedMaterial='';highlightable.clear();updateButtons(false);renderSelection(null);renderSummary();renderSide();
    const name=root.querySelector('[data-q-role="file-name"]');name.textContent=file.name;currentFile=file;status(`讀取 ${file.name} · ${fmtBytes(file.size)}`);progress(1,'讀取本機檔案…');
    const buffer=await file.arrayBuffer();if(nonce!==loadNonce)return;
    const workerUrl=new URL('./quantity.worker.js',import.meta.url);worker=new Worker(workerUrl,{type:'module',name:'leaves-skp-reader'});
    worker.addEventListener('message',async e=>{if(nonce!==loadNonce)return;const msg=e.data||{};if(msg.type==='progress'){progress(msg.percent,msg.detail);return;}if(msg.type==='error'){hideProgress();status(`SKP 解析失敗：${msg.error?.message||'Unknown error'}`,'error');root.classList.add('has-error');terminateWorker();return;}if(msg.type==='result'){
      current={...msg.payload,fileName:file.name,fileSize:file.size};terminateWorker();progress(99,'建立 3D Viewer…');try{const v=await ensureViewer();if(nonce!==loadNonce)return;v.load(current.render);hideProgress();root.classList.remove('has-error');renderSummary();renderSide();updateButtons(true);status(`完成 · ${file.name} · ${current.summary.materials.length} 材質 · ${current.timingMs} ms`,'success');}catch(err){hideProgress();status(`3D Viewer 載入失敗：${err?.message||err}`,'error');}
    }});
    worker.addEventListener('error',e=>{if(nonce!==loadNonce)return;hideProgress();status(`SKP Worker 發生錯誤：${e.message||'Unknown error'}`,'error');terminateWorker();});
    worker.postMessage({type:'parse',buffer,fileName:file.name},[buffer]);
  }

  async function openFile(file){
    ensureRoot();open();if(!file||!/\.skp$/i.test(String(file.name||''))){status('請選擇 .skp SketchUp 檔案','warn');return{ok:false,code:'FILE_TYPE'};}
    if(file.size>ABSOLUTE_MAX_BYTES){await context.ui?.alert?.(`這個 SKP 為 ${fmtBytes(file.size)}。\n\nDirect Reader v0.1 為了避免瀏覽器記憶體爆掉，暫時限制 80 MB 以下。建議先用較精簡的模型測試。`,'SKP 太大');return{ok:false,code:'FILE_TOO_LARGE'};}
    if(file.size>=HARD_CONFIRM_BYTES){const ok=await context.ui?.confirm?.(`這個 SKP 為 ${fmtBytes(file.size)}。\n\n大型 SketchUp 模型在瀏覽器解析仍可能吃掉很多記憶體。解析會放在 Worker，不會故意卡住 LEAVES 主介面，但仍可能需要較久時間。\n\n要繼續嗎？`,'大型 SKP 模型');if(!ok)return{ok:false,code:'USER_CANCEL'};}
    if(file.size>=SOFT_BYTES)status(`大型模型 ${fmtBytes(file.size)} · 已使用背景 Worker 解析`,'warn');
    await parseFile(file);return{ok:true};
  }

  function open(){ensureRoot();openState=true;root.classList.add('is-open');windowApi?.raise?.();context.ui?.setRailActiveByAction?.('quantity');return{ok:true};}
  function close(){if(!root)return;openState=false;clearModel();root.classList.remove('is-open');context.ui?.setRailActiveByAction?.('chat');}
  function dispose(){loadNonce++;terminateWorker();viewer?.dispose?.();viewer=null;windowApi?.cleanup?.();windowApi=null;root?.remove?.();root=null;current=null;currentFile=null;openState=false;highlightable.clear();}
  function getAiContext(text=''){
    if(!openState||!current?.summary)return '';
    const q=String(text||'').trim().toLowerCase();const modelIntent=!q||/skp|3d|模型|材質|材料|面積|木皮|玻璃|鏡|油漆|漆|石材|磁磚|板材|算量|多少|face|component|group|物件|這個/.test(q);
    if(!modelIntent)return '';
    return buildAiQuantityContext(current,{maxMaterials:24});
  }
  function getStatus(){return{version:QUANTITY_WORKSPACE_VERSION,open:openState,loaded:!!current,fileName:current?.fileName||null,fileSize:current?.fileSize||0,materials:current?.summary?.materials?.length||0,worker:!!worker,viewer:!!viewer};}
  function selfTest(){const engine=runQuantityEngineSelfTest();return{ok:engine.ok&&typeof Worker!=='undefined'&&typeof ResizeObserver!=='undefined',engine,features:{worker:typeof Worker!=='undefined',resizeObserver:typeof ResizeObserver!=='undefined',webgl:!!document.createElement('canvas').getContext('webgl2')||!!document.createElement('canvas').getContext('webgl')}};}

  return Object.freeze({open,close,openFile,clearModel,dispose,getAiContext,getStatus,selfTest});
}
