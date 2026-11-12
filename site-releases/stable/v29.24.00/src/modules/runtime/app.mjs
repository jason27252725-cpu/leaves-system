import {openReportAction} from './report-action.mjs';
import {tracing,recordAttempt,clearDiagnostics} from './admin-heritage.mjs';
import './ui-unification.mjs';
import {reauthenticateOwner} from './release-auth.mjs';
import {openDailyWindow,openTeamDay} from './daily-window.mjs';
import {createIdentityClient} from '../identity/identity-client.mjs';
import {createDraftVault} from '../shared/draft-vault.mjs';
import {installCoreApi} from '../shared/core-api.mjs';
import {createIdentityCost} from '../shared/cost-adapter.mjs';
import {bundledModules} from './bundled-modules.mjs';
import {createModuleSwitch} from './module-switch.mjs';
import {prepareIdentityHandover} from './identity-handover.mjs';
import {loadFoundation} from './module-loader.mjs';
import {checkFoundationUpdates} from './foundation-updates.mjs';
import {startFoundationPoll} from './foundation-poll.mjs';
import {completionResponse} from '../shared/ai-bridge.mjs';
import {startPresence} from './presence.mjs';
import {mountAdmin,canOpenAdmin} from './admin.mjs';
const switches=createModuleSwitch(bundledModules);let screenSequence=0;
import {el,button,dialog,errorText,roles} from '../shared/dom.mjs';
import {mountUpdates} from './updates.mjs';
const client=createIdentityClient(),vault=createDraftVault(localStorage);let hook=null,screen=null,screenMount=null,sessionEpoch=0,refreshing=false;

function queueDraftName(){
 let tab=sessionStorage.getItem('leaves-chat-tab');
 if(!tab){tab=crypto.randomUUID();sessionStorage.setItem('leaves-chat-tab',tab);}
 return 'chat-queue-'+client.snapshot()?.person?.environment+'-'+tab;
}
async function offerRecovery(){
 const person=api.person(),at=sessionEpoch;
 const key=queueDraftName(),draft=await vault.load(key).catch(()=>null);
 if(!draft||sessionEpoch!==at)return;
 if(draft.expires<=Date.now()||draft.revision!==person.revision||draft.scope!==JSON.stringify(person.permissions)){vault.remove(key);return;}
 const notice=el('aside',{class:'li-card',id:'leavesPendingQuestion'},el('p',{},'上次的聊天問題仍在等待。'));
 Object.assign(notice.style,{position:'fixed',bottom:'18px',right:'18px',zIndex:'10100'});
 notice.append(button('繼續等待',async()=>{
   if(sessionEpoch!==at)return;
   if(window.dispatchEvent(new CustomEvent('leaves:resume-question',{detail:draft,cancelable:true})))notice.remove();
 }),button('取消等待',()=>{notice.remove();vault.remove(key);api.read('ai.queue.cancel',{job:draft.payload.requestId}).catch(()=>{});}));
 document.body.append(notice);
}
export async function resumeQueued(draft,signal,notify){
 const p=api.person();if(!p||draft.revision!==p.revision)throw Error('STALE_SESSION');
 return sendQueued(draft.payload,signal,notify,true);
}
async function sendQueued(payload,signal,notify,inspectFirst=false){
 const at=sessionEpoch,key=queueDraftName(),revision=api.person()?.revision;
 const call=(action,body,stop)=>guarded(()=>client.call(action,body,{mutation:false,signal:stop}));
 const job=payload.requestId;
 const start=Date.now(),scope=JSON.stringify(api.person()?.permissions);let waited=false;
 const track=state=>{
   if(state)waited=true;
   notify?.(state);
   if(state&&tracing())recordAttempt(job.replace(/-a[1-3]$/,''),payload.attempt,{...state.diagnostics,modelCalls:state.diagnostics?.modelCalls??0,queries:state.diagnostics?.queries??0,events:[...(state.diagnostics?.events||[]),{kind:'等待 '+state.reason,ms:Date.now()-start}]},'排隊中',Date.now()-start);
 };
 try{
  const result=await driveChatQueue({signal,inspectFirst,notify:track,
   send:async()=>{
    if(waited||inspectFirst){const latest=await guarded(()=>client.refresh({visible:true}));if(sessionEpoch!==at||latest.person.revision!==revision||JSON.stringify(latest.person.permissions)!==scope)throw Object.assign(Error('STALE_SESSION'),{code:'STALE_SESSION'});}
    const result=await call('ai.chat',payload,signal);if(result.queue&&result.diagnostics)result.queue.diagnostics=result.diagnostics;return result;},
   status:()=>call('ai.queue.status',{job},signal),cancel:()=>call('ai.queue.cancel',{job}),
   remember:()=>vault.save(key,{payload,revision,expires:Date.now()+86400000,scope:JSON.stringify(api.person()?.permissions)}).catch(()=>{})});
  if(at===sessionEpoch)vault.remove(key);return result;
 }catch(e){if(at===sessionEpoch&&(signal?.aborted||!['SERVICE_UNAVAILABLE','AUTH_REQUIRED'].includes(e.code)))vault.remove(key);throw e;}
}
const reportActions=new Map();
document.addEventListener('click',event=>{const link=event.target.closest?.('a[href^="#leaves-report-"]');if(!link)return;const item=reportActions.get(link.getAttribute('href'));if(!item)return;event.preventDefault();if(item.epoch===sessionEpoch)openReportAction(api,item.action).catch(e=>alert(errorText(e)));});
let lastQuery=null;const deadlines=new Map();
function resetQuery(){reportActions.clear();clearDiagnostics();lastQuery=null;deadlines.clear();}
function endUI(){document.querySelector('#leavesPendingQuestion')?.remove();resetQuery();sessionEpoch++;screenSequence++;for(const d of [...document.querySelectorAll('.li-dialog')])d.close();screenMount?.dispose();screenMount=null;screen?.close();screen=null;vault.lock();hook?.clear();}
async function guarded(fn){try{return await fn();}catch(e){if(['AUTH_REQUIRED','AUTH_REVOKED'].includes(e.code)){client.forget();endUI();}throw e;}}
export const api=installCoreApi({chat:(text,options)=>chat(text,options),person:()=>client.snapshot()?.person||null,can:k=>!!client.snapshot()?.person?.permissions?.[k],read:(a,p={})=>guarded(()=>client.call(a,p,{mutation:false})),
 publicStatus:()=>client.status(),
 write:(a,p={})=>guarded(()=>client.call(a,p,{mutation:true})),
 progress:(a,p={},write=false,options={})=>guarded(()=>client.call('progress',{...p,action:a},{mutation:write,signal:options.signal})),watchTeamDay:(date,options)=>guarded(()=>client.watchTeamDay(date,options)),openTeamChat:(date,role)=>window.dispatchEvent(new CustomEvent('leaves:team-query',{detail:{date,role}})),cost:(a,p={},write=false)=>guarded(()=>client.call('cost',{...p,action:a},{mutation:write})),
 workspace:(a,p={},write=false)=>guarded(()=>client.call('workspace',{...p,action:a},{mutation:write})),plan:p=>guarded(()=>client.plan(p)),confirm:(id,c)=>guarded(()=>client.confirm(id,c)),cancelPreview:()=>client.cancelPreview(),drafts:vault,
 reauthenticate:code=>reauthenticateOwner({client,epoch:()=>sessionEpoch,createClient:createIdentityClient,code}),
 publisher:(body,write=false)=>guarded(()=>client.service('publisher',body,{mutation:write})),
 release:(body,write=false)=>guarded(()=>client.service('release',body,{mutation:write})),router:(body,write=false)=>guarded(()=>client.service('router',body,{mutation:write})),epoch:()=>sessionEpoch});
export const costs=createIdentityCost(api);
export function attachCore(bridge){hook=bridge;hook.clear();}
export async function login(code){endUI();const e=++sessionEpoch;try{const s=await client.login(code);window.dispatchEvent(new CustomEvent('leaves:auth-stage',{detail:{stage:1,label:'載入介面'}}));await vault.unlock(code,s.person.employeeId);window.dispatchEvent(new CustomEvent('leaves:auth-stage',{detail:{stage:2,label:'準備工作區'}}));if(e!==sessionEpoch)throw Error('登入已變更');if(switches.pending().identity){try{await loadFoundation(switches.pending().identity);if(e!==sessionEpoch)throw Error('登入已變更');prepareIdentityHandover(switches);}catch(err){if(e!==sessionEpoch)throw err;alert('新版身分畫面尚未通過載入檢查，繼續使用原版：'+errorText(err));}}hook?.authenticated(s.person);await refresh();await offerRecovery().catch(()=>{});return s;}catch(err){if(e===sessionEpoch){client.forget();endUI();}throw err;}}
export async function logout(){endUI();let err;try{await client.logout();}catch(e){err=e;}finally{client.forget();}if(err)throw err;}
export async function refresh({visible=!document.hidden}={}){if(refreshing||!api.person())return;refreshing=true;try{const before=api.person(),s=await guarded(()=>client.refresh({visible}));if(before.revision!==s.person.revision||JSON.stringify(before.permissions)!==JSON.stringify(s.person.permissions)){resetQuery();for(const d of [...document.querySelectorAll('.li-dialog')])d.close();screenMount?.dispose();screenMount=null;screen?.close();screen=null;hook?.permissionsChanged?.();}hook?.authenticated(s.person);hook?.maintenance?.(s.maintenance);}finally{refreshing=false;}}
export async function open(section='workforce'){
 if(section==='people')return hook?.openAdmin?.('passcodes');
 if(section==='updates')return hook?.openAdmin?.('releaseCenter');
 if(!api.person())throw Error('請先登入');
 if(screen?.box?.open){screen.box.focus();window.LeavesWindowStack?.raise(screen.box);return;}
 const sequence=++screenSequence;await refresh();if(sequence!==screenSequence)return;
 const root=el('section',{class:'li-shell'}),at=sessionEpoch;
 const d=dialog('進度與工時',{modal:false,width:1100,height:730,close:()=>{screenSequence++;screenMount?.dispose();screenMount=null;screen=null;}});
 screen=d;d.box.id='leavesIdentityWorkspace';d.box.classList.add('li-workspace-window');d.content.append(root);
 window.LeavesWindowStack?.register(d.box);window.LeavesWindowStack?.raise(d.box);
 d.box.addEventListener('pointerdown',()=>window.LeavesWindowStack?.raise(d.box));
 try{
  const descriptor=switches.pending().workforce||switches.current('workforce');let module;
  try{module=await loadFoundation(descriptor);if(at===sessionEpoch)switches.adopt('workforce',{safe:true});}
  catch{module=await loadFoundation(switches.current('workforce'));}
  if(at!==sessionEpoch||sequence!==screenSequence)return;
  const mounted=await module.mount(root,api);
  if(at!==sessionEpoch||sequence!==screenSequence){mounted?.dispose();return;}
  screenMount=mounted;
 }catch(e){d.status.textContent=errorText(e);}
}
export async function chat(text,{signal,report}={}){const requestId=crypto.randomUUID(),start=Date.now();
 const diagnostics=tracing()&&api.person()?.environment==='sandbox'&&api.person()?.role==='owner';
 try{
  const result=await guarded(()=>client.call('ai.chat',{messages:[{role:'user',content:text}],requestId,attempt:1,...(report?{report,reportTools:1}:{}),...(diagnostics?{diagnostics:1}:{})},{mutation:false,signal}));
  if(diagnostics)recordAttempt(requestId,1,result.diagnostics,null,Date.now()-start);
  return result;
 }catch(e){if(diagnostics)recordAttempt(requestId,1,e.diagnostics,e.code,Date.now()-start);throw e;}
}
export async function chatResponse(messages,{requestId=crypto.randomUUID(),attempt=1,signal,reportTools=false,onQueue=null}={}){
 const diagnostics=tracing()&&api.person()?.role==='owner'&&api.person()?.environment==='sandbox';
 const previous=messages.filter(m=>m.role==='assistant').at(-1)?.content;
 const context=lastQuery&&typeof previous==='string'&&previous.includes(lastQuery.anchor)?lastQuery.plan:null;
 const started=Date.now();
 if(!deadlines.has(requestId))deadlines.set(requestId,started+54000);
 if(deadlines.size>20)deadlines.delete(deadlines.keys().next().value);
 const remaining=deadlines.get(requestId)-started;
 if(!onQueue&&remaining<=0)throw Object.assign(Error('AI_TIMEOUT'),{code:'AI_TIMEOUT'});
 const budget=AbortSignal.timeout(Math.max(1,remaining));
 const bounded=signal?AbortSignal.any([signal,budget]):budget;
 let result;
 try{
   const payload={messages,requestId,attempt,...(reportTools?{reportTools:1,reportContext:context}:{}),...(diagnostics?{diagnostics:1}:{})};
   result=onQueue?await sendQueued({...payload,requestId:requestId+'-a'+attempt,queueVersion:1},signal,onQueue):
     await guarded(()=>client.call('ai.chat',payload,{mutation:false,signal:reportTools?bounded:signal}));
 }catch(e){
   if(diagnostics)recordAttempt(requestId,attempt,e.diagnostics,e.code,Date.now()-started);
   if(!onQueue&&reportTools&&budget.aborted)throw Object.assign(Error('AI_TIMEOUT'),{code:'AI_TIMEOUT'});
   throw e;
 }
 if(result.action){const href='#leaves-report-'+crypto.randomUUID();reportActions.set(href,{epoch:sessionEpoch,action:result.action});if(reportActions.size>20)reportActions.delete(reportActions.keys().next().value);result.text+='\n\n[開啟月報預覽與匯出]('+href+')';}
 if(diagnostics)recordAttempt(requestId,attempt,result.diagnostics,null,Date.now()-started);
 lastQuery=result.reportContext?{plan:result.reportContext,anchor:result.text.trim().slice(-64)}:null;
 if(reportTools && result.reportProtocol!==1)throw Object.assign(Error('此環境的報表查詢服務尚待更新，請先完成後端版本同步。'),{code:'REPORT_GATEWAY_VERSION'});
 return completionResponse(result);
}
import {watchPublishedPage} from './release-entry.mjs';
watchPublishedPage(window.LEAVES_IDENTITY_CONFIG.environment);
window.addEventListener('focus',()=>refresh().catch(()=>{}));const stopPresence=startPresence({refresh,leave:()=>client.leavePresence(),isLoggedIn:()=>!!api.person(),document,window});window.addEventListener('pagehide',()=>{client.forget();vault.lock();});
const stopPoll=startFoundationPoll(async()=>{if(!api.person())return;const changed=await checkFoundationUpdates(switches);if(changed.length){let n=document.getElementById('identityUpdateNotice');if(!n){n=el('aside',{id:'identityUpdateNotice',role:'status',style:'position:fixed;bottom:12px;right:12px;z-index:9500;background:#262626;padding:12px;border-radius:10px;max-width:360px'});document.body.append(n);}n.replaceChildren(el('span',{},'新版已備妥：身分畫面於下次登入接手，進度畫面關閉後接手。'),button('知道了',()=>n.remove()));}});
window.addEventListener('pagehide',stopPoll);
export {errorText};
export const canAdmin=key=>canOpenAdmin(key,api);
export const mountAdminPanel=(root,key,bridge)=>mountAdmin(root,key,api,{...bridge,mountFoundation});
export async function mountFoundation(key,root){const at=sessionEpoch;if(!['identity','workforce'].includes(key))throw Error('UNKNOWN_MODULE');const descriptor=key==='workforce'?(switches.pending()[key]||switches.current(key)):switches.current(key),module=await loadFoundation(descriptor);if(at!==sessionEpoch)throw Error('STALE_SESSION');switches.adopt(key,{safe:true});return module.mount(root,api);}
export const publicBranding=()=>client.branding();

export function installDailyEntrypoints(){
 const rail=document.querySelector('.leaves-chat-rail');if(!rail)return;
 document.getElementById('identityDailyButton')?.remove();
 let actions=document.getElementById('identityWorkButtons');
 if(!actions){
  actions=el('section',{id:'identityWorkButtons','aria-label':'工作進度'});
  for(const [id,label,icon,run]of [
   ['identityDailyEntry','填寫今日進度','✎',()=>openDailyWindow(api)],
   ['identityReportsEntry','進度與工時','▦',()=>open('workforce')]
  ]){const b=button('',()=>run().catch(e=>alert(errorText(e))),'leaves-chat-rail-icon');b.id=id;b.title=label;b.append(el('span',{},icon),el('span',{class:'rail-label'},label));actions.append(b);}
  const assistant=rail.querySelector('[data-leaves-module="assistant"]');
  if(assistant)assistant.after(actions);else rail.insertBefore(actions,rail.querySelector('#identityTeamButton'));
 }
 if(!document.getElementById('identityTeamButton')){const b=button('',()=>openTeamDay(api).catch(e=>alert(errorText(e))),'leaves-chat-rail-icon');b.id='identityTeamButton';b.title='團隊今日進度';b.append(el('span',{},'▦'),el('span',{class:'rail-label'},'團隊今日進度'));rail.append(b);}
 syncDailyEntrypoints();
}
export function syncDailyEntrypoints(){const p=api.person();for(const id of ['identityDailyEntry','identityReportsEntry']){const b=document.getElementById(id);if(b)b.hidden=!p||!api.can('progress.view');}const team=document.getElementById('identityTeamButton');if(team)team.hidden=!p||!['owner','boss','supervisor'].includes(p.role)||!api.can('progress.view');}

function delayQueue(ms,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Object.assign(Error('AI_CANCELLED'),{code:'AI_CANCELLED'}));return;}
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
  function cancel(){clearTimeout(timer);reject(Object.assign(Error('AI_CANCELLED'),{code:'AI_CANCELLED'}));}
  signal?.addEventListener('abort',cancel,{once:true});
 });
}
export async function driveChatQueue({send,status,cancel,signal,notify,remember,pause=delayQueue,inspectFirst=false}){
 let state=inspectFirst?await status():null,saved=inspectFirst;
 try{
  for(;;){
   signal?.throwIfAborted();
   if(state?.state==='waiting'){
    notify(state);
    if(!saved){await remember();saved=true;}
    const seconds=Math.max(1,Math.min(172800,Number(state.seconds)||5));
    await pause(seconds*1000+Math.floor(Math.random()*450),signal);
    try{state=await status();}catch(e){if(e.code!=='SERVICE_UNAVAILABLE')throw e;state={state:'waiting',reason:'CONNECTION',seconds:12};}
    continue;
   }
   notify(null);
   const result=await send();
   if(!result.queue)return result;
   state=result.queue;
   if(state.state!=='waiting')throw Error('BAD_QUEUE_STATE');
  }
 }finally{
  if(signal?.aborted)await cancel().catch(()=>{});
 }
}
