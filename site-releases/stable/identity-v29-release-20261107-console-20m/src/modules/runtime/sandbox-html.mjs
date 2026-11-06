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

export function mountSandboxHtml(root,api,bridge){
 const {get,set}=legacyLayout(root,bridge);
 const env=api.person()?.environment,sandbox=env==='sandbox',epoch=api.epoch();
 const running=new URL(import.meta.url).pathname.match(/\/site-releases\/[^/]+\/([^/]+)\//)?.[1]||'本機預覽';
 const password=get('releaseAdminSecretInput'),input=get('releaseCandidateFileInput'),zone=get('releaseUploadDropZone'),promote=get('releasePromoteBtn');
 let disposed=false,busy=false,deadline=0,remote=null,selected=null,staged=null;
 const check=()=>{if(disposed||!root.isConnected||api.epoch()!==epoch||api.person()?.role!=='owner'||!api.can('technical.release'))throw Error('請重新登入最高管理員');};
 const guarded=async fn=>{if(busy)return;busy=true;root.dataset.releaseWorking='true';try{check();await fn();}catch(e){if(!disposed){set('releaseDeploymentStatusBadge','未完成');set('releaseDeploymentStepText',errorText(e));set('releaseUploadStageText',errorText(e));}}finally{busy=false;delete root.dataset.releaseWorking;}};
 const bind=(id,fn)=>{get(id).onclick=()=>guarded(fn);};
 const sandboxCall=(action,payload={})=>{check();if(!sandbox)throw Error('僅沙盒可上傳');return api.publisher({action,payload},action!=='status'&&action!=='verify-public');};
 const ownCall=(action,payload={})=>{check();return api.publisher({action,payload},action!=='status'&&action!=='verify-public');};
 const requireAuth=()=>{check();if(releaseAuthorizationExpired(deadline))throw Error('請輸入本環境最高管理員通行碼');};
 async function authenticate(){
  const code=password.value;password.value='';deadline=0;
  await api.reauthenticate(code);check();deadline=releaseAuthorizationDeadline();authState.textContent=releaseAuthorizationMessage(deadline);
 }
 const authState=el('p',{role:'status'},'驗證有效時間為 20 分鐘。');
 password.placeholder='本環境最高管理員通行碼';password.autocomplete='current-password';password.parentElement.querySelector('span').textContent='最高管理員身分驗證';
 password.parentElement.querySelector('p').replaceWith(authState);
 const verify=button('驗證身分',()=>guarded(async()=>{await authenticate();if(selected)await upload();}),'li-primary');
 password.after(verify);password.onkeydown=e=>{if(e.key==='Enter')verify.click();};
 const stableCode=el('input',{type:'password',autocomplete:'current-password',placeholder:'正式站最高管理員通行碼',class:'release-secret-input','aria-label':'正式站最高管理員通行碼'});
 if(sandbox)promote.parentElement.before(el('label',{class:'li-field'},el('span',{},'正式網站發布授權'),stableCode));
 async function stableCaller(){
  if(!sandbox){if(releaseAuthorizationExpired(deadline))await authenticate();return (action,payload)=>{requireAuth();return ownCall(action,payload);};}
  if(!remote||!remote.snapshot()||releaseAuthorizationExpired(remote.deadline)||stableCode.value){
   if(remote){await remote.logout().catch(()=>remote.forget());}
   remote=createIdentityClient({config:{environment:'stable'}});const code=stableCode.value;stableCode.value='';
   const session=await remote.login(code,'沙盒發布到正式網站');check();
   if(session.person.role!=='owner'||!session.person.permissions?.['technical.release']){await remote.logout();throw Error('需要正式站最高管理員身分');}
   remote={...remote,deadline:releaseAuthorizationDeadline()};authState.textContent='正式站'+releaseAuthorizationMessage(remote.deadline);
  }
  return (action,payload={})=>{check();if(releaseAuthorizationExpired(remote.deadline))throw Error('正式站身分驗證已到期');return remote.service('publisher',{action,payload},{mutation:!['status','verify-public'].includes(action)});};
 }
 function progress(n,message){
  for(const prefix of ['releaseUpload','releaseDeployment']){set(prefix+'ProgressText',n+'%');get(prefix+'ProgressBar').style.width=n+'%';}
  set('releaseDeploymentStepText',message);set('releaseUploadStageText',message);
  set('releaseDeploymentChecks',message);
  ['Validate','Commit','Pages','Manifest'].forEach((key,i)=>{
   const threshold=[30,60,75,100][i], stage=get('releaseUploadStage'+key);
   stage.classList.toggle('done',n>=threshold);
   stage.classList.toggle('active',n<threshold&&(i===0||n>=[30,60,75][i-1]));
  });
 }
 const wait=()=>new Promise(r=>setTimeout(r,4000));
 async function until(fn){
  for(let i=0;;i++){check();try{return await fn();}catch(e){if(i>=44||!['候選檔案尚未部署','入口正等待部署','PAGES_DEPLOYMENT_PENDING','公開入口尚未就緒'].includes(e.code||e.message))throw e;await wait();}}
 }
 async function verifyPublic(call,id){
  await until(async()=>{const r=await call('verify-public');if(r.releaseId!==id)throw Error('公開入口已由另一位管理員更新');});
 }
 async function publish(call,environment,bundle,guard,beforeCommit=async()=>{}){
  guard();const id=bundle.manifest.releaseId;
  progress(40,'正在提交並核對候選版本');const result=await call('stage',bundle);
  if(result.releaseId!==id)throw Error('候選版本回應不一致');
  progress(60,'等待候選版本部署');await until(()=>publicFile(roots[environment]+'site-releases/'+environment+'/'+id+'/site-manifest.json'));
  guard();const status=await call('status');
  if(status.published?.releaseId!==id){
   progress(75,'伺服器正在逐檔核對');const plan=await call('plan',{releaseId:id});
   await beforeCommit();guard();await call('commit',{ticket:plan.ticket,confirm:'CONFIRM_WEBSITE_PUBLISH'});
  }
  progress(90,'等待公開入口部署完成');await verifyPublic(call,id);check();
  progress(100,'公開入口已完成核對');set('releaseDeploymentStatusBadge','已完成');
 }
 async function upload(){
  if(!sandbox||!selected)throw Error('請在沙盒選擇更新檔');
  requireAuth();get('releaseUploadCandidateBtn').disabled=false;await publish(sandboxCall,'sandbox',selected,requireAuth);
  staged=selected.manifest.releaseId;selected=null;get('releaseUploadCandidateBtn').disabled=true;get('releaseOpenUploadedSandboxBtn').disabled=false;await refresh();
 }
 async function inspect(file){
  if(!sandbox)throw Error('正式站上傳已鎖定');
  selected=null;staged=null;get('releaseUploadCandidateBtn').disabled=true;get('releaseOpenUploadedSandboxBtn').disabled=true;set('releaseCandidateValidationState','核對中');set('releaseCandidateVersion','—');set('releaseCandidateFileName',file.name);
  try{
   const data=await inspectWebsiteHtml(file,n=>progress(Math.round(n*25),'逐檔核對完整性'));
   check();selected=await prepareSandbox(data.bundles);set('releaseCandidateVersion',selected.manifest.releaseId);set('releaseCandidateSchema',String(data.schema));
   set('releaseCandidateValidationState','完整');set('releaseCandidateValidationList','已驗證沙盒及正式版，共 '+(data.bundles.stable.files.length+data.bundles.sandbox.files.length)+' 個檔案。');
  }catch(e){set('releaseCandidateValidationState','失敗');set('releaseCandidateValidationList',errorText(e));throw e;}
  if(releaseAuthorizationExpired(deadline)&&password.value)await authenticate();
  if(releaseAuthorizationExpired(deadline)){progress(30,'檔案已核對，請驗證沙盒最高管理員身分以繼續');password.focus();return;}
  await upload();
 }
 async function refresh(){
  const records=await Promise.all(['stable','sandbox'].map(async key=>{
   const label=key==='stable'?'Stable':'Sandbox';
   try{const r=await publicRecord(key);await checkRoot(key,r);check();
    set('release'+label+'VersionText',r.releaseId);set('releaseManifest'+label+'Value',r.releaseId);
    if(key==='stable'){set('releaseManifestPreviousValue',r.previousReleaseId||'原入口');set('releaseManifestSchemaValue',String(r.schema));}
    return {key,r};
   }catch(e){set('release'+label+'VersionText','無法確認');set('releaseManifest'+label+'Value','無法確認');return {key,error:errorText(e)};}
  }));
  check();const history=get('releaseDeploymentHistory');history.replaceChildren();
  const logs=records.flatMap(({key,r})=>(r?.history||[]).map(item=>({...item,key}))).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  for(const item of logs)history.append(el('p',{},new Date(item.createdAt).toLocaleString('zh-TW')+' · '+(item.key==='stable'?'正式':'沙盒')+' · '+item.operation+' · '+item.releaseId));
  if(!logs.length)history.textContent='未取得部署歷史。';
  set('releaseHealthCheckList',records.map(({key,r,error})=>(key==='stable'?'正式':'沙盒')+'入口 '+(r?'已核對 '+r.releaseId:error)).join(' ／ '));
  const sb=records.find(v=>v.key==='sandbox').r, live=records.find(v=>v.key==='stable').r;
  set('releaseDeploymentRouteText',(sb?.releaseId||'未知')+' → 正式入口');set('releaseManifestRevisionText',sb?.createdAt?new Date(sb.createdAt).toLocaleString('zh-TW'):'無法讀取');
  promote.disabled=!sandbox||!sb||!live||sb.releaseId===live.releaseId;
 }
 const header=root.closest('.admin-window')?.querySelector('.window-header .env-sandbox-chip');
 if(header){header.textContent=sandbox?'目前 · 沙盒':'目前 · 正式版';header.style.setProperty('display','inline-flex','important');}
 get('releaseBootstrapNotice').remove();set('releaseCurrentEnvironmentText',sandbox?'沙盒':'正式版');set('releaseCurrentBuildText',running);
 for(const key of ['Stable','Sandbox']){set('release'+key+'VersionText','讀取中');set('releaseManifest'+key+'Value','讀取中');}
 set('releaseManifestPreviousValue','讀取中');set('releaseManifestSchemaValue','讀取中');
 set('releaseCandidateFileMeta',sandbox?'或點擊選擇整站 HTML · 上限 48 MB':'請從沙盒入口上傳更新檔');set('releaseSandboxSeedState','沙盒與正式站使用獨立資料庫。版本發布只處理網站程式。');
 get('releaseReseedSandboxBtn').disabled=true;get('releaseReseedSandboxBtn').title='新版獨立資料庫未提供跨站複製服務';
 get('releaseUploadStageManifest').lastElementChild.textContent='登錄沙盒並核對公開入口';
 get('releaseRegisterSandboxBtn').remove();get('releaseValidateCandidateBtn').remove();
 get('releaseUploadCandidateBtn').textContent='重試建立沙盒';get('releaseUploadCandidateBtn').disabled=true;
 bind('releaseUploadCandidateBtn',upload);bind('releaseManifestRefreshBtn',refresh);bind('releaseHealthCheckBtn',refresh);
 root.querySelector('[data-legacyclick*="loadDeploymentHistory"]').onclick=()=>guarded(refresh);
 for(const [label,key] of [['Stable','stable'],['Sandbox','sandbox']]){
  const value=get('release'+label+'UrlText'),old=value.closest('button');value.textContent=roots[key];
  const link=el('a',{class:old.className,href:roots[key],target:'_blank',rel:'noopener'},...old.childNodes);old.replaceWith(link);
 }
 bind('releaseUploaderTestBtn',async()=>{await ownCall('status');set('releaseUploaderConnectionBadge','服務已連線');});
 get('releaseOpenUploadedSandboxBtn').onclick=()=>{if(staged)window.open(roots.sandbox,'_blank','noopener');};
 set('releaseCandidateFileName',sandbox?'拖曳新版 HTML 到這裡':'正式站已鎖定上傳');
 if(!sandbox){zone.style.opacity='.6';zone.style.cursor='not-allowed';zone.setAttribute('aria-disabled','true');}
 input.disabled=!sandbox;zone.ondragover=e=>e.preventDefault();zone.ondrop=e=>{e.preventDefault();if(!sandbox)return;guarded(async()=>{if(e.dataTransfer.files.length!==1)throw Error('請選擇一個整站更新 HTML');await inspect(e.dataTransfer.files[0]);});};
 input.onchange=()=>{const file=input.files?.[0];input.value='';if(file&&sandbox)guarded(()=>inspect(file));};
 promote.textContent='發布到正式網站入口';promote.style.cssText='padding:12px 20px;background:#13553d;color:white;font-size:14px;font-weight:700;border:1px solid #59b98d;border-radius:10px';promote.disabled=true;
 bind('releasePromoteBtn',async()=>{
  if(!sandbox)throw Error('請從沙盒發布');
  const record=await publicRecord('sandbox');await checkRoot('sandbox',record);
  const bundle=await promotionPayload(record);const call=await stableCaller();
  const latest=await publicRecord('sandbox');if(latest.manifestHash!==record.manifestHash)throw Error('沙盒已更新，請重新核對');
  await publish(call,'stable',bundle,check,async()=>{const latest=await publicRecord('sandbox');if(latest.manifestHash!==record.manifestHash)throw Error('沙盒版本已變更，請重新發布');});await refresh();
 });
 bind('releaseRollbackBtn',async()=>{
  if(!window.confirm('要將正式網站入口回滾到上一個版本嗎？'))return;
  const call=await stableCaller(),plan=await call('rollback-plan');check();
  const result=await call('commit',{ticket:plan.ticket,confirm:'CONFIRM_WEBSITE_PUBLISH'});await verifyPublic(call,result.releaseId);await refresh();progress(100,'正式入口回滾完成');
 });
 refresh().catch(()=>{});
 return {dispose(){disposed=true;password.value='';stableCode.value='';deadline=0;selected=null;if(remote)remote.logout().catch(()=>remote.forget());}};
}
