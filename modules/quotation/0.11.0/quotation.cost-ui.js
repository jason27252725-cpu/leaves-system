import {requirements,decimal,copy,canonical} from './quotation.cost-match.js';
import {createTaskReply} from './quotation.chat.js';
const ID='leavesCostAnalysis',STATUS={pending:'待比對',confirmed:'已確認',stale:'資料變更，需重核'};
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const labels={widthCm:'寬 W（cm）',depthCm:'深 D（cm）',heightCm:'高 H（cm）',thicknessMm:'厚度（mm）'};
const taxText=x=>x==='inclusive'?'含稅成本':'未稅成本';
function download(data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='LEAVES-INTERNAL-COST-ANALYSIS-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function createCostAnalysisUI({context,analysis,workspace}){
 let root=null,win=null,selected='',filter='',page=0,error='',busy='',controller=null,generation=0,disposed=false,lastBinding='',activePreview=null,chatObserver=null;
 let category='all',conventions={taxBasis:'',rounding:'exact',note:'',confirmed:false},lastData='',candidateCache=new Map();
 const forms=new Map(),aiResults=new Map(),chatTasks=new Set();
 function currentKey(){return canonical([context.assistant?.sessionToken?.(),context.accessRole,workspace.getActiveDraftId?.()]);}
 function stop(){generation++;controller?.abort();controller=null;busy='';}
 function invalidate(){analysis.cancelPreview();activePreview=null;for(const node of chatTasks){const b=node.querySelector('[data-cost-confirm]');if(b&&!b.disabled){b.disabled=true;b.textContent='比較已失效，請重新預覽';}}}
 function formFor(row){let f=forms.get(row.id);const stamp=canonical(row);if(!f||f.rowStamp!==stamp){f={rowId:row.id,rowStamp:stamp,itemCode:'',quantity:decimal(row.qty)??'',rounding:'exact',currency:'',taxBasis:'',note:'',conversionNote:'',scope:'',parentId:'',conditionsConfirmed:false,quantityConfirmed:false,remember:false};forms.set(row.id,f);}return f;}
 function selectedState(v){return v.rows.find(x=>(x.row||x).id===selected)||null;}
 function message(text){error=String(text||'');const box=root?.querySelector('[data-cost-message]');if(box)box.textContent=error;}
 function sourceHtml(v){const s=v.snapshot;return `<div class="qcm-source"><b>${esc(s.identity.label)} · 固定內容 ${esc(s.hash.slice(0,12))}</b><span>${esc(s.version.sourceDocumentName||'來源名稱未提供')} · 生效日 ${esc(s.version.effectiveDate||'未提供，請逐案核對')}</span><small>固定於本草稿；Current 後續變更不會自動改價。版本以環境＋唯一標籤識別（既有介面未提供 UUID）。</small></div>`;}
 function suggestedForm(row,v){
  const f=formFor(row),choices=(candidateCache.get(row.id)||analysis.choices(row.id)),best=choices[0],second=choices[1];
  if(!f.itemCode&&best&&!aiResults.has(row.id)){
   const item=v.snapshot.items.find(i=>i.itemCode===best.itemCode),r=requirements(row,item,{});
   // A fuzzy rank is an invitation to review, never an approval to price.
   if(!r.conflicts.length&&!r.hold&&r.known&&(!second||best.score>second.score))f.itemCode=item.itemCode;
  }
  const item=v.snapshot.items.find(i=>i.itemCode===f.itemCode);
  if(item){const r=requirements(row,item,f);for(const[k,value]of Object.entries(r.observed||{}))if(value!=null)f[k]=value;
   const exact=String(row.itemName).replace(/\s/g,'')===String(item.itemName).replace(/\s/g,'');
   if(!f.manual&&conventions.confirmed&&exact&&!r.missing.length&&!r.conflicts.length&&!r.hold&&r.known&&row.unit===item.unit){f.currency=item.currency;f.taxBasis=conventions.taxBasis;f.rounding=conventions.rounding;f.note=conventions.note;f.conditionsConfirmed=true;f.quantityConfirmed=true;}
  }return f;
 }
 const kindLabel={ready:'可確認',decision:'需補資料',unmatched:'沒有適用標準價',confirmed:'已確認'};
 function editor(v,entry){
  if(!entry)return '<p class="qcm-empty">點選需要處理的項目，補足缺少的資訊；其餘欄位會沿用已讀取的依據。</p>';
  const row=entry.row,f=suggestedForm(row,v),choices=(candidateCache.get(row.id)||analysis.choices(row.id)),ai=aiResults.get(row.id),item=v.snapshot.items.find(i=>i.itemCode===f.itemCode),r=item?requirements(row,item,f):null,rejected=ai?.itemCode===null;
  return `<div class="qcm-row-source"><strong>${esc(row.sheet)}!${esc(row.address)} · ${esc(row.itemName)}</strong><p>報價數量 ${esc(row.qty)} ${esc(row.unit)}</p><button data-cost-locate>定位這一列</button></div>
  ${ai?`<p class="qcm-ai-result">${esc(ai.itemCode?'AI 建議 '+ai.itemCode:'AI 判斷沒有適用候選')}：${esc(ai.reason)}${ai.questions.map(q=>'<br>待確認：'+esc(q)).join('')}</p>`:''}
  <div class="qcm-candidates">${choices.map(c=>{const i=v.snapshot.items.find(x=>x.itemCode===c.itemCode);return `<button data-cost-choice="${esc(c.itemCode)}" class="${f.itemCode===c.itemCode?'is-selected':''}">${esc(i.itemName)} · ${c.match.conflicts.length?'規格不符，需另找標準':c.match.missing.length?'需補規格':'核對候選'}</button>`;}).join('')}</div>
  <button data-cost-ai ${busy||!choices.length?'disabled':''}>${busy==='ai'?'AI 正在核對…':'請 AI 協助判斷'}</button>
  ${rejected?'<p class="qcm-conflict">此項保留待決，沒有採用價格。若有新的依據，可重新選擇候選。</p>':item?`<div class="qcm-standard"><b>${esc(item.itemCode+' · '+item.itemName)}</b><p>${esc(item.currency)} ${esc(item.unitCost)} / ${esc(item.baseQty)} ${esc(item.unit)}</p><small>${esc(item.specDescription||'')} · ${esc(r.note)}</small>${r.conflicts.map(x=>'<p class="qcm-conflict">'+esc(x)+'</p>').join('')}</div>
  ${r.conflicts.length||r.hold||!r.known?'<p class="qcm-conflict">規格或計價規則尚未符合，此候選不能確認。請更換標準或另行詢價。</p>':`
  ${Object.entries(labels).filter(([k])=>r.expectedDimensions?.[k]!=null&&r.observed[k]==null).map(([k,label])=>`<label>請補 ${label}<input data-cost-field="${k}" inputmode="decimal" value="${esc(f[k]||'')}"></label>`).join('')}
  <label>計價數量（${esc(item.unit)}）<input data-cost-field="quantity" inputmode="decimal" value="${esc(f.quantity)}"></label>
  ${row.unit!==item.unit||decimal(row.qty)!==decimal(f.quantity)?`<label>單位／數量換算依據<textarea data-cost-field="conversionNote">${esc(f.conversionNote)}</textarea></label>`:''}
  ${r.addon?`<label>所屬主項<select data-cost-field="parentId"><option value="">請選擇已確認主項</option>${v.rows.filter(x=>x.status==='confirmed'&&x.saved.kind==='base').map(x=>`<option value="${esc(x.row.id)}" ${f.parentId===x.row.id?'selected':''}>${esc(x.row.itemName)}</option>`).join('')}</select></label>`:''}
  ${r.job||r.addon?`<label>具體部位／工地批次<input data-cost-field="scope" value="${esc(f.scope)}"></label>`:''}
  ${item.itemCode==='SC-036'?`<label>無電梯搬運樓層（只支援3F）<input data-cost-field="floor" value="${esc(f.floor||'')}"></label>`:''}
  ${item.itemCode==='SC-023'?`<label>開孔實測尺寸（cm）<input data-cost-field="openingCm" value="${esc(f.openingCm||'')}"></label>`:''}
  <div class="qcm-fields"><label>來源稅別<select data-cost-field="taxBasis"><option value="">請確認</option><option value="exclusive" ${f.taxBasis==='exclusive'?'selected':''}>未稅</option><option value="inclusive" ${f.taxBasis==='inclusive'?'selected':''}>含稅</option></select></label><label>幣別<select data-cost-field="currency"><option value="">請確認</option><option value="${esc(item.currency)}" ${f.currency===item.currency?'selected':''}>${esc(item.currency)}</option></select></label></div>
  <label>本案計價依據／包含與排除<textarea data-cost-field="note" placeholder="已有資料會帶入；僅補充本案缺少的條件">${esc(f.note)}</textarea></label>
  <label class="qcm-check"><input type="checkbox" data-cost-field="conditionsConfirmed" ${f.conditionsConfirmed?'checked':''}>已核對種類、規格及包含／排除</label><label class="qcm-check"><input type="checkbox" data-cost-field="quantityConfirmed" ${f.quantityConfirmed?'checked':''}>已核對數量、最低量與損耗</label>
  <button data-cost-preview ${busy?'disabled':''}>預覽這一項，至聊天室確認</button>
  <details><summary>進階資料</summary><label>小數處理<select data-cost-field="rounding">${[['exact','保留精確值'],['0','四捨五入至整元'],['2','小數2位']].map(([k,l])=>`<option value="${k}" ${f.rounding===k?'selected':''}>${l}</option>`).join('')}</select></label><label class="qcm-check"><input type="checkbox" data-cost-field="remember" ${f.remember?'checked':''}>記住名稱對應，僅提示本草稿</label><p>已讀規格：${esc(JSON.stringify(r.observed))}</p></details>`}`:''}`;
 }
 function render(){
  if(!root||disposed)return;let v;try{v=analysis.view();}catch(e){root.textContent=e.message;return;}
  // Classification is read-only. Never replace an active comparison ticket.
  candidateCache=new Map(v.ready?analysis.choicesBatch():[]);
  const kinds=new Map(v.ready?v.rows.map(x=>[x.row.id,classifyWithoutTicket(x,v)]):[]),counts={ready:0,decision:0,unmatched:0,confirmed:0};for(const k of kinds.values())counts[k]++;
  const matches=v.ready?v.rows.filter(x=>(category==='all'||kinds.get(x.row.id)===category)&&(x.row.itemName+' '+x.row.sheet).includes(filter)):[];page=Math.min(page,Math.max(0,Math.ceil(matches.length/20)-1));
  root.innerHTML=`<div class="qcm-inline-head"><strong>標準成本檢核</strong><span>確認後保存內部分析</span></div><p class="qcm-status" role="status" data-cost-message>${esc(error||busy==='load'&&'正在核對授權標準成本…'||busy==='ai'&&'AI 正在核對這一項，尚未修改。'||'')}</p>
  ${!v.ready?'<div class="qcm-start"><p>使用目前授權的標準成本，找出可沿用項目與缺少的條件。</p><button data-cost-load '+(busy?'disabled':'')+'>檢查標準成本</button></div>':`
  <div class="qcm-summary"><div>${Object.entries(kindLabel).map(([k,l])=>`<button data-cost-category="${k}" class="${category===k?'is-selected':''}">${l} ${counts[k]}</button>`).join('')}<button data-cost-category="all">全部</button></div>${v.totals.map(t=>`<b>已確認部分 ${esc(t.currency)} ${esc(t.amount)} · ${taxText(t.taxBasis)}</b>`).join('')}<small>待決項目未計入，這不是全案總成本。對客報價不會被覆寫。</small><button data-cost-batch ${counts.ready&&!busy?'':'disabled'}>預覽可確認項目（最多100項）</button></div>
  <details class="qcm-conventions"><summary>本草稿共用計價條件</summary><p>只套用名稱完全相符、規格及單位均已符合的列；其他列仍逐項核對。不會形成公司通用規則。</p><label>來源稅別<select data-cost-convention="taxBasis"><option value="">請核對來源</option><option value="exclusive" ${conventions.taxBasis==='exclusive'?'selected':''}>未稅</option><option value="inclusive" ${conventions.taxBasis==='inclusive'?'selected':''}>含稅</option></select></label><label>共用計價依據<textarea data-cost-convention="note">${esc(conventions.note)}</textarea></label><label class="qcm-check"><input type="checkbox" data-cost-convention="confirmed" ${conventions.confirmed?'checked':''}>已核對以上條件適用於這些完全相符的項目；特殊計價仍另外確認</label></details>
  <div class="qcm-body"><nav class="qcm-list"><label>搜尋項目<input data-cost-filter value="${esc(filter)}"></label>${matches.slice(page*20,page*20+20).map(x=>`<button data-cost-row="${esc(x.row.id)}" class="${selected===x.row.id?'is-selected':''}"><small>${kindLabel[kinds.get(x.row.id)]} · ${esc(x.row.sheet+'!'+x.row.address)}</small><strong>${esc(x.row.itemName)}</strong></button>`).join('')}<div class="qcm-pages"><button data-cost-page="-1" ${page?'':'disabled'}>上一頁</button><span>${page+1}/${Math.max(1,Math.ceil(matches.length/20))}</span><button data-cost-page="1" ${(page+1)*20<matches.length?'':'disabled'}>下一頁</button></div></nav><section class="qcm-editor">${editor(v,selectedState(v))}</section></div>
  <details class="qcm-advanced"><summary>來源版本與匯出紀錄</summary>${sourceHtml(v)}<p>分析僅保留本次工作階段，關閉頁面前請匯出。</p><button data-cost-export>匯出內部分析 JSON</button></details>`}`;
 }
 function classifyWithoutTicket(entry,v){
  if(entry.status==='confirmed')return'confirmed';const f=suggestedForm(entry.row,v),i=v.snapshot.items.find(x=>x.itemCode===f.itemCode);if(!i||aiResults.get(entry.row.id)?.itemCode===null)return'unmatched';const r=requirements(entry.row,i,f);if(r.hold||!r.known||r.conflicts.length)return'unmatched';
  if(!f.conditionsConfirmed||!f.quantityConfirmed||!f.currency||!f.taxBasis||String(f.note||'').length<8)return'decision';
  try{analysis.checkInput(f);return'ready';}catch{return'decision';}
 }
 function appendPreview(p){
  const host=context.getChatContainer?.();if(!host)throw Error('聊天室尚未就緒');activePreview=p.id;
  const reply=createTaskReply(host),node=reply.root;node.dataset.costTask=p.id;node._reply=reply;const rows=p.rows||[{before:p.before,after:p.after}];
  reply.body.innerHTML=`<p>請核對 ${rows.length} 項內部成本比較，尚未保存。</p><div class="la-table-wrap qcm-table-scroll"><table><thead><tr><th>報價項目</th><th>原分析</th><th>確認後</th></tr></thead><tbody>${rows.map(({before:b,after:a})=>`<tr><td>${esc(a.sheet+'!'+a.address+' '+a.itemName)}</td><td>${b?esc(b.currency+' '+b.amount):'未計入'}</td><td>${esc(a.itemCode+' · '+a.currency+' '+a.amount)}<br>${esc(a.calculation)}<br>${taxText(a.taxBasis)}<br>${esc(a.note)}${a.conversionNote?'<br>換算：'+esc(a.conversionNote):''}${a.scope?'<br>範圍：'+esc(a.scope):''}</td></tr>`).join('')}</tbody></table></div><p>${esc(p.warning)}</p>`;
  const confirm=document.createElement('button'),cancel=document.createElement('button'),undo=document.createElement('button');confirm.textContent='確認保存內部成本';confirm.dataset.costConfirm='';cancel.textContent='取消';undo.textContent='復原本次保存';undo.hidden=true;reply.actions.append(confirm,cancel,undo);reply.record('已核對成本來源、規格、數量與計價條件，等待確認。','awaiting-approval');
  confirm.onclick=()=>{confirm.disabled=true;try{if(activePreview!==p.id||!host.contains(node)||workspace.getStatus?.().executionLocked)throw Error('比較已失效或報價正在執行其他操作');const saved=p.rows?analysis.applyBatch(p.id):analysis.apply(p.id);activePreview=null;reply.record(`已保存並核對 ${rows.length} 項內部分析，Excel 與對客售價未變動。`,'complete');cancel.disabled=true;undo.hidden=false;undo.onclick=()=>{try{if(!host.contains(node))throw Error('操作紀錄已移除');if(p.rows)analysis.undoBatch(saved.id);else analysis.undo(saved.receiptId);reply.record('已復原本次內部分析保存。','undone');undo.disabled=true;render();}catch(e){reply.record(e.message,'failed');}};render();}catch(e){reply.record(e.message,'failed');}};
  cancel.onclick=()=>{if(activePreview===p.id)invalidate();confirm.disabled=true;cancel.disabled=true;reply.record('已取消，未保存內部成本。','cancelled');};
  if(!chatObserver){chatObserver=new MutationObserver(()=>{for(const old of chatTasks)if(!host.contains(old)){if(old.dataset.costTask===activePreview)invalidate();old._reply?.dispose();chatTasks.delete(old);}});chatObserver.observe(host,{childList:true});}
  chatTasks.add(node);context.ui?.openChat?.();context.ui?.scrollChatToBottom?.();
 }
 async function run(kind,fn){stop();const at=++generation,key=currentKey();controller=new AbortController();const signal=controller.signal;busy=kind;error='';let reply=null;if(kind==='ai'&&context.getChatContainer?.()){reply=createTaskReply(context.getChatContainer());chatTasks.add(reply.root);reply.root._reply=reply;reply.record('正在核對本列與候選規格；只提供必要文字，不含成本價格或模型。','status');context.ui?.openChat?.();}render();try{const result=await fn(signal);if(disposed||at!==generation||currentKey()!==key){reply?.record('工作資料已變更，結果已捨棄。','superseded');return;}if(reply){reply.body.textContent=result?(result.reason+' '+result.questions.map(q=>'待確認：'+q).join('；')):'本列候選判讀已完成，請核對成本檢核中的建議。';reply.record('候選判讀完成，尚未修改或保存成本。','read-only');}return result;}catch(e){if(at===generation&&!disposed){error=String(e.message||e);reply?.record('候選判讀未完成：'+error,'failed');}}finally{if(reply&&signal.aborted)reply.record('已取消候選判讀。','cancelled');if(at===generation&&!disposed){busy='';controller=null;render();}}}
 async function click(e){const b=e.target.closest('button');if(!b||!root?.contains(b))return;
  try{
   if(workspace.getStatus?.().executionLocked)throw Error('報價正在逐步修改，請完成後再處理成本');
   if(b.hasAttribute('data-cost-category')){category=b.dataset.costCategory;page=0;render();return;}
   if(b.hasAttribute('data-cost-locate')){const v=analysis.view(),entry=selectedState(v);if(entry)workspace.locate?.({sheet:entry.row.sheet,address:entry.row.address});return;}
   if(b.hasAttribute('data-cost-batch')){const v=analysis.view(),inputs=v.rows.filter(x=>classifyWithoutTicket(x,v)==='ready').slice(0,100).map(x=>copy(forms.get(x.row.id)));invalidate();appendPreview(analysis.previewBatch(inputs));return;}
   if(b.hasAttribute('data-cost-close')){stop();return;}
   if(b.hasAttribute('data-cost-load')){await run('load',signal=>analysis.load({signal}));return;}
   if(b.hasAttribute('data-cost-row')){stop();invalidate();selected=b.dataset.costRow;error='';render();return;}
   if(b.hasAttribute('data-cost-page')){page+=Number(b.dataset.costPage);render();return;}
   if(b.hasAttribute('data-cost-choice')){stop();invalidate();const v=analysis.view(),entry=selectedState(v),f=formFor(entry.row);aiResults.delete(selected);f.manual=true;Object.assign(f,{itemCode:b.dataset.costChoice,currency:'',conditionsConfirmed:false,quantityConfirmed:false});error='';render();return;}
   if(b.hasAttribute('data-cost-ai')){const id=selected;await run('ai',async signal=>{const result=await analysis.suggest(id,{signal});if(!signal.aborted){aiResults.set(id,result);const f=forms.get(id);if(f){f.itemCode=result.itemCode||'';f.conditionsConfirmed=false;f.quantityConfirmed=false;f.manual=true;}}return result;});return;}
   if(b.hasAttribute('data-cost-preview')){invalidate();const f=forms.get(selected);const p=analysis.preview(copy(f));appendPreview(p);message('已在主聊天室產生比較；請至聊天室按確認。');return;}
   if(b.hasAttribute('data-cost-export')){const key=currentKey(),data=await analysis.exportData();if(key!==currentKey()||!analysis.canUse())throw Error('身分或草稿已變更，未匯出成本紀錄');download(data);message('已匯出內部分析紀錄；內容含成本資料，請作內部保存。');return;}
  }catch(e){message(e.message||e);}
 }
 function change(e){
  if(e.target.dataset.costConvention){invalidate();const k=e.target.dataset.costConvention;conventions[k]=e.target.type==='checkbox'?e.target.checked:e.target.value;if(k!=='confirmed')conventions.confirmed=false;if(k==='confirmed'){if(conventions.confirmed&&(!conventions.taxBasis||conventions.note.trim().length<8)){conventions.confirmed=false;error='請先核對稅別並填寫至少8字計價依據';}render();}return;}
  if(e.target.hasAttribute('data-cost-filter')){filter=e.target.value;page=0;render();return;}
  const key=e.target.dataset.costField;if(!key)return;const f=forms.get(selected);if(!f)return;
  invalidate();f.manual=true;f[key]=e.target.type==='checkbox'?e.target.checked:e.target.value;
  if(key==='itemCode'){f.currency='';f.conditionsConfirmed=false;f.quantityConfirmed=false;render();}
 }
 function dataKey(){try{return canonical(analysis.view().rows.map(x=>x.row||x));}catch{return '';}}
 const unsubscribe=context.assistant?.subscribeState?.(()=>{
  if(disposed)return;const key=currentKey(),data=dataKey();if(key!==lastBinding){lastBinding=key;stop();invalidate();forms.clear();aiResults.clear();conventions={taxBasis:'',rounding:'exact',note:'',confirmed:false};selected='';for(const node of chatTasks)node._reply?.dispose();chatTasks.clear();}
  else if(data!==lastData){invalidate();stop();aiResults.clear();}
  lastData=data;if(!analysis.canUse()){stop();invalidate();root?.replaceChildren();for(const node of chatTasks)node._reply?.dispose();chatTasks.clear();}
 });
 return Object.freeze({
  mount(){workspace.setReviewExtension?.(slot=>{root=slot;if(!root)return;root.classList.add('qcm-inline','qcm-window');root.onclick=click;root.onchange=change;root.oninput=e=>{if(e.target.dataset.costField||e.target.dataset.costConvention)change(e);};lastBinding=currentKey();lastData=dataKey();if(!root.hidden)render();});},
  open(){if(!analysis.canUse()){context.ui?.alert?.('標準成本比對僅限管理員／最高管理員。','內部成本');return false;}return workspace.openCostReview?.()||false;},
  handleChatCommand(text){if(!/^(?:請|幫我|請幫我|我要|開啟|打開|進行|請開啟|請打開)*\s*(?:比對標準成本|標準成本比對|報價成本比對)[。！!\s]*$/.test(String(text||'').trim()))return null;const ok=this.open();return{handled:true,message:ok?'已開啟標準成本比對，請讀取成本快照並選擇項目。所有保存仍需比較後按確認。':'目前身分無法使用內部成本分析。'};},
  dispose(){disposed=true;stop();invalidate();unsubscribe?.();chatObserver?.disconnect();workspace.setReviewExtension?.(null);root?.replaceChildren();document.getElementById('leavesCostMatchButton')?.remove();for(const node of chatTasks)node._reply?.dispose();chatTasks.clear();forms.clear();aiResults.clear();root=null;}
 });
}
