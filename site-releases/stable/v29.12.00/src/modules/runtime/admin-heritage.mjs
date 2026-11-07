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
 const heading=get('autoFreeHealthStatus').parentElement;heading.querySelector('.text-sm').textContent='伺服器調度 · 免費模型候選順序';heading.querySelector('.text-neutral-500').textContent='保留原調度版面；候選順序以伺服器設定為準，單題最多 3 輪。實際可用性依供應商回覆。';
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
export function bindAudit(layout,bridge){
 for(const b of layout.body.querySelectorAll('[data-audit-tab]'))b.onclick=()=>bridge.auditTab(b.dataset.auditTab,b);
 for(const b of layout.body.querySelectorAll('button[data-legacyclick]')){const action=b.dataset.legacyclick;if(action.includes('refreshAuditCenter'))b.onclick=()=>bridge.renderAudit();else if(action.includes('clearAiAuditLogs')){b.textContent='清除本次問答';b.onclick=()=>bridge.clearAudit();}else if(action.includes('toggleQaDiagnosticMode'))b.remove();}
 layout.get('auditPane_storage')?.replaceChildren(el('p',{class:'li-note'},'問答內容與 X-Ray 只留在本次登入記憶體，登出清除；伺服器保存請求狀態與用量收據。歷史紀錄保留。'));
 bridge.renderAudit();
}
