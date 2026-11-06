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
function endUI(){sessionEpoch++;screenSequence++;for(const d of document.querySelectorAll('.li-dialog'))d.close();screenMount?.dispose();screenMount=null;screen?.remove();screen=null;vault.lock();hook?.clear();}
async function guarded(fn){try{return await fn();}catch(e){if(['AUTH_REQUIRED','AUTH_REVOKED'].includes(e.code)){client.forget();endUI();}throw e;}}
export const api=installCoreApi({chat:(text,options)=>chat(text,options),person:()=>client.snapshot()?.person||null,can:k=>!!client.snapshot()?.person?.permissions?.[k],read:(a,p={})=>guarded(()=>client.call(a,p,{mutation:false})),
 publicStatus:()=>client.status(),
 write:(a,p={})=>guarded(()=>client.call(a,p,{mutation:true})),
 progress:(a,p={},write=false)=>guarded(()=>client.call('progress',{...p,action:a},{mutation:write})),cost:(a,p={},write=false)=>guarded(()=>client.call('cost',{...p,action:a},{mutation:write})),
 workspace:(a,p={},write=false)=>guarded(()=>client.call('workspace',{...p,action:a},{mutation:write})),plan:p=>guarded(()=>client.plan(p)),confirm:(id,c)=>guarded(()=>client.confirm(id,c)),cancelPreview:()=>client.cancelPreview(),drafts:vault,
 reauthenticate:code=>reauthenticateOwner({client,epoch:()=>sessionEpoch,createClient:createIdentityClient,code}),
 publisher:(body,write=false)=>guarded(()=>client.service('publisher',body,{mutation:write})),
 release:(body,write=false)=>guarded(()=>client.service('release',body,{mutation:write})),router:(body,write=false)=>guarded(()=>client.service('router',body,{mutation:write})),epoch:()=>sessionEpoch});
export const costs=createIdentityCost(api);
export function attachCore(bridge){hook=bridge;hook.clear();}
export async function login(code){endUI();const e=++sessionEpoch;try{const s=await client.login(code);await vault.unlock(code,s.person.employeeId);if(e!==sessionEpoch)throw Error('登入已變更');if(switches.pending().identity){try{await loadFoundation(switches.pending().identity);if(e!==sessionEpoch)throw Error('登入已變更');prepareIdentityHandover(switches);}catch(err){if(e!==sessionEpoch)throw err;alert('新版身分畫面尚未通過載入檢查，繼續使用原版：'+errorText(err));}}hook?.authenticated(s.person);await refresh();return s;}catch(err){if(e===sessionEpoch){client.forget();endUI();}throw err;}}
export async function logout(){endUI();let err;try{await client.logout();}catch(e){err=e;}finally{client.forget();}if(err)throw err;}
export async function refresh({visible=!document.hidden}={}){if(refreshing||!api.person())return;refreshing=true;try{const before=api.person(),s=await guarded(()=>client.refresh({visible}));if(before.revision!==s.person.revision||JSON.stringify(before.permissions)!==JSON.stringify(s.person.permissions)){for(const d of document.querySelectorAll('.li-dialog'))d.close();screenMount?.dispose();screenMount=null;screen?.remove();screen=null;hook?.permissionsChanged?.();}hook?.authenticated(s.person);hook?.maintenance?.(s.maintenance);}finally{refreshing=false;}}
export async function open(section='workforce'){if(section==='people')return hook?.openAdmin?.('passcodes');if(section==='updates')return hook?.openAdmin?.('releaseCenter');if(!api.person())throw Error('請先登入');const sequence=++screenSequence;await refresh();if(sequence!==screenSequence)return;if(section==='people'&&!api.can('people.view'))throw Object.assign(Error('權限不足'),{code:'FORBIDDEN'});if(section==='updates'&&!api.can('technical.release'))throw Object.assign(Error('權限不足'),{code:'FORBIDDEN'});for(const d of document.querySelectorAll('.li-dialog'))d.close();screenMount?.dispose();screen?.remove();const root=el('section',{class:'li-shell'});screen=el('div',{id:'leavesIdentityWorkspace',style:'position:fixed;inset:70px 14px 14px;z-index:9000;overflow:auto;background:#171717;border:1px solid #404040;border-radius:12px;'},el('div',{class:'li-toolbar',style:'padding:0 24px'},el('span',{},api.person().name+' · '+roles[api.person().role]),button('進度報表',()=>open('workforce').catch(e=>alert(errorText(e)))),button('返回工作區',()=>{screenMount?.dispose();screen?.remove();screen=null;})),root);document.body.append(screen);const at=sessionEpoch;let mount=mountUpdates;if(section!=='updates'){const key=section==='people'?'identity':'workforce',descriptor=key==='workforce'?(switches.pending()[key]||switches.current(key)):switches.current(key);try{mount=(await loadFoundation(descriptor)).mount;if(at===sessionEpoch&&sequence===screenSequence)switches.adopt(key,{safe:true});}catch(e){root.append(el('p',{role:'alert'},'新版未能載入，保留原版：'+errorText(e)));mount=(await loadFoundation(switches.current(key))).mount;}}if(at!==sessionEpoch||sequence!==screenSequence)return;const m=await mount(root,api);if(at!==sessionEpoch||sequence!==screenSequence){m?.dispose();return;}screenMount=m;}
export async function chat(text,{signal,report}={}){return guarded(()=>client.call('ai.chat',{messages:[{role:'user',content:text}],requestId:crypto.randomUUID(),attempt:1,...(report?{report}:{})},{mutation:false,signal}));}
export async function chatResponse(messages,{requestId=crypto.randomUUID(),attempt=1,signal}={}){return completionResponse(await guarded(()=>client.call('ai.chat',{messages,requestId,attempt},{mutation:false,signal})));}
window.addEventListener('focus',()=>refresh().catch(()=>{}));const stopPresence=startPresence({refresh,leave:()=>client.leavePresence(),isLoggedIn:()=>!!api.person(),document,window});window.addEventListener('pagehide',()=>{client.forget();vault.lock();});
const stopPoll=startFoundationPoll(async()=>{if(!api.person())return;const changed=await checkFoundationUpdates(switches);if(changed.length){let n=document.getElementById('identityUpdateNotice');if(!n){n=el('aside',{id:'identityUpdateNotice',role:'status',style:'position:fixed;bottom:12px;right:12px;z-index:9500;background:#262626;padding:12px;border-radius:10px;max-width:360px'});document.body.append(n);}n.replaceChildren(el('span',{},'新版已備妥：身分畫面於下次登入接手，進度畫面關閉後接手。'),button('知道了',()=>n.remove()));}});
window.addEventListener('pagehide',stopPoll);
export {errorText};
export const canAdmin=key=>canOpenAdmin(key,api);
export const mountAdminPanel=(root,key,bridge)=>mountAdmin(root,key,api,{...bridge,mountFoundation});
export async function mountFoundation(key,root){const at=sessionEpoch;if(!['identity','workforce'].includes(key))throw Error('UNKNOWN_MODULE');const descriptor=key==='workforce'?(switches.pending()[key]||switches.current(key)):switches.current(key),module=await loadFoundation(descriptor);if(at!==sessionEpoch)throw Error('STALE_SESSION');switches.adopt(key,{safe:true});return module.mount(root,api);}
export const publicBranding=()=>client.branding();

export function installDailyEntrypoints(){const header=document.querySelector('#appContainer>header');if(header&&!document.getElementById('identityDailyButton')){const b=button('填寫今日進度',()=>openDailyWindow(api,{openReports:()=>open('workforce')}).catch(e=>alert(errorText(e))));b.id='identityDailyButton';header.append(b);}const rail=document.querySelector('.leaves-chat-rail');if(rail&&!document.getElementById('identityTeamButton')){const b=button('',()=>openTeamDay(api).catch(e=>alert(errorText(e))),'leaves-chat-rail-icon');b.id='identityTeamButton';b.title='團隊今日進度';b.append(el('span',{},'▦'),el('span',{class:'rail-label'},'團隊今日進度'));rail.append(b);}syncDailyEntrypoints();}
export function syncDailyEntrypoints(){const p=api.person();const daily=document.getElementById('identityDailyButton'),team=document.getElementById('identityTeamButton');if(daily)daily.hidden=!p||!api.can('progress.view');if(team)team.hidden=!p||!['owner','boss','supervisor'].includes(p.role)||!api.can('progress.view');}
