import {subscribeProgress,stages} from './sync.mjs';
export const roots = {
 stable: 'https://jason27252725-cpu.github.io/leaves-system/',
 sandbox: 'https://jason27252725-cpu.github.io/leaves-identity-sandbox/'
};
export const releasePattern = /^[a-z0-9][a-z0-9.-]{0,63}$/;
export async function publicRecord(environment) {
 const response = await fetch(roots[environment]+'site-publishing/current.json?at='+Date.now(),{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('讀取網站發布紀錄失敗。');
 const record=await response.json();
 if(record.schema!==1||record.environment!==environment||!releasePattern.test(record.releaseId||'')||!Array.isArray(record.history)||
  (record.entry===null ? record.releaseId!=='legacy' : (record.entry!=='site-releases/'+environment+'/'+record.releaseId+'/candidates/core/index.html'||!/^[a-f0-9]{64}$/.test(record.manifestHash))))
  throw Error('網站入口紀錄不符。');
 return record;
}
export async function checkRoot(environment,record) {
 const response=await fetch(roots[environment]+'?release-check='+Date.now(),{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('公開入口尚未就緒');
 const html=await response.text();
 if(record.entry&&!html.includes('location.replace('+JSON.stringify(record.entry)))throw Error('入口正等待部署');
 return true;
}
export function watchPublishedPage(environment) {
 const url=new URL(location.href);
 const match=url.pathname.match(/\/site-releases\/(stable|sandbox)\/([^/]+)\/candidates\/core\/index\.html$/);
 if(!roots[environment]||match?.[1]!==environment||url.searchParams.has('preview'))return;
 const running=match[2];
 let row=null,published=false,checking=false,again=false,navigating=false,alive=true;
 let panel,sub,timer,redirect,expiryTimer;
 const busy=()=>!!document.querySelector('[data-release-working]');
 const fresh=()=>row?.phase==='running' && Date.now()<Date.parse(row.updated_at)+100000;
 const relevant=()=>row && (row.source===running||published||row.target===running);
 const clear=()=>{panel?.remove();panel=null;};
 function show(target,percent,message){
  if(busy())return;
  if(!panel){
   panel=document.createElement('section');panel.id='releaseLiveMaintenance';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');
   panel.innerHTML='<div class="maintenance-shell"><h2>正式網站更新維護中</h2><p data-route></p><p data-step></p><div class="maintenance-meter"><progress max="100" aria-label="正式發布進度"></progress><strong data-percent></strong></div><div class="maintenance-stages"><div data-maint-stage="0">上傳檔案<small>等待中</small></div><div data-maint-stage="1">部署版本<small>等待中</small></div><div data-maint-stage="2">完成驗證<small>等待中</small></div></div><p class="maintenance-footer">更新完成後自動進入新版。</p></div>';
   if(environment==='sandbox')panel.querySelector('h2').textContent='沙盒網站更新中';
   Object.assign(panel.style,{position:'fixed',inset:'0',zIndex:'2147483646',display:'grid',placeItems:'center',background:'#101013f5',color:'white',padding:'24px'});
   panel.querySelector('progress').style.cssText='width:80%;margin:20px 12px 20px 0;accent-color:#b99ce4';
   document.body.append(panel);
  }
  panel.querySelector('[data-route]').textContent=running+' → '+target;
  panel.querySelector('progress').value=percent;
  panel.querySelector('[data-percent]').textContent=percent+'%';
  panel.querySelector('[data-step]').textContent=message;
  panel.querySelectorAll('[data-maint-stage]').forEach((n,i)=>{const end=[40,75,100][i],start=[0,40,75][i];n.querySelector('small').textContent=percent>=end?'✓ 已完成':percent>=start?'處理中':'待處理';});
 }
 function update(state){
  row=state;clearTimeout(expiryTimer);
  if(fresh()&&relevant()){
   if(redirect){clearTimeout(redirect);redirect=null;navigating=false;}
   show(row.target,row.progress,stages.get(row.progress)||'正在更新');
   expiryTimer=setTimeout(()=>{if(!fresh()){clear();void check();}},Math.max(1,Date.parse(row.updated_at)+100001-Date.now()));
  }else if(!navigating){
   if(row.phase!=='complete'||row.target===running||!relevant()||Date.now()-Date.parse(row.updated_at)>100000)clear();
   void check();
  }
 }
 async function check(){
  if(!alive||navigating||busy()||document.hidden)return;
  if(checking){again=true;return;}
  checking=true;
  try {
   if(fresh()&&relevant()){show(row.target,row.progress,stages.get(row.progress));return;}
   const record=await publicRecord(environment);
   if(record.releaseId===running){published=true;return;}
   if(!published && record.previousReleaseId!==running && !record.history.some(x=>x.releaseId===running) && row?.source!==running)return;
   await checkRoot(environment,record);
   if(!alive||busy()||(fresh()&&relevant()))return;
   navigating=true;show(record.releaseId,100,'入口已確認，正在開啟新版。');
   redirect=setTimeout(()=>{
    if(!alive||busy()||(fresh()&&relevant())){navigating=false;return;}
    location.replace(roots[environment]+'?release='+encodeURIComponent(record.releaseId));
   },850);
  }catch{}finally{checking=false;if(again){again=false;void check();}}
 }
 function wake(){if(!document.hidden){void sub?.refresh();void check();}}
 function start(){
  alive=true;
  if(environment==='stable')sub=subscribeProgress(update,()=>{if(panel&&!fresh()&&row?.phase==='running'&&!navigating){clear();void check();}});
  timer=setInterval(check,20000);
  if(sub)void sub.ready.then(check);else void check();
 }
 window.addEventListener('pagehide',()=>{alive=false;clearInterval(timer);clearTimeout(redirect);clearTimeout(expiryTimer);sub?.stop();clear();navigating=false;});
 window.addEventListener('pageshow',e=>{if(e.persisted)start();});
 document.addEventListener('visibilitychange',wake);
 window.addEventListener('focus',wake);window.addEventListener('online',wake);
 start();
}
