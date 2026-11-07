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
 const current=url.pathname.match(/\/site-releases\/(stable|sandbox)\/([^/]+)\/candidates\/core\/index\.html$/);
 if(!roots[environment]||current?.[1]!==environment||url.searchParams.has('preview'))return;
 let checking=false,navigating=false,wasPublished=false,timer=null,switchTimer=null;
 const paused=()=>document.hidden||!!document.querySelector('[data-release-working]');
 async function check(){
  if(checking||navigating||paused())return;
  checking=true;
  try{
   const record=await publicRecord(environment);
   if(current[2]===record.releaseId){wasPublished=true;return;}
   if(!wasPublished&&record.previousReleaseId!==current[2]&&!record.history.some(item=>item.releaseId===current[2]))return;
   await checkRoot(environment,record);
   const panel=document.getElementById('maintenanceOverlay');
   if(!panel||paused())return;
   navigating=true;
   const set=(id,value)=>{const node=document.getElementById(id);if(node)node.textContent=value;};
   set('maintenanceOverlayMessage',(environment==='stable'?'正式網站':'沙盒')+'已發布更新，正在切換至新入口。');
   set('maintenanceOverlayVersion',record.releaseId);
   set('maintenanceOverlayStartedAt',new Date().toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei'}));
   set('maintenanceOverlayHint','切換後請重新輸入通行碼。');
   for(const button of panel.querySelectorAll('button'))button.hidden=true;
   panel.classList.add('active');
   switchTimer=setTimeout(()=>location.replace(roots[environment]+'?release='+encodeURIComponent(record.releaseId)),2200);
  }catch{/* A transient public-read failure is retried on the next check. */}
  finally{checking=false;}
 }
 function start(){if(timer===null)timer=setInterval(check,20000);void check();}
 start();
 document.addEventListener('visibilitychange',check);
 window.addEventListener('pagehide',()=>{clearInterval(timer);timer=null;});
 window.addEventListener('pageshow',e=>{if(e.persisted){clearTimeout(switchTimer);navigating=false;start();}});
}
