// Reconstructed from deployed r18 gateway contracts on 2026-10-31.
// This is new candidate code, not a recovered copy of the missing frontend.
const ENDPOINT='https://gjeenpvcvcmfnwlvmriv.supabase.co/functions/v1/leaves-identity-gateway';
const error=(code,verificationRequired=false)=>Object.assign(new Error(code),{code,verificationRequired});
const validToken=t=>typeof t==='string'&&/^lid1_[a-f0-9]{64}$/.test(t);
export function createIdentityClient({fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=20000,config=globalThis.LEAVES_IDENTITY_CONFIG}={}){
 const environment=config?.environment||'sandbox';
 const expected=environment==='stable'?'https://dadlmrmzupmmzthlvrmo.supabase.co/functions/v1/leaves-identity-gateway':ENDPOINT;
 if(!['sandbox','stable'].includes(environment)||(config?.endpoint&&config.endpoint!==expected))throw error('ENVIRONMENT_FORBIDDEN');
 const endpointBase=expected,routerBase=environment==='stable'?expected.replace('leaves-identity-gateway','leaves-identity-site-router'):expected.replace('leaves-identity-gateway','leaves-site-router');
 let epoch=0,session=null,preview=null,previewSequence=0;
 const inflight=new Set();
 function clear(){epoch++;session=null;preview=null;previewSequence++;for(const c of inflight)c.abort();inflight.clear();}
 function snapshot(){return session?structuredClone({person:session.person,expiresAt:session.expiresAt,maintenance:session.maintenance||{active:false,message:''}}):null;}
 function active(){if(!session||session.expiresAt<=now()){clear();throw error('AUTH_REQUIRED');}return session;}
 async function send(body,{authToken=null,mutation=false,capturedEpoch=epoch,service='identity',signal=null,requestTimeout=timeoutMs}={}){
  const controller=new AbortController();inflight.add(controller);
  const cancel=()=>controller.abort();if(signal?.aborted){inflight.delete(controller);throw error('AI_CANCELLED');}signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,service==='identity'?requestTimeout:Math.max(timeoutMs,180000));
  try{
   const endpoint=service==='progress'?endpointBase.replace('leaves-identity-gateway','leaves-release-progress'):service==='identity'?endpointBase:service==='release'?endpointBase+'/release':service==='publisher'?endpointBase.replace('leaves-identity-gateway','leaves-website-publisher'):routerBase;
   const r=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(service==='release'?{'x-leaves-environment':environment}:{}),...(authToken?{Authorization:'Bearer '+authToken}:{})},body:JSON.stringify({...body,environment}),signal:controller.signal,redirect:'error',cache:'no-store'});
   const data=await r.json();
   if(capturedEpoch!==epoch)throw error('STALE_SESSION',mutation);
   if(signal?.aborted)throw error('AI_CANCELLED');
   if(!r.ok||data?.ok!==true){
    const code=/^[A-Z][A-Z0-9_]{1,80}$/.test(data?.code||'')?data.code:'SERVICE_UNAVAILABLE';
    if(['AUTH_REQUIRED','AUTH_REVOKED'].includes(code))clear();
    throw error(code,!!data?.verificationRequired||(mutation&&r.status>=500));
   }
   return data;
  }catch(e){
   if(capturedEpoch!==epoch&&e.code!=='AUTH_REQUIRED'&&e.code!=='AUTH_REVOKED')throw error('STALE_SESSION',mutation);
   if(typeof e.code==='string')throw e;
   if(signal?.aborted)throw error('AI_CANCELLED');
   throw error('SERVICE_UNAVAILABLE',mutation);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);inflight.delete(controller);}
 }
 function validPerson(p){return p&&typeof p.employeeId==='string'&&p.employeeId.length>0&&p.environment===environment&&p.state==='active'&&p.permissions&&typeof p.permissions==='object'&&!Array.isArray(p.permissions);}
 async function login(code,device='裝置'){
  clear();const capturedEpoch=epoch;
  if(typeof code!=='string'||!code.trim()||code.length>160)throw error('AUTH_FAILED');
  const data=await send({action:'login',code:code.trim(),device},{capturedEpoch});
  if(!validToken(data.token)||!validPerson(data.person)||!Number.isFinite(data.expiresAt)||data.expiresAt<=now())throw error('INVALID_SESSION');
  session={token:data.token,person:structuredClone(data.person),expiresAt:data.expiresAt};return snapshot();
 }
 async function call(action,payload={},options={}){
  // Identity mutation is only available through preview/confirm below.
  if(['login','logout','plan','commit'].includes(action)||action.startsWith('public.'))throw error('USE_EXPLICIT_METHOD');
  const s=active();return send({action,payload},{authToken:s.token,mutation:options.mutation!==false,signal:options.signal,requestTimeout:action==='ai.chat'?70000:timeoutMs});
 }
 async function refresh({visible=true}={}){
  const s=active(),data=await send({action:'me',payload:{visible}},{authToken:s.token});
  if(!validPerson(data.person)||data.person.employeeId!==s.person.employeeId){clear();throw error('INVALID_SESSION');}
  if(data.person.revision!==s.person.revision){preview=null;previewSequence++;}
  session={...s,person:structuredClone(data.person),maintenance:structuredClone(data.maintenance||{active:false,message:''})};return snapshot();
 }
 async function plan(payload){
  const s=active(),seq=++previewSequence;preview=null;
  const data=await send({action:'plan',payload},{authToken:s.token,mutation:true});
  if(seq!==previewSequence)throw error('STALE_PREVIEW');
  const expiresAt=Date.parse(data.expiresAt);
  if(typeof data.planId!=='string'||!data.preview||!Number.isFinite(expiresAt)||expiresAt<=now())throw error('INVALID_PREVIEW');
  preview={id:data.planId,expiresAt};return structuredClone(data);
 }
 async function confirm(planId,confirmation){
  const s=active();
  if(confirmation!=='CONFIRM_IDENTITY_CHANGE')throw error('CONFIRMATION_REQUIRED');
  if(!preview||preview.id!==planId||preview.expiresAt<=now())throw error('STALE_PREVIEW');
  // Consume before sending: double clicks and uncertain responses never auto-repeat a write.
  preview=null;previewSequence++;
  return send({action:'commit',payload:{planId,confirm:confirmation}},{authToken:s.token,mutation:true});
 }
 async function logout(){
  const old=session;clear();if(!old)return {ok:true,serverRevoked:false};
  // Capture the new epoch so a late logout response cannot invalidate another login.
  await send({action:'logout',payload:{}},{authToken:old.token,mutation:true});
  return {ok:true,serverRevoked:true};
 }
 function leavePresence(){if(!session)return;fetchImpl(endpointBase,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify({action:'presence',environment,payload:{action:'leave'}}),keepalive:true,redirect:'error',cache:'no-store'}).catch(()=>{});}
 return Object.freeze({login,logout,refresh,call,plan,confirm,snapshot,forget:clear,leavePresence,
  service:(service,body,{mutation=false}={})=>{if((service==='progress'&&environment!=='stable')||!['release','router','publisher','progress'].includes(service))throw error('BAD_SERVICE');return send(body,{authToken:active().token,mutation,service});},
  status:()=>send({action:'public.status'}),
  branding:()=>send({action:'public.branding'}),
  cancelPreview:()=>{preview=null;previewSequence++;}});
}
