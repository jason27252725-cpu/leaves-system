// Authenticated metadata only. No workbook, costs, model or AI transmission.
const trackers=new WeakMap();
export const getCostUpdates=context=>trackers.get(context)||null;
export function createCostUpdates({context,cost,intervalMs=30000,retryMs=1800,onOpen=()=>{}}){
 let failures=0,sequence=0,disposed=false,started=false,bound='',latest=undefined,pollTimer=null,retryTimer=null,stream=null,polling=false,offSession=null,notice=null;const listeners=new Set();
 const binding=()=>String(context.assistant?.sessionToken?.()||'')+'|'+context.accessRole+'|'+context.environment;
 const allowed=()=>!disposed&&started&&context.getSessionSnapshot?.().authenticated&&binding()===bound;
 const visible=()=>typeof document==='undefined'||document.visibilityState!=='hidden';
 function showNotice(v){
  notice?.remove();notice=null;if(!v||typeof document==='undefined')return;
  const node=document.createElement('aside');node.className='leaves-cost-version-toast';node.setAttribute('role','status');
  const text=document.createElement('span');text.textContent='標準成本已更新至 '+v.label+'。既有報價保留原版本。';
  const open=document.createElement('button');open.textContent='檢視成本';open.onclick=()=>{onOpen();node.remove();if(notice===node)notice=null;};
  const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','關閉成本更新通知');close.onclick=()=>{node.remove();if(notice===node)notice=null;};node.append(text,open,close);document.body.append(node);notice=node;
 }
 function announce(event){if(!allowed()||event.environment!==context.environment)return;const raw=event.version,v=raw?{id:raw.id||null,label:raw.label,publishedAt:raw.publishedAt}:null;if(v&&(typeof v.label!=='string'||v.label.length>80||!v.publishedAt))return;if(latest&&!v)return;if(latest&&v&&Number.isFinite(Date.parse(latest.publishedAt))&&Date.parse(v.publishedAt)<Date.parse(latest.publishedAt))return;const same=JSON.stringify(v)===JSON.stringify(latest);const hadBaseline=latest!==undefined;latest=v;sequence++;if(!same&&hadBaseline&&v)showNotice(v);if(!same)for(const fn of [...listeners])try{fn({environment:context.environment,version:v});}catch{};}
 async function poll(){if(!allowed()||!visible()||polling)return;polling=true;const at=bound,requestSequence=sequence;try{const result=await cost.current();if(allowed()&&bound===at&&sequence===requestSequence&&result.environment===context.environment)announce({environment:context.environment,version:result.version?{id:result.version.id||null,label:result.version.label,publishedAt:result.version.publishedAt}:null});}catch{}finally{polling=false;}}
 function pauseStream(){if(retryTimer)clearTimeout(retryTimer);retryTimer=null;stream?.abort();stream=null;}
 async function connect(){if(!allowed()||!visible()||stream||typeof cost.watchVersions!=='function')return;const controller=new AbortController();stream=controller;const at=bound;try{await cost.watchVersions({signal:controller.signal,onVersion:event=>{if(allowed()&&bound===at)announce(event);}});failures=0;}catch{failures=Math.min(5,failures+1);}finally{if(stream===controller)stream=null;if(allowed()&&visible()&&!controller.signal.aborted)retryTimer=setTimeout(connect,Math.min(30000,retryMs*2**failures));}}
 function wake(){if(!allowed())return;if(visible()){void poll();void connect();}else pauseStream();}
 function stop(){started=false;notice?.remove();notice=null;pauseStream();if(pollTimer)clearInterval(pollTimer);pollTimer=null;globalThis.document?.removeEventListener?.('visibilitychange',wake);globalThis.window?.removeEventListener?.('focus',wake);globalThis.window?.removeEventListener?.('online',wake);offSession?.();offSession=null;}
 const api=Object.freeze({get latest(){return latest;},announce,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  start(){if(disposed||started||!context.getSessionSnapshot?.().authenticated||cost.health?.().configured===false)return;started=true;const nextBound=binding();if(bound!==nextBound)latest=undefined;bound=nextBound;offSession=context.assistant?.subscribeState?.(()=>{if(!allowed())stop();});void poll();void connect();pollTimer=setInterval(poll,intervalMs);globalThis.document?.addEventListener?.('visibilitychange',wake);globalThis.window?.addEventListener?.('focus',wake);globalThis.window?.addEventListener?.('online',wake);},
  stop,dispose(){stop();disposed=true;listeners.clear();if(trackers.get(context)===api)trackers.delete(context);}});
 trackers.set(context,api);return api;
}
