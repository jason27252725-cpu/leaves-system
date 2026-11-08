import {RealtimeClient} from './realtime.mjs';
import {base,publishableKey} from './public-config.mjs';

export const stages = new Map([[0,'核對沙盒版本'],[40,'提交正式版本'],[55,'等待 GitHub Pages 部署'],[75,'核對版本與正式入口'],[90,'等待正式入口生效'],[100,'正式入口已核對完成']]);

export async function withReleaseJob(client,source,target,display,task) {
 const common={job:crypto.randomUUID(),source,target};
 const write=async(action,percent)=>{
  const response=await client.service('progress',{action,payload:{...common,percent}},{mutation:true});
  if(response.state?.job!==common.job) throw Error('發布進度回應不符');
  return response.state;
 };
 // A lost response may still have created the job. Cleanup is scoped to this UUID.
 let timer;
 try {
  await write('begin');
  display(0,stages.get(0));
  let pulsing=false;
  timer=setInterval(async()=>{if(pulsing)return;pulsing=true;try{await write('pulse');}catch{}finally{pulsing=false;}},15000);
  await task(async(n,message)=>{
   const state=await write(n===100?'complete':'step',n);
   display(state.progress,message);
  });
 }catch(error){
  await write('fail').catch(()=>{});
  if(error.code==='RELEASE_BUSY')throw Error('另一項正式發布正在進行，請等候完成。');
  throw error;
 }finally{clearInterval(timer);}
}

export function subscribeProgress(onState,onWake) {
 let active=true,connected=false,reading=false,queued=false,revision=0;
 const apply=row=>{
  if(active && row?.channel==='stable' && Number.isSafeInteger(row.revision) && row.revision>=revision){
   revision=row.revision;
   onState(row);
  }
 };
 async function refresh(){
  if(!active)return;
  if(reading){queued=true;return;}
  reading=true;
  try{
   const response=await fetch(base+'/rest/v1/leaves_release_progress?channel=eq.stable&select=*',{headers:{apikey:publishableKey},cache:'no-store',signal:AbortSignal.timeout(5000)});
   if(response.ok)apply((await response.json())[0]);
  }catch{}finally{reading=false;if(queued){queued=false;void refresh();}}
 }
 let client;
 try {
 client=new RealtimeClient(base.replace('https:','wss:')+'/realtime/v1',{params:{apikey:publishableKey}});
 client.channel('leaves-formal-release').on('postgres_changes',{event:'*',schema:'public',table:'leaves_release_progress'},event=>apply(event.new))
 .subscribe(status=>{connected=status==='SUBSCRIBED';if(active&&connected)void refresh();});
 }catch{connected=false;}
 let last=0;
 const tick=setInterval(()=>{if(Date.now()-last>=(connected?20000:3000)){last=Date.now();void refresh();}onWake();},1000);
 const ready=refresh();
 return {ready,refresh,stop(){active=false;clearInterval(tick);client?.disconnect();}};
}
