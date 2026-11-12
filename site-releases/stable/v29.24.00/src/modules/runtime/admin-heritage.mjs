import {el,button,table,dialog} from '../shared/dom.mjs';
export function legacyLayout(body,bridge){
 const nodes=bridge.legacyBody?.()||[];if(!nodes.length)return null;
 body.replaceChildren(...nodes);body.classList.add('li-legacy-content');body.parentElement.classList.add('li-heritage');
 for(const n of body.querySelectorAll('*'))for(const a of [...n.attributes])if(a.name.startsWith('on')){n.dataset['legacy'+a.name.slice(2)]=a.value;n.removeAttribute(a.name);}
 return{get:id=>body.querySelector('#'+id),set(id,text){const n=body.querySelector('#'+id);if(n)n.textContent=text;},body};
}
export function usageSummary(attempts,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())){
 const day=a=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(a.started_at));
 const current=attempts.filter(a=>day(a)===today),known=current.filter(a=>Number.isFinite(a.total_tokens)),models=new Map();
 for(const a of attempts){const name=a.model||'尚無模型收據',row=models.get(name)||{name,count:0,success:0,failed:0,tokens:0,unknown:0};row.count++;if(a.outcome==='complete'||a.outcome==='succeeded'||a.outcome==='success')row.success++;else if(a.outcome)row.failed++;if(Number.isFinite(a.total_tokens))row.tokens+=a.total_tokens;else row.unknown++;models.set(name,row);}
 return{today,current,knownTokens:known.reduce((s,a)=>s+a.total_tokens,0),unknown:current.length-known.length,models:[...models.values()].sort((a,b)=>b.count-a.count)};
}
export function renderModelMonitor(layout,usage,models,environmentName='獨立測試站'){
 const {get,set,body}=layout,summary=usageSummary(usage.attempts);
 const heading=get('autoFreeHealthStatus').parentElement;heading.querySelector('.text-sm').textContent='伺服器調度 · 免費模型候選順序';heading.querySelector('.text-neutral-500').textContent='保留原調度版面；候選順序以伺服器設定為準，各題派送次數見診斷。實際可用性依供應商回覆。';
 set('autoFreeHealthStatus','已讀取伺服器狀態');set('routingBestCandidate',models[0]||'未提供');set('routingAvailableCount',models.length+' 個已設定');set('routingDegradedCount','依請求結果觀測');set('routingHardBlockCount','未提供');set('lastAssignedNodeText','最近回覆模型：'+(usage.attempts.find(a=>a.model)?.model||'尚無收據'));
 const ranking=get('modelHealthRankingContainer'),filters=get('modelHealthFilters');filters.replaceChildren();let filter='all';
 const rows=models.map(name=>({name,...summary.models.find(m=>m.name===name)}));
 function paint(){ranking.replaceChildren();for(const r of rows.filter(r=>filter==='all'||filter==='success'&&r.success||filter==='failed'&&r.failed||filter==='unknown'&&!r.count)){const card=el('article',{class:'li-ai-row'},el('header',{},el('strong',{},r.name),el('span',{},r.count?'有請求紀錄':'尚無收據')),el('p',{class:'li-note'},'近期 '+(r.count||0)+' 次 · 成功 '+(r.success||0)+' · 其他結果 '+(r.failed||0)),button('詳細狀態',()=>{const d=dialog(r.name);d.content.append(el('p',{},'這是近期請求觀測，不代表供應商目前健康或剩餘額度。'),el('pre',{},JSON.stringify(r,null,2)));}));ranking.append(card);}if(!ranking.children.length)ranking.append(el('p',{class:'li-note'},'此篩選沒有資料。'));for(const b of filters.children)b.classList.toggle('is-active',b.dataset.filter===filter);}
 for(const [id,label]of [['all','全部'],['success','有成功回覆'],['failed','有其他結果'],['unknown','尚無收據']]){const b=button(label,()=>{filter=id;paint();},'model-health-filter-btn');b.dataset.filter=id;filters.append(b);}paint();
 const rankTitle=filters.parentElement.querySelector('.text-neutral-200');if(rankTitle)rankTitle.textContent='候選模型與近期請求觀測';const rankNote=filters.parentElement.querySelector('.text-neutral-600');if(rankNote)rankNote.textContent='不再使用舊瀏覽器健康分數；以新站實際請求收據呈現。';
 set('companyTelemetryEnvironment',environmentName);set('companyTelemetryStatus','已同步最近 '+usage.attempts.length+' 次請求；不是全歷史總量。');const telemetry=body.querySelector('.company-telemetry-shell .text-neutral-600');if(telemetry)telemetry.textContent='從伺服器讀取跨裝置紀錄，不另存一套用量。';set('dispatchStatsSummary','今日可讀 '+summary.current.length+' · 近期 '+usage.attempts.length+' 次');
 get('dispatchStatsContainer').replaceChildren(...summary.models.map(r=>el('div',{class:'li-ai-row'},el('header',{},el('span',{},r.name),el('span',{},r.count+' 次 · '+(r.count/usage.attempts.length*100).toFixed(1)+'%')),el('div',{class:'li-ai-meter'},el('span',{style:'width:'+(r.count/usage.attempts.length*100)+'%'})))));
 get('dispatchLogsTableBody').replaceChildren(...usage.attempts.slice(0,30).map(a=>el('tr',{},[a.started_at,a.model||'尚無收據',a.outcome||'處理中',a.elapsed_ms==null?'未提供':a.elapsed_ms+' ms',a.total_tokens??'未知'].map(s=>el('td',{class:'p-3'},s)))));
}
export function bindAudit(layout,bridge,api){
 for(const b of layout.body.querySelectorAll('[data-audit-tab]'))b.onclick=()=>bridge.auditTab(b.dataset.auditTab,b);
 for(const b of layout.body.querySelectorAll('button[data-legacyclick]')){const action=b.dataset.legacyclick;if(action.includes('refreshAuditCenter'))b.onclick=()=>bridge.renderAudit();else if(action.includes('clearAiAuditLogs')){b.textContent='清除本次問答';b.onclick=()=>bridge.clearAudit();}else if(action.includes('toggleQaDiagnosticMode')){if(api.person()?.role==='owner'&&api.person()?.environment==='sandbox'){b.textContent='開啟 AI 診斷';b.onclick=()=>{if(api.person()?.role==='owner'&&api.person()?.environment==='sandbox')openDiagnostics();};}else b.remove();}}
 layout.get('auditPane_storage')?.replaceChildren(el('p',{class:'li-note'},'問答內容與 X-Ray 只留在本次登入記憶體，登出清除；伺服器保存請求狀態與用量收據。歷史紀錄保留。'));
 bridge.renderAudit();
}

let panel=null,records=[],rag=null,paint=null;
export const tracing=()=>Boolean(panel?.box.open);
export function clearDiagnostics(){panel?.close();panel=null;records=[];rag=null;paint=null;}
globalThis.window?.addEventListener('leaves:rag-metrics',event=>{if(tracing())rag=event.detail;});
globalThis.window?.addEventListener('leaves:answer-metrics',event=>{if(tracing()&&records[0]){records[0].front={...records[0].front,...event.detail};paint?.();}});
globalThis.window?.addEventListener('leaves:local-diagnostic',event=>{if(tracing())recordAttempt(crypto.randomUUID(),1,{modelCalls:0,queries:0,events:[{ms:0,kind:'本機完成'}]},null,event.detail);});
export function recordAttempt(id,attempt,trace,error,duration){
 if(!tracing())return;
 records.unshift({id,attempt,trace,error,duration,rag});records.length=Math.min(records.length,24);paint?.();
}
const labels={matched:'符合筆數',shown:'本頁明細',page:'頁次',revision:'SOP 版本',candidates:'候選段落',injected:'送入段落',tool:'報表',periods:'期間',status:'狀態',role:'職務',person:'人員範圍',project:'限定專案',action:'查詢',model:'模型',http:'回應碼',error:'原因',duration:'查詢毫秒',headersMs:'收到標頭（毫秒）',tokens:'回傳 Token'};
function printable(x){return Array.isArray(x)?x.map(v=>typeof v==='object'?v.start+' ～ '+v.end:v).join('、'):String(x??'未取得');}
export function openDiagnostics(){
 if(tracing()){panel.box.focus();return;}
 const d=dialog('AI 對話診斷',{modal:false,width:820,height:610,close:()=>{if(panel===d){panel=null;records=[];rag=null;paint=null;}}});
 panel=d;window.LeavesWindowStack?.register(d.box);window.LeavesWindowStack?.raise(d.box);
 d.box.addEventListener('pointerdown',()=>window.LeavesWindowStack?.raise(d.box));
 paint=()=>{
  d.content.replaceChildren();
  if(!records.length){d.content.append(el('p',{},'送出一則聊天訊息後，這裡會顯示本題的檢索與派送紀錄。'));return;}
  d.content.append(el('div',{class:'li-toolbar'},button('清除本次紀錄',()=>{records=[];rag=null;paint();})),el('p',{class:'li-note'},'顯示實際觀測值。模型未提供用量或候選排序時顯示未取得；檢索匹配不代表答案正確率。'));
  for(const [i,r] of records.entries()){
   const t=r.trace, details=el('details',{open:i===0},el('summary',{},'第 '+r.attempt+' 次派送 · '+(r.error||'已完成')+' · '+(r.duration/1000).toFixed(1)+' 秒'));
   const lines=['追蹤編號 '+r.id,'模型呼叫 '+(t?.modelCalls??'未取得')+' 次　報表查詢 '+(t?.queries??'未取得')+' 次'];
   if(r.rag)lines.push('前端 SOP 檢索 '+r.rag.passes+' 輪 · 命中章節 '+(r.rag.sections.join('、')||'無'));
   for(const e of t?.events||[])lines.push(e.ms+' ms　'+e.kind+'　'+Object.entries(e).filter(([k])=>labels[k]).map(([k,v])=>labels[k]+' '+printable(v)).join(' · '));
   const summary=lines.join('\n');
   const events=t?.events||[],models=events.filter(e=>e.kind==='模型回覆'),usage=models.map(e=>e.tokens),known=usage.filter(Number.isSafeInteger);
   const metrics=table(['項目','本題紀錄'],[['追蹤編號',r.id],['模型呼叫',t?.modelCalls??'未取得'],['報表查詢',t?.queries??'未取得'],['總耗時',(r.duration/1000).toFixed(1)+' 秒'],['模型回報 Token',known.length===usage.length&&usage.length?known.reduce((a,b)=>a+b,0):'未完整取得'],['SOP 檢索輪次',r.rag?.passes??'未取得'],['SOP 命中章節',r.rag?.sections?.join('、')||'未取得'],['前端問題分類',r.rag?.intent||'未取得'],['前端匹配／完整度',(r.rag?.match||'未取得')+' / '+(r.rag?.coverage||'未取得')],['主題／據點／欄位',[r.rag?.topic,r.rag?.site,r.rag?.field].map(x=>x||'未取得').join(' / ')],['可回答性',r.rag?.answerability||'未取得'],['Context／全文 Token（估）',(r.rag?.contextTokens??'未取得')+' / '+(r.rag?.fullTokens??'未取得')],['Context 縮減',r.rag?.savingsPct==null?'未取得':r.rag.savingsPct+'%'],['檢索耗時',r.rag?.ragMs==null?'未取得':r.rag.ragMs.toFixed(0)+' ms'],['畫面首段內容時間',r.front?.uiFirstContentMs==null?'未取得':Math.round(r.front.uiFirstContentMs)+' ms'],['畫面完成時間',r.front?.renderMs==null?'未取得':Math.round(r.front.renderMs)+' ms'],['候選模型排序','由伺服器調度，完整排序尚未提供']]);
   const source=el('details',{},el('summary',{},'來源與查詢條件'),table(['階段','條件'],events.filter(e=>['伺服器 SOP','報表條件','資料查詢'].includes(e.kind)).map(e=>[e.kind,Object.entries(e).filter(([k])=>labels[k]).map(([k,v])=>labels[k]+' '+printable(v)).join(' · ')])));
   const dispatch=el('details',{open:true},el('summary',{},'模型派送與排隊'),table(['經過時間','階段','模型','狀態／耗時'],events.filter(e=>!['伺服器 SOP','報表條件','資料查詢'].includes(e.kind)).map(e=>[e.ms+' ms',e.kind,e.model||'—',[e.http,e.error,e.headersMs!=null?e.headersMs+' ms':'',e.tokens!=null?'Token '+e.tokens:''].filter(v=>v!==undefined&&v!=='').join(' · ')])));
   details.append(metrics,source,dispatch,button('複製診斷摘要',async()=>{try{await navigator.clipboard.writeText(summary);d.status.textContent='已複製';}catch{d.status.textContent='請選取上方文字複製';}}));d.content.append(details);
  }
 };
 paint();
}
