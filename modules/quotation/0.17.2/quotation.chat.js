// Shared chat presentation. Logs describe observable operations, never private reasoning.
export function createTaskStatus(panel) {
 const root=document.createElement('div');root.className='ai-runtime-status is-visible leaves-task-status';root.dataset.stage='reasoning';root.setAttribute('role','status');root.setAttribute('aria-live','polite');
 const icon=document.createElement('span');icon.className='ai-runtime-stage-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i>';
 const title=document.createElement('span');title.className='ai-runtime-stage';
 const detail=document.createElement('span');detail.className='ai-runtime-status-text la-state';
 const time=document.createElement('span');time.className='ai-runtime-time';root.append(icon,title,detail,time);panel.prepend(root);
 let timer=0,started=0,disposed=false;
 const tick=()=>{time.textContent=((Date.now()-started)/1000).toFixed(1)+'s';};
 function stop(){if(timer)clearInterval(timer);timer=0;root.classList.remove('is-working');}
 const terminal=new Set(['failed','cancelled','superseded','needs-input','read-only','awaiting-approval','no-change','complete','undone','recovery-required','clarification','blocked']);
 const observer=new MutationObserver(()=>{if(!root.isConnected){stop();observer.disconnect();}});observer.observe(panel.ownerDocument.body,{childList:true,subtree:true});
 return {root,detail,update(text,phase='status'){
  if(disposed)return;detail.textContent=text;
  const done=terminal.has(phase);title.textContent=phase==='awaiting-approval'?'等待確認':phase==='complete'?'操作完成':phase==='undone'?'已復原':phase==='failed'||phase==='recovery-required'?'操作停止':phase==='cancelled'||phase==='superseded'?'已停止':phase==='paused'?'已暫停':/applying|verified|approved|rollback|undo/.test(phase)?'執行操作':/preview|planned|target/.test(phase)?'核對資料':done?'檢查結果':'分析報價';
  root.dataset.phase=phase;
  if(done||phase==='paused'){stop();icon.innerHTML='<i class="fa-solid '+(phase==='complete'||phase==='undone'?'fa-check':phase==='failed'||phase==='recovery-required'?'fa-circle-exclamation':'fa-wand-magic-sparkles')+'"></i>';}
  else{if(!timer){started=Date.now();tick();timer=setInterval(tick,120);}root.classList.add('is-working');icon.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i>';}
 },dispose(){disposed=true;stop();observer.disconnect();}};
}

export function createTaskReply(host,label='操作紀錄') {
 const root=document.createElement('section');root.className='leaves-assistant la-message';root.dataset.localOnly='true';
 const ai=document.createElement('div');ai.className='la-ai-row flex items-start space-x-3 msg-animate';
 const avatar=document.createElement('div');avatar.className='la-avatar ui-no-select';avatar.textContent='AI';
 const panel=document.createElement('div');panel.className='la-panel ai-answer-shell is-settled glass-card text-neutral-200 p-4 rounded-2xl shadow-xl max-w-[88%] selectable-text';
 const progress=createTaskStatus(panel),body=document.createElement('div'),actions=document.createElement('div'),details=document.createElement('details'),log=document.createElement('ol');
 body.className='la-body markdown-body break-words selectable-text';actions.className='la-actions';details.className='la-events';log.className='la-log';const summary=document.createElement('summary');summary.textContent=label;details.append(summary,log);panel.append(body,actions,details);ai.append(avatar,panel);root.append(ai);host.append(root);
 return{root,body,actions,progress,log,record(text,phase){const li=document.createElement('li'),time=document.createElement('time'),span=document.createElement('span');li.className='la-event';li.dataset.phase=phase;time.textContent=new Date().toLocaleTimeString('zh-TW',{hour12:false});span.textContent=text;li.append(time,span);log.append(li);progress.update(text,phase);},dispose(){progress.dispose();root.remove();}};
}

export function confirmCostAction(host,message,{signal}={}) {
 if(!host?.isConnected||signal?.aborted||host.querySelector('[data-cost-action-confirm]'))return Promise.resolve(false);
 return new Promise(resolve=>{
  const box=document.createElement('section');box.className='cost-action-confirm';box.dataset.costActionConfirm='';box.setAttribute('role','dialog');box.setAttribute('aria-label','請確認成本操作');
  const text=document.createElement('p');text.textContent=message;const yes=document.createElement('button'),no=document.createElement('button');yes.textContent='確認執行';yes.dataset.costActionYes='';no.textContent='保留原狀';no.dataset.costActionNo='';box.append(text,yes,no);const controls=[...host.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);for(const [el]of controls)el.disabled=true;host.append(box);
  let settled=false;const done=value=>{if(settled)return;settled=true;observer.disconnect();for(const[el,disabled]of controls)if(el.isConnected)el.disabled=disabled;signal?.removeEventListener('abort',abort);box.remove();resolve(value);},abort=()=>done(false),observer=new MutationObserver(()=>{if(!box.isConnected)done(false);});observer.observe(document.body,{childList:true,subtree:true});signal?.addEventListener('abort',abort,{once:true});yes.onclick=()=>done(true);no.onclick=()=>done(false);yes.focus();
 });
}
