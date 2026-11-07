import {withReleaseJob} from './sync.mjs';
import {roots, publicRecord, checkRoot} from './release-entry.mjs';
import {el,button,errorText} from '../shared/dom.mjs';
import {createIdentityClient} from '../identity/identity-client.mjs';
import {legacyLayout} from './admin-heritage.mjs';
import {inspectWebsiteHtml} from './website-bundle.mjs';
import {releaseAuthorizationDeadline, releaseAuthorizationExpired, releaseAuthorizationMessage} from './release-auth.mjs';

const companion = 'src/modules/runtime/promotion-package.json';
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
function base64(bytes) {
 let text='';
 for(let i=0;i<bytes.length;i+=32768) text+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return btoa(text);
}
async function prepareSandbox(bundles) {
 const sandbox=bundles.sandbox, stable=bundles.stable;
 if(stable.manifest.releaseId!==sandbox.manifest.releaseId) throw Error('兩個環境的更新版本不一致');
 const raw=new TextEncoder().encode(JSON.stringify(stable));
 const hash=await digest(raw);
 const existing=sandbox.files.find(f=>f.path===companion);
 if(existing) {
  const packed=JSON.parse(atob(existing.base64));
  if(await digest(await unpack(packed))!==hash) throw Error('沙盒所附的正式版本與更新檔不符');
  return sandbox;
 }
 const compressed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 const bytes=new TextEncoder().encode(JSON.stringify({gzip:base64(compressed)}));
 return {manifest:{...sandbox.manifest,files:[...sandbox.manifest.files,{path:companion,bytes:bytes.length,sha256:await digest(bytes)}]},files:[...sandbox.files,{path:companion,base64:base64(bytes)}]};
}
async function unpack(packed) {
 const stream=new Blob([Uint8Array.from(atob(packed.gzip),c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'));
 const reader=stream.getReader(), parts=[];let length=0;
 for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>24*1048576){await reader.cancel();throw Error('正式版本超出上限');}parts.push(value);}
 return new Response(new Blob(parts)).arrayBuffer();
}
async function publicFile(url) {
 const r=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('候選檔案尚未部署');return r.arrayBuffer();
}
async function promotionPayload(record) {
 const dir=roots.sandbox+'site-releases/sandbox/'+record.releaseId+'/';
 const manifestBytes=await publicFile(dir+'site-manifest.json');
 if(await digest(manifestBytes)!==record.manifestHash)throw Error('沙盒入口與清單不符');
 const manifest=JSON.parse(new TextDecoder().decode(manifestBytes));
 const expected=manifest.files.find(f=>f.path===companion);
 if(!expected) throw Error('此沙盒使用舊發布格式。請先將新版更新檔拖入沙盒。');
 const bytes=await publicFile(dir+companion);
 if(await digest(bytes)!==expected.sha256 || bytes.byteLength!==expected.bytes)throw Error('正式版本完整性檢查失敗');
 const bundle=JSON.parse(new TextDecoder().decode(await unpack(JSON.parse(new TextDecoder().decode(bytes)))));
 if(bundle.manifest.environment!=='stable'||bundle.manifest.releaseId!==record.releaseId)throw Error('正式版本與沙盒不符');
 return bundle;
}

const channelName = {stable:'正式站', sandbox:'沙盒'};
const taipeiTime = stamp => stamp ? new Date(stamp).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}) : '—';

function resultRow(title, detail, status, tone) {
 return el('div',{class:'release-health-row'},
  el('div',{class:'min-w-0'},el('div',{class:'text-[10px] text-neutral-200'},title),
   el('div',{class:'text-[9px] text-neutral-500 mt-1 font-mono break-all'},detail)),
  el('span',{class:'release-health-status '+tone},status));
}
function badge(node, label, tone) {
 node.textContent=label;
 node.className='release-health-status '+tone;
}
function linkFromButton(old, href, text) {
 const link=el('a',{class:old.className,href,target:'_blank',rel:'noopener'},...Array.from(old.childNodes));
 if(text)link.textContent=text;
 old.replaceWith(link);
 return link;
}

export function mountSandboxHtml(root,api,bridge) {
 const layout=legacyLayout(root,bridge);
 if(!layout)throw Error('找不到版本發布窗口，請從網站首頁重新開啟後台。');
 const {get,set}=layout;
 // The release window supplies its own V28 typography, controls and scroll body.
 root.parentElement.classList.remove('li-shell');
 const env=api.person()?.environment, sandbox=env==='sandbox', epoch=api.epoch();
 const running=new URL(import.meta.url).pathname.match(/\/site-releases\/(?:stable|sandbox)\/([^/]+)\//)?.[1];
 const password=get('releaseAdminSecretInput'), picker=get('releaseCandidateFileInput');
 const zone=get('releaseUploadDropZone'), promote=get('releasePromoteBtn'), rollback=get('releaseRollbackBtn');
 const retry=get('releaseUploadCandidateBtn'), validate=get('releaseValidateCandidateBtn'), openSandbox=get('releaseOpenUploadedSandboxBtn');
 const notice=get('releaseBootstrapNotice'), history=get('releaseDeploymentHistory');
 const records={stable:null,sandbox:null};
 let disposed=false,busy=false,reading=0,file=null,selected=null,created=null;
 let deadline=0,remote=null,remoteDeadline=0;
 const timers=new Map();
 function check() {
  const person=api.person();
  if(disposed||!root.isConnected||api.epoch()!==epoch||person?.environment!==env||person.role!=='owner'||!api.can('technical.release'))
   throw Error('登入或發布權限已變更，請重新開啟窗口。');
 }
 function buttons() {
  picker.disabled=!sandbox||busy;
  validate.disabled=!sandbox||busy||!file;
  retry.disabled=!sandbox||busy||!selected;
  openSandbox.disabled=!created||busy;
  promote.disabled=busy||!sandbox||!records.sandbox?.entry||!records.stable||records.sandbox.releaseId===records.stable.releaseId;
  rollback.disabled=busy||!records.stable?.previousCommit||!records.stable.previousRootSha;
 }
 const authClass='text-[9px] text-neutral-400 mt-2 leading-relaxed';
 const localState=el('p',{class:authClass,role:'status'},'驗證有效 20 分鐘。');
 const stableState=el('p',{class:authClass,role:'status'},'發布與回滾需正式站授權。');
 const stableCode=el('input',{type:'password',class:'release-secret-input mt-2',autocomplete:'off',placeholder:'輸入正式站最高管理員通行碼','aria-label':'正式站最高管理員通行碼'});
 function showAuthorization(node,end) {
  clearTimeout(timers.get(node));
  node.textContent=releaseAuthorizationMessage(end);
  timers.set(node,setTimeout(()=>{node.textContent='20 分鐘驗證已到期，請重新輸入通行碼。';},Math.max(0,end-Date.now())));
 }
 function clearAuthorization(node) {
  clearTimeout(timers.get(node));
  node.textContent='等待身分驗證。';
 }
 async function authenticate() {
  const code=password.value;password.value='';deadline=0;clearAuthorization(localState);
  if(!code){password.focus();throw Error('請輸入'+channelName[env]+'最高管理員通行碼。');}
  try {await api.reauthenticate(code);check();}
  catch(e){localState.textContent=errorText(e);throw e;}
  deadline=releaseAuthorizationDeadline();showAuthorization(localState,deadline);
 }
 const requireAuth=()=>{check();if(releaseAuthorizationExpired(deadline))throw Error('請重新驗證'+channelName[env]+'最高管理員身分。');};
 const ownCall=(action,payload={})=>{check();return api.publisher({action,payload},!['verify-public','status'].includes(action));};
 async function stableCaller() {
  if(!sandbox){
   if(releaseAuthorizationExpired(deadline))await authenticate();
   return (action,payload)=>{requireAuth();return ownCall(action,payload);};
  }
  if(!remote?.snapshot()||releaseAuthorizationExpired(remoteDeadline)||stableCode.value){
   const code=stableCode.value;stableCode.value='';
   if(!code){stableCode.focus();throw Error('請輸入正式站最高管理員通行碼。');}
   const previous=remote;remote=null;remoteDeadline=0;clearAuthorization(stableState);
   if(previous)await previous.logout().catch(()=>previous.forget());
   check();const client=createIdentityClient({config:{environment:'stable'}});
   try {
    const session=await client.login(code,'版本發布與沙盒中心');check();
    if(session.person.role!=='owner'||!session.person.permissions?.['technical.release'])throw Error('需要正式站最高管理員權限。');
   } catch(e){await client.logout().catch(()=>client.forget());stableState.textContent=errorText(e);throw e;}
   remote=client;remoteDeadline=releaseAuthorizationDeadline();showAuthorization(stableState,remoteDeadline);
  }
  return (action,payload={})=>{check();if(releaseAuthorizationExpired(remoteDeadline))throw Error('正式站驗證已到期。');return remote.service('publisher',{action,payload},{mutation:!['verify-public','status'].includes(action)});};
 }

 function uploadProgress(n,message) {
  set('releaseUploadProgressText',n+'%');get('releaseUploadProgressBar').style.width=n+'%';
  set('releaseUploadStageText',message);
  const limits=[30,55,75,100];
  ['Validate','Commit','Pages','Manifest'].forEach((key,i)=>{
   const stage=get('releaseUploadStage'+key);
   stage.classList.toggle('done',n>=limits[i]);
   stage.classList.toggle('active',n<limits[i]&&n>=(limits[i-1]||0));
  });
 }
 let stageRow=null;
 function deployProgress(n,message) {
  set('releaseDeploymentProgressText',n+'%');get('releaseDeploymentProgressBar').style.width=n+'%';
  set('releaseDeploymentStepText',message);
  const checks=get('releaseDeploymentChecks');
  if(n===0){checks.replaceChildren();stageRow=null;}
  if(stageRow)badge(stageRow.lastElementChild,'完成','pass');
  stageRow=resultRow(message,taipeiTime(Date.now()),n===100?'完成':'進行中',n===100?'pass':'wait');
  checks.append(stageRow);
  badge(get('releaseDeploymentStatusBadge'),n===100?'已完成':'進行中',n===100?'pass':'wait');
 }
 async function run(task,onError) {
  if(busy)return;
  busy=true;root.dataset.releaseWorking='true';buttons();
  try {check();await task();}
  catch(e){if(!disposed)onError(errorText(e));}
  finally {busy=false;delete root.dataset.releaseWorking;if(!disposed)buttons();}
 }
 const uploadError=msg=>set('releaseUploadStageText',msg);
 const deployError=msg=>{
  set('releaseDeploymentStepText',msg);badge(get('releaseDeploymentStatusBadge'),'待核對','fail');
  if(stageRow)badge(stageRow.lastElementChild,'中止','fail');
  get('releaseDeploymentChecks').append(resultRow('操作未完成',msg,'待核對','fail'));
 };
 async function until(task) {
  for(let i=0;;i++){
   check();
   try{return await task();}catch(e){
    if(i>=44||!['候選檔案尚未部署','入口正等待部署','PAGES_DEPLOYMENT_PENDING','公開入口尚未就緒'].includes(e.code||e.message))throw e;
    await new Promise(resolve=>setTimeout(resolve,4000));
   }
  }
 }
 async function verifyPublic(call,id) {
  await until(async()=>{
   const r=await call('verify-public');
   if(r.publicVerified!==true||r.releaseId!==id)throw Error('公開入口與預期版本不符，請重新讀取版本。');
  });
 }
 async function publish(environment,call,bundle,progress,beforeCommit,expectedFrom) {
  const id=bundle.manifest.releaseId;
  const state=await call('status');check();
  const from=state.published?.releaseId||'原網站入口';
  if(state.published?.releaseId===id){
   const proposed=await digest(new TextEncoder().encode(JSON.stringify(bundle.manifest,null,2)+'\n'));
   if(state.published.manifestHash!==proposed)throw Error('同一版本編號已登錄不同內容，請使用新的版本編號。');
  }else{
   if(expectedFrom&&from!==expectedFrom)throw Error('網站版本已變更，請重新讀取後再操作。');
   await progress(40,'正在提交'+channelName[environment]+'候選版本');
   const staged=await call('stage',bundle);check();
   if(staged.releaseId!==id)throw Error('候選版本與更新檔不符。');
   await progress(55,'等待候選版本部署至 GitHub Pages');
   await until(()=>publicFile(roots[environment]+'site-releases/'+environment+'/'+id+'/site-manifest.json'));
   await progress(75,'正在核對版本檔案與網站入口');
   const plan=await call('plan',{releaseId:id});check();
   if(plan.preview?.to!==id||!plan.ticket||plan.preview.from!==from)throw Error('發布計畫已變更，請重新核對版本。');
   if(beforeCommit)await beforeCommit();
   const committed=await call('commit',{ticket:plan.ticket,confirm:'CONFIRM_WEBSITE_PUBLISH'});check();
   if(committed.releaseId!==id)throw Error('提交結果與預期版本不符，請重新讀取。');
  }
  await progress(90,'等待並核對'+channelName[environment]+'公開入口');
  await verifyPublic(call,id);check();await progress(100,channelName[environment]+'入口已核對完成');
 }
 async function buildSandbox() {
  if(!sandbox||!selected)throw Error('請先在沙盒選擇完整 HTML。');
  if(releaseAuthorizationExpired(deadline)&&password.value)await authenticate();
  if(releaseAuthorizationExpired(deadline)){uploadProgress(30,'檔案已核對，請驗證沙盒最高管理員身分。');password.focus();return;}
  const call=(action,payload)=>{requireAuth();return ownCall(action,payload);};
  await publish('sandbox',call,selected,uploadProgress);
  created=selected.manifest.releaseId;selected=null;await refresh();
 }
 async function inspect(next,autoBuild) {
  if(!sandbox)throw Error('正式站已鎖定上傳。');
  file=next;selected=null;created=null;
  if(!file)throw Error('請選擇一個完整網站更新 HTML。');
  set('releaseCandidateVersion','—');set('releaseCandidateSchema','—');set('releaseCandidateFileName',file.name);
  set('releaseCandidateValidationState','核對中');set('releaseCandidateValidationList','正在驗證檔案清單與模組。');
  try{
   const data=await inspectWebsiteHtml(file,n=>uploadProgress(Math.round(n*25),'逐檔核對完整性'));
   check();const candidate=await prepareSandbox(data.bundles);check();selected=candidate;
   set('releaseCandidateVersion',candidate.manifest.releaseId);set('releaseCandidateSchema',String(data.schema));
   set('releaseCandidateValidationState','已通過');
   get('releaseCandidateValidationList').replaceChildren(...['sandbox','stable'].map(key=>resultRow(channelName[key]+'更新包',data.bundles[key].files.length+' 個檔案 · 五個模組已核對','通過','pass')));
   uploadProgress(30,'完整性核對通過，可建立沙盒。');
  }catch(e){set('releaseCandidateValidationState','失敗');get('releaseCandidateValidationList').replaceChildren(resultRow('檔案核對',errorText(e),'失敗','fail'));throw e;}
  if(autoBuild)await buildSandbox();
 }

 async function readChannel(key,fullCheck) {
  const checks=[],name=channelName[key];
  let record=null,step='發布紀錄';
  try{
   record=await publicRecord(key);
   checks.push(resultRow(name+' · '+step,record.releaseId,'通過','pass'));
   step='網站入口';await checkRoot(key,record);checks.push(resultRow(name+' · '+step,roots[key],'通過','pass'));
   if(fullCheck&&record.entry){
    step='版本檔案清單';
    const bytes=await publicFile(roots[key]+'site-releases/'+key+'/'+record.releaseId+'/site-manifest.json');
    if(await digest(bytes)!==record.manifestHash)throw Error('檔案清單雜湊與發布紀錄不符。');
    const manifest=JSON.parse(new TextDecoder().decode(bytes));
    if(manifest.environment!==key||manifest.releaseId!==record.releaseId||!Array.isArray(manifest.files))throw Error('清單的版本或環境不符。');
    checks.push(resultRow(name+' · '+step,manifest.files.length+' 個已登錄檔案 · SHA-256 相符','通過','pass'));
   }
   return {key,record,checks,healthy:true};
  }catch(e){checks.push(resultRow(name+' · '+step,errorText(e),'未通過','fail'));return {key,record,checks,healthy:false};}
 }
 async function refresh(fullCheck=false) {
  const sequence=++reading;
  const channels=await Promise.all(['stable','sandbox'].map(k=>readChannel(k,fullCheck)));
  check();if(sequence!==reading)return;
  const logs=[];
  for(const {key,record,healthy} of channels) {
   const label=key==='stable'?'Stable':'Sandbox';
   records[key]=healthy?record:null;
   set('release'+label+'VersionText',record?.releaseId||'無法讀取');
   set('releaseManifest'+label+'Value',record?.releaseId||'無法讀取');
   for(const item of record?.history||[])logs.push({...item,key});
  }
  const stable=channels[0].record,sb=channels[1].record;
  set('releaseManifestPreviousValue',stable?(stable.previousReleaseId||(stable.previousCommit?'原網站入口':'尚無上一版')):'無法讀取');
  set('releaseManifestSchemaValue',stable?String(stable.schema):'無法讀取');
  set('releaseStableMetaText',stable?.createdAt?'發布於 '+taipeiTime(stable.createdAt):'正式同事入口');
  set('releaseManifestRevisionText',sb?.createdAt?'發布於 '+taipeiTime(sb.createdAt):'沙盒網站入口');
  get('releaseHealthCheckList').replaceChildren(...channels.flatMap(c=>c.checks));
  history.replaceChildren(...logs.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(item=>{
   const restored=/rollback|restore/i.test(item.operation||'');
   return resultRow(channelName[item.key]+' · '+item.releaseId,taipeiTime(item.createdAt),restored?'已回滾':'已切換','pass');
  }));
  if(!logs.length)history.textContent=channels.every(c=>c.record)?'兩站尚無公開部署紀錄。':'公開部署紀錄讀取未完成。';
  const current=records[env];
  notice.classList.toggle('show',!!(running&&current&&current.releaseId!==running));
  if(current&&running&&current.releaseId!==running)set('releaseBootstrapMessage','本分頁執行 '+running+'，'+channelName[env]+'入口指向 '+current.releaseId+'。');
  if(!stageRow)set('releaseDeploymentRouteText',(stable?.releaseId||'未知')+' → '+(sb?.releaseId||'未知'));
  buttons();
 }

 const header=root.closest('.admin-window')?.querySelector('.window-header .env-sandbox-chip');
 if(header){header.textContent='目前 · '+(sandbox?'沙盒':'正式版');header.style.setProperty('display','inline-flex','important');}
 const localName=get('releaseCurrentEnvironmentText'),currentCard=localName.closest('.release-env-card');
 currentCard.classList.toggle('sandbox',sandbox);currentCard.classList.toggle('stable',!sandbox);
 currentCard.querySelector('.release-env-dot').className='release-env-dot '+env;
 localName.className='text-sm font-medium '+(sandbox?'text-purple-200':'text-emerald-200');
 localName.textContent=sandbox?'沙盒':'正式版';set('releaseCurrentBuildText',running||'本機預覽');
 for(const id of ['releaseStableVersionText','releaseSandboxVersionText','releaseManifestStableValue','releaseManifestSandboxValue','releaseManifestPreviousValue','releaseManifestSchemaValue'])set(id,'讀取中');
 linkFromButton(get('releaseBootstrapRegisterBtn'),roots[env],'開啟目前網站入口');
 for(const [label,key] of [['Stable','stable'],['Sandbox','sandbox']]){
  const value=get('release'+label+'UrlText');value.textContent=roots[key];linkFromButton(value.closest('button'),roots[key]);
 }
 password.setAttribute('aria-label',channelName[env]+'最高管理員通行碼');
 password.autocomplete='off';password.placeholder='輸入'+channelName[env]+'最高管理員通行碼';
 password.parentElement.querySelector('p').replaceWith(localState);
 const verify=button('驗證身分',()=>run(async()=>{await authenticate();if(selected)await buildSandbox();},msg=>{if(selected)uploadError(msg);else localState.textContent=msg;}),'rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-200 mt-2');
 password.after(verify);password.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();verify.click();}};
 if(sandbox){
  const actions=promote.parentElement;actions.classList.add('release-actions');
  actions.before(el('label',{class:'release-auth-box rounded-xl border border-neutral-800 bg-black/20 p-3'},el('span',{class:'text-[9px] text-neutral-300'},'正式站發布授權'),stableCode,stableState));
 }
 set('releaseCandidateFileName',sandbox?'拖曳新版 HTML 到這裡':'正式站已鎖定上傳');
 set('releaseCandidateFileMeta',sandbox?'或點擊選擇完整 HTML · 上限 48 MB':'請從沙盒網站入口上傳更新檔');
 set('releaseSandboxSeedState','兩站使用獨立資料庫。目前未提供跨站複製核心資料服務。');
 get('releaseReseedSandboxBtn').disabled=true;
 get('releaseReseedSandboxBtn').title='目前未提供跨站複製服務';
 get('releaseRegisterSandboxBtn').remove();
 retry.lastChild.textContent='建立／重試沙盒';
 promote.lastChild.textContent='發布到正式網站入口';
 promote.classList.add('release-promote');promote.title=sandbox?'將已驗收的沙盒版本發布至正式網站':'請由沙盒後台發布';
 if(!sandbox){zone.setAttribute('aria-disabled','true');set('releaseUploadStageText','請由沙盒上傳。');}
 for(const name of ['dragenter','dragover'])zone.addEventListener(name,e=>{e.preventDefault();if(sandbox&&!busy)zone.classList.add('dragover');});
 zone.addEventListener('dragleave',()=>zone.classList.remove('dragover'));
 zone.ondrop=e=>{e.preventDefault();zone.classList.remove('dragover');if(!sandbox)return;const files=e.dataTransfer.files;void run(async()=>{
  if(files.length!==1)throw Error('請選擇一個完整網站更新 HTML。');
  await inspect(files[0],true);
 },uploadError);};
 picker.onchange=()=>{const next=picker.files?.[0];picker.value='';if(sandbox&&next)void run(()=>inspect(next,true),uploadError);};
 validate.onclick=()=>run(()=>inspect(file,false),uploadError);
 retry.onclick=()=>run(buildSandbox,uploadError);
 openSandbox.onclick=()=>{if(created)window.open(roots.sandbox,'_blank','noopener');};
 const read=()=>run(()=>refresh(true),msg=>set('releaseHealthCheckList',msg));
 get('releaseHealthCheckBtn').onclick=read;get('releaseManifestRefreshBtn').onclick=read;
 root.querySelector('[data-legacyclick*="loadDeploymentHistory"]').onclick=read;
 get('releaseUploaderTestBtn').onclick=()=>run(async()=>{
  await ownCall('status');check();badge(get('releaseUploaderConnectionBadge'),'已連線','pass');
 },msg=>{badge(get('releaseUploaderConnectionBadge'),'連線失敗','fail');uploadError(msg);});
 promote.onclick=()=>run(async()=>{
  const displayed=records.sandbox,stable=records.stable;
  if(!sandbox||!displayed?.entry||!stable||displayed.releaseId===stable.releaseId)throw Error('請先讀取兩站版本。');
  set('releaseDeploymentRouteText',stable.releaseId+' → '+displayed.releaseId);
  set('releaseDeploymentStepText','正在驗證正式站發布權限');
  const assertSandbox=async()=>{
   const latest=await publicRecord('sandbox');await checkRoot('sandbox',latest);check();
   if(latest.releaseId!==displayed.releaseId||latest.manifestHash!==displayed.manifestHash)throw Error('沙盒版本已變更。請重新讀取，驗收新版後再發布。');
  };
  const call=await stableCaller();
  await withReleaseJob(remote,stable.releaseId,displayed.releaseId,deployProgress,async report=>{
   await assertSandbox();
   const bundle=await promotionPayload(displayed);check();
   await publish('stable',call,bundle,report,assertSandbox,stable.releaseId);
  });
  await refresh();
 },deployError);
 rollback.onclick=()=>run(async()=>{
  const previous=records.stable;if(!previous?.previousCommit)throw Error('找不到可回滾的正式入口。');
  if(!window.confirm('確定將正式網站從 '+previous.releaseId+' 回滾到 '+(previous.previousReleaseId||'原網站入口')+'？'))return;
  set('releaseDeploymentRouteText',previous.releaseId+' → '+(previous.previousReleaseId||'原網站入口'));
  deployProgress(0,'核對正式站回滾版本');
  const call=await stableCaller(),plan=await call('rollback-plan');check();
  if(!plan.ticket||plan.preview?.from!==previous.releaseId||(previous.previousReleaseId&&plan.preview.to!==previous.previousReleaseId))
   throw Error('回滾目標已變更，請重新讀取。');
  deployProgress(70,'正在回滾正式站入口');
  const r=await call('commit',{ticket:plan.ticket,confirm:'CONFIRM_WEBSITE_PUBLISH'});
  deployProgress(90,'等待正式入口部署');await verifyPublic(call,r.releaseId);check();
  deployProgress(100,'正式入口回滾完成');await refresh();
 },deployError);
 buttons();void refresh().catch(e=>{if(!disposed)set('releaseHealthCheckList',errorText(e));});
 return {dispose(){disposed=true;reading++;file=null;selected=null;deadline=0;remoteDeadline=0;
  for(const timer of timers.values())clearTimeout(timer);
  password.value='';stableCode.value='';if(remote)void remote.logout().catch(()=>remote.forget());
 }};
}
