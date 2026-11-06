import {mountProductionHandoff} from './production-handoff.mjs';
import {el,button,select,dialog,busy,errorText} from '../shared/dom.mjs';
export function mountSiteRoute(root,api,{authorize=()=>{},onProgress=()=>{},candidateTarget=root}={}){
 const stable=api.person()?.environment==='stable',environment=stable?'stable':'sandbox',label=stable?'正式版':'沙盒版',epoch=api.epoch();
 const initial=new URL(import.meta.url).pathname.match(/\/site-releases\/(?:sandbox|stable)\/([^/]+)\//)?.[1]||'';
 const card=el('section',{class:'li-card'}),status=el('p',{class:'li-status',role:'status'}),release=select('發布／回滾：選擇版本',[[initial,'這次更新版本']],initial);
 let disposed=false,sequence=0,confirmation=null;
 const check=()=>{if(disposed||!root.isConnected||api.epoch()!==epoch||api.person()?.environment!==environment||!api.can('technical.release'))throw Error('登入或發布權限已變更，請重新開啟窗口');};
 const invalidate=()=>{sequence++;confirmation?.close();confirmation=null;};
 const current=seq=>{check();if(sequence!==seq)throw Error('版本選擇已變更，請重新核對');};
 release.input.addEventListener('change',invalidate);
 const offer=id=>{if(disposed||!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(id||''))return;invalidate();if(![...release.input.options].some(o=>o.value===id))release.input.append(el('option',{value:id},id));release.input.value=id;};
 const receive=e=>offer(e.detail?.releaseId);candidateTarget.addEventListener('leaves:update-candidate',receive);
 const read=button('讀取目前網站版本',()=>busy(read,status,async()=>{check();const selected=await api.router({action:'read'});check();if(selected.environment!==environment)throw Error('版本環境不符');offer(selected.releaseId);status.textContent='目前版本：'+(selected.releaseId||'尚未啟用')+' · 第 '+selected.revision+' 次設定';}));
 const prepare=button('核對選定版本（發布／回滾）',()=>busy(prepare,status,async()=>{
  check();authorize();invalidate();const seq=sequence,target=release.input.value;
  if(!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(target))throw Error('請先選擇版本');
  onProgress(null,'伺服器逐檔核對中');
  try{
   const selected=await api.router({action:'read'});current(seq);authorize();if(selected.environment!==environment)throw Error('版本環境不符');
   status.textContent='正在逐一核對公開網站、模組和後端；尚未切換入口。';
   const r=await api.router({action:'plan',payload:{releaseId:target,expectedRevision:selected.revision,reason:'由更新中心確認版本切換，操作者與時間由系統記錄'}},true);current(seq);authorize();
   if(r.preview?.toRelease!==target||!r.planId)throw Error('伺服器核對版本不符');
   onProgress(3,'伺服器核對完成，等待明確確認');status.textContent='版本已核對，請查看確認視窗';
   const d=dialog('確認切換'+label+'版本',{close:()=>{if(confirmation===d)confirmation=null;}});confirmation=d;
   d.content.append(el('p',{},(r.preview.fromRelease||'尚未啟用')+' → '+r.preview.toRelease),el('p',{},'已核對 '+r.preview.fileCount+' 個網站檔案及五個模組。'+(stable?'只更新獨立預覽版本；正式官網入口未切換。':'此操作僅影響沙盒版。')));
   const commit=button('確認切換'+label,()=>busy(commit,d.status,async()=>{
    current(seq);authorize();if(confirmation!==d)throw Error('確認已關閉，請重新核對');commit.dataset.locked='true';
    try{
     await api.router({action:'commit',payload:{planId:r.planId,confirm:'CONFIRM_SITE_ROUTE'}},true);current(seq);
     const route=await api.router({action:'read'});current(seq);
     if(route.environment!==environment||route.releaseId!==target||route.entry!==`site-releases/${environment}/${target}/candidates/core/index.html`)throw Error('入口仍未確認，請重新讀取狀態');
     status.replaceChildren(el('span',{},'版本已核對：'+route.releaseId+'。目前視窗保留，請另開已核對版本登入。'));
     const next=new URL(route.entry,'https://jason27252725-cpu.github.io/leaves-identity-sandbox/');
     status.append(el('a',{href:next.href,target:'_blank',rel:'noopener',class:'li-primary'},'開啟已核對版本'));onProgress(4,'預覽路由已切換；請開啟已核對版本');d.close();
    }catch(e){if(!disposed){onProgress(3,'切換結果尚未確認，請讀取目前版本');d.status.textContent=errorText(e)+' 請關閉後讀取目前版本，勿重複切換。';}}
   }),'li-primary');d.content.append(commit);
  }catch(e){if(!disposed)onProgress(2,'伺服器核對未完成：'+errorText(e));throw e;}
 }));
 card.append(el('h2',{},label+'版本發布與回復'),el('p',{class:'li-note'},'上傳候選並完成部署後，選擇版本核對並確認。回復歷史版本也使用同一流程。'),release.node,el('div',{class:'li-actions'},read,prepare),status);root.append(card);
 const handoff=mountProductionHandoff(root,api);
 api.router({action:'history'}).then(h=>{check();for(const v of h.versions||[])if(/^[a-z0-9][a-z0-9.-]{0,63}$/.test(v.release_id||'')&&![...release.input.options].some(o=>o.value===v.release_id))release.input.append(el('option',{value:v.release_id},v.release_id+' · '+String(v.created_at||'').slice(0,10)));}).catch(()=>{});
 return{offer,invalidate,dispose(){disposed=true;invalidate();candidateTarget.removeEventListener('leaves:update-candidate',receive);handoff.dispose();card.remove();}};
}
