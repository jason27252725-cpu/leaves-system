export function createTeamFeed({read,watch,onData,onState=()=>{},visible=()=>!document.hidden,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,backupMs=300000,environment}){
 let disposed=false,generation=0,date='',version='',loading=false,queued=false,request=null,subscription=null,notice=null,backup=null,retry=null,retryMs=1000,lastRead=0;
 const clear=id=>{if(id!==null)clearTimer(id);};
 async function load(force=false){
  if(disposed||!date||!visible())return;if(loading){queued=true;return;}loading=true;
  const at=generation,day=date,controller=new AbortController();request=controller;onState('syncing');
  try{const r=await read(force?'team.day':'team.probe',{date:day,...(!force&&version?{knownVersion:version}:{})},controller.signal);
   if(disposed||at!==generation)return;if(r.date!==day||typeof r.version!=='string'||environment&&r.environment!==environment)throw Object.assign(Error('團隊進度資料環境或日期不一致'),{code:'ENVIRONMENT_FORBIDDEN'});
   lastRead=now();version=r.version;if(!r.notModified)onData(r);onState('synced');
  }catch(e){if(disposed||at!==generation||controller.signal.aborted)return;onState('error',e);if(['AUTH_REQUIRED','AUTH_REVOKED','FORBIDDEN'].includes(e.code))dispose();}
  finally{if(at===generation){loading=false;request=null;if(queued){queued=false;notify();}}}
 }
 function notify(){if(disposed||notice!==null||!visible())return;notice=setTimer(()=>{notice=null;void load();},400);}
 function listen(){
  if(disposed||!visible()||subscription)return;const at=generation,controller=new AbortController(),day=date;subscription=controller;
  Promise.resolve().then(()=>watch(day,{signal:controller.signal,onEvent:e=>{
   if(disposed||at!==generation||controller.signal.aborted||e.date!==date||environment&&e.environment!==environment)return;
   if(e.type==='ready'){retryMs=1000;onState('connected');notify();}else if(e.type==='changed')notify();
  }})).catch(e=>{if(!controller.signal.aborted&&at===generation){onState('fallback',e);if(['AUTH_REQUIRED','AUTH_REVOKED','FORBIDDEN'].includes(e.code))dispose();}}).finally(()=>{
   if(disposed||at!==generation||subscription!==controller)return;subscription=null;if(visible()){retry=setTimer(()=>{retry=null;listen();},retryMs);retryMs=Math.min(30000,retryMs*2);}
  });
 }
 function scheduleBackup(){clear(backup);backup=setTimer(()=>{backup=null;if(visible())void load();if(!disposed)scheduleBackup();},backupMs);}
 function setDate(value){generation++;request?.abort();subscription?.abort();subscription=null;loading=false;queued=false;clear(notice);clear(retry);notice=retry=null;date=value;version='';lastRead=0;listen();void load(true);scheduleBackup();}
 function focus(){if(disposed)return;if(visible()){listen();if(now()-lastRead>30000)notify();}else{subscription?.abort();subscription=null;clear(retry);retry=null;}}
 function dispose(){if(disposed)return;disposed=true;generation++;request?.abort();subscription?.abort();for(const timer of [notice,backup,retry])clear(timer);}
 return{setDate,refresh:()=>load(true),notify,focus,dispose};
}
export function teamCardOrder(people,role=''){return people.filter(x=>x.submittedAt&&(!role||x.p.role===role)).sort((a,b)=>Date.parse(a.firstSubmittedAt||a.submittedAt)-Date.parse(b.firstSubmittedAt||b.submittedAt)||a.p.employeeId.localeCompare(b.p.employeeId));}
export function teamPositionKey(p){if(/3D|渲染|攝影/i.test(p.position||''))return'visual';return ['owner','boss','supervisor','designer','accountant','intern'].includes(p.role)?p.role:'unknown';}
