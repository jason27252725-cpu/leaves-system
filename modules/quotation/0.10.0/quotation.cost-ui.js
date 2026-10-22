import {requirements,decimal,copy,canonical} from './quotation.cost-match.js';
import {attachQuotationWindow} from './quotation.window.js';
const ID='leavesCostAnalysis',STATUS={pending:'待比對',confirmed:'已確認',stale:'資料變更，需重核'};
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const labels={widthCm:'寬 W（cm）',depthCm:'深 D（cm）',heightCm:'高 H（cm）',thicknessMm:'厚度（mm）'};
const taxText=x=>x==='inclusive'?'含稅成本':'未稅成本';
function download(data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='LEAVES-INTERNAL-COST-ANALYSIS-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function createCostAnalysisUI({context,analysis,workspace}){
 let root=null,win=null,selected='',filter='',page=0,error='',busy='',controller=null,generation=0,disposed=false,lastBinding='',activePreview=null,chatObserver=null;
 const forms=new Map(),aiResults=new Map(),chatTasks=new Set();
 function currentKey(){return canonical([context.assistant?.sessionToken?.(),context.accessRole,workspace.getActiveDraftId?.()]);}
 function stop(){generation++;controller?.abort();controller=null;busy='';}
 function invalidate(){analysis.cancelPreview();activePreview=null;for(const node of chatTasks){const b=node.querySelector('[data-cost-confirm]');if(b&&!b.disabled){b.disabled=true;b.textContent='比較已失效，請重新預覽';}}}
 function formFor(row){let f=forms.get(row.id);const stamp=canonical(row);if(!f||f.rowStamp!==stamp){f={rowId:row.id,rowStamp:stamp,itemCode:'',quantity:decimal(row.qty)??'',rounding:'exact',currency:'',taxBasis:'',note:'',conversionNote:'',scope:'',parentId:'',conditionsConfirmed:false,quantityConfirmed:false,remember:false};forms.set(row.id,f);}return f;}
 function selectedState(v){return v.rows.find(x=>(x.row||x).id===selected)||null;}
 function message(text){error=String(text||'');const box=root?.querySelector('[data-cost-message]');if(box)box.textContent=error;}
 function sourceHtml(v){const s=v.snapshot;return `<div class="qcm-source"><b>${esc(s.identity.label)} · 固定內容 ${esc(s.hash.slice(0,12))}</b><span>${esc(s.version.sourceDocumentName||'來源名稱未提供')} · 生效日 ${esc(s.version.effectiveDate||'未提供，請逐案核對')}</span><small>固定於本草稿；Current 後續變更不會自動改價。版本以環境＋唯一標籤識別（既有介面未提供 UUID）。</small></div>`;}
 function editor(v,entry){
  if(!entry)return'<p class="qcm-empty">請從左側選擇一個報價項目。</p>';
  const row=entry.row,f=formFor(row),choices=analysis.choices(row.id),item=v.snapshot.items.find(x=>x.itemCode===f.itemCode),r=item?requirements(row,item,f):null;
  const parentOptions=v.rows.filter(x=>x.status==='confirmed'&&x.saved.kind==='base'&&x.row.id!==row.id);
  return `<div class="qcm-row-source"><strong>${esc(row.sheet)}!${esc(row.address)} · ${esc(row.itemName)}</strong><p>原列：${esc(row.qty)} ${esc(row.unit)}${row.note?' · '+esc(row.note):''}</p><small>系統只提出候選；選擇候選尚未計價或改動報價。</small></div>
  <div class="qcm-candidates"><b>本機候選</b>${choices.length?choices.map(c=>{const i=v.snapshot.items.find(x=>x.itemCode===c.itemCode);return `<button type="button" data-cost-choice="${esc(c.itemCode)}" class="${f.itemCode===c.itemCode?'is-selected':''}"><strong>${esc(i.itemCode)} · ${esc(i.itemName)}</strong><span>${c.match.conflicts.length?'規格／種類衝突':c.match.hold?'來源疑義待決':c.match.missing.length?'尚缺尺寸':'仍須核對計價條件'}${c.remembered?' · 本草稿已確認對應':''}</span></button>`;}).join(''):'<p>沒有足夠依據的候選；請用下方清單搜尋，不以缺價當 0。</p>'}</div>
  <label>選擇固定快照中的成本項目<select data-cost-field="itemCode"><option value="">請選擇（不會自動採用）</option>${v.snapshot.items.map(i=>`<option value="${esc(i.itemCode)}" ${i.itemCode===f.itemCode?'selected':''}>${esc(i.itemCode+' · '+i.itemName)}</option>`).join('')}</select></label>
  <button type="button" data-cost-ai ${busy||!choices.length?'disabled':''}>${busy==='ai'?'AI 正在比對候選…':'請 AI 協助判讀這一項'}</button><small>按下才傳送本列名稱／備註／數量和最多 5 個候選規格；不傳送售價、成本價格或模型。AI 回覆只作建議。</small>
  ${aiResults.has(row.id)?`<div class="qcm-ai-result"><b>AI 候選建議（尚未採用）</b><p>${esc(aiResults.get(row.id).itemCode||'沒有適合候選')} · ${esc(aiResults.get(row.id).reason)}</p>${aiResults.get(row.id).questions.map(q=>`<p>待確認：${esc(q)}</p>`).join('')}</div>`:''}
  ${item?`<div class="qcm-standard"><strong>${esc(item.itemName)}</strong><p>${esc(item.currency)} ${esc(item.unitCost)} / ${esc(item.baseQty)} ${esc(item.unit)}</p><p>${esc(item.specDescription||'')}</p><small>${esc(r.note)}</small>${r.conflicts.map(x=>`<p class="qcm-conflict">${esc(x)}</p>`).join('')}${r.hold||!r.known?'<p class="qcm-conflict">本項保留待決，不能產生可確認的試算。</p>':''}</div>
  <div class="qcm-fields">${Object.entries(labels).filter(([k])=>r.expectedDimensions?.[k]!=null).map(([k,label])=>`<label>${label} · 標準 ${esc(r.expectedDimensions[k])}<input data-cost-field="${k}" inputmode="decimal" value="${esc(r.observed[k]??f[k]??'')}" ${r.observed[k]!=null?'readonly':''} placeholder="請補本列實測規格"></label>`).join('')}
  ${item.itemCode==='SC-036'?`<label>實際無電梯搬運樓層（只支援 3F）<input data-cost-field="floor" inputmode="numeric" value="${esc(f.floor||'')}"></label>`:''}
  ${item.itemCode==='SC-023'?`<label>本處超過 60cm 的實測尺寸（cm，方向請寫於依據）<input data-cost-field="openingCm" inputmode="decimal" value="${esc(f.openingCm||'')}"></label>`:''}
  <label>實際計價數量（${esc(item.unit)}）<input data-cost-field="quantity" inputmode="decimal" value="${esc(f.quantity)}"></label>
  <label>本案小數處理<select data-cost-field="rounding">${[['exact','精確值（最多 6 位，不另進位）'],['0','四捨五入至整元'],['2','四捨五入至小數 2 位']].map(([k,l])=>`<option value="${k}" ${f.rounding===k?'selected':''}>${l}</option>`).join('')}</select></label>
  <label>核對來源幣別<select data-cost-field="currency"><option value="">尚未確認</option><option value="${esc(item.currency)}" ${f.currency===item.currency?'selected':''}>${esc(item.currency)}（本案已核對）</option></select></label>
  <label>來源單價稅別<select data-cost-field="taxBasis"><option value="">尚未確認</option><option value="exclusive" ${f.taxBasis==='exclusive'?'selected':''}>已核對為未稅（不另自動加稅）</option><option value="inclusive" ${f.taxBasis==='inclusive'?'selected':''}>已核對為含稅（不另自動加稅）</option></select></label></div>
  ${r.addon?`<label>所屬已確認主項<select data-cost-field="parentId"><option value="">請先確認主項，再選擇</option>${parentOptions.map(x=>`<option value="${esc(x.row.id)}" ${f.parentId===x.row.id?'selected':''}>${esc(x.row.sheet+'!'+x.row.address+' · '+x.row.itemName)}</option>`).join('')}</select></label>`:''}
  ${r.addon||r.job?`<label>${r.job?'工地／出車或清運批次（相同範圍不可重計）':'本加項的部位／計數範圍（例如右櫃第 1 抽屜）'}<input data-cost-field="scope" maxlength="160" value="${esc(f.scope)}"></label>`:''}
  <label>單位換算／數量調整依據（原單位或數量不同時必填）<textarea data-cost-field="conversionNote" maxlength="1200">${esc(f.conversionNote)}</textarea></label>
  <label>本案計價依據：材料／工法／五金、內含與排除、最低量與損耗；尺的定義或特殊計數請明訂<textarea data-cost-field="note" maxlength="1200" placeholder="逐案記錄；不自動形成公司通用規則">${esc(f.note)}</textarea></label>
  <label class="qcm-check"><input type="checkbox" data-cost-field="conditionsConfirmed" ${f.conditionsConfirmed?'checked':''}>已核對本列種類、規格及上列包含／排除條件</label>
  <label class="qcm-check"><input type="checkbox" data-cost-field="quantityConfirmed" ${f.quantityConfirmed?'checked':''}>已核對實際計價數量、最低量與損耗；系統只按所填數量計算</label>
  <label class="qcm-check"><input type="checkbox" data-cost-field="remember" ${f.remember?'checked':''}>記住此名稱與成本代碼的對應，僅提示本草稿其他列（不記價格、不自動採用）</label>
  <button type="button" data-cost-preview ${r.hold||!r.known||r.conflicts.length||busy?'disabled':''}>預覽內部成本，至聊天室確認</button>`:''}`;
 }
 function render(){
  if(!root||disposed)return;let v;try{v=analysis.view();}catch(e){root.innerHTML=`<div class="qcm-header"><strong>標準成本比對</strong><button data-cost-close>關閉</button></div><p>${esc(e.message)}</p>`;return;}
  const all=v.rows.map(x=>x.row||x);if(!all.some(r=>r.id===selected))selected=all[0]?.id||'';
  const matches=v.rows.filter(x=>{const r=x.row||x;return (r.itemName+' '+r.sheet+' '+r.itemNo).includes(filter);});page=Math.min(page,Math.max(0,Math.ceil(matches.length/20)-1));
  root.innerHTML=`<header class="qcm-header" data-cost-drag><div><small>LEAVES · INTERNAL COST</small><strong>標準成本比對</strong></div><button type="button" data-cost-close aria-label="關閉標準成本比對">×</button></header>
  <p class="qcm-intro">管理員內部試算 · 不改對客售價。分析只保留本次工作階段，關閉頁面前請匯出紀錄。缺資料項目保留待決。</p>
  <div class="qcm-status" role="status" data-cost-message>${esc(error||busy==='load'&&'正在讀取並核對授權成本快照…'||busy==='ai'&&'AI 正在分析本列候選，尚未修改任何資料。'||'')}</div>
  ${!v.ready?`<div class="qcm-start"><p>先固定目前授權的 Current 成本版本，再逐項比對；不從舊 PDF 內建價格。</p><button data-cost-load ${busy?'disabled':''}>${busy?'讀取中…':'讀取 Current 成本快照'}</button></div>`:sourceHtml(v)+`
  <div class="qcm-summary"><span>已確認 ${v.confirmed} · 待處理 ${v.pending}</span>${v.totals.map(t=>`<strong>已確認部分：${esc(t.currency)} ${esc(t.amount)}（${taxText(t.taxBasis)}，${t.count} 項）</strong>`).join('')}<small>以上不是全案總成本；未確認、已失效及缺價項目均未計入，也未用 0 補入。</small><button data-cost-export>匯出內部分析 JSON</button></div>
  <div class="qcm-body"><nav class="qcm-list"><label>搜尋本報價項目<input data-cost-filter value="${esc(filter)}" placeholder="名稱、工作表或項次"></label>${matches.slice(page*20,page*20+20).map(x=>`<button data-cost-row="${esc(x.row.id)}" class="${selected===x.row.id?'is-selected':''}"><small>${esc(x.row.sheet)} · ${esc(x.row.itemNo||x.row.address)} · ${STATUS[x.status]}</small><strong>${esc(x.row.itemName)}</strong></button>`).join('')||'<p>沒有符合的項目</p>'}<div class="qcm-pages"><button data-cost-page="-1" ${page===0?'disabled':''}>上一頁</button><span>${page+1} / ${Math.max(1,Math.ceil(matches.length/20))}</span><button data-cost-page="1" ${(page+1)*20>=matches.length?'disabled':''}>下一頁</button></div></nav><section class="qcm-editor">${editor(v,selectedState(v))}</section></div>`}`;
  win?.cleanup?.();win=attachQuotationWindow(root,root.querySelector('[data-cost-drag]'),context,{defaultWidth:960,defaultHeight:760,minWidth:350,minHeight:400,offsetFromChat:true});
 }
 function appendPreview(p){
  const host=context.getChatContainer?.();if(!host)throw Error('聊天室尚未就緒，沒有建立確認按鈕');
  activePreview=p.id;
  const node=document.createElement('div');node.className='qcm-chat-task';node.dataset.costTask=p.id;
  const a=p.after,b=p.before;
  const fields=[['標準項目',b?.itemCode||'未建立',a.itemCode+' · '+a.standardName],['計價式',b?.calculation||'—',a.calculation],['內部成本',b?`${b.currency} ${b.amount}`:'未計入',`${a.currency} ${a.amount}（${taxText(a.taxBasis)}）`],['主項／範圍',b?.scope||'—',(a.parentTarget?a.parentTarget+' · ':'')+(a.scope||'本列')],['本案依據',b?.note||'—',a.note]];
  node.innerHTML=`<div class="qcm-chat-label">LEAVES AI · 內部成本比較</div><p>${esc(a.sheet)}!${esc(a.address)} · ${esc(a.itemName)}</p><div class="qcm-table-scroll"><table><thead><tr><th>欄位</th><th>原分析</th><th>確認後</th></tr></thead><tbody>${fields.map(f=>`<tr>${f.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p>${esc(p.warning)} 固定版本 ${esc(a.versionKey.label)}；內容 ${esc(a.snapshotHash.slice(0,12))}。</p><p data-cost-task-status>尚未保存，請核對後按確認。文字回覆「同意」不會執行。</p><div class="qcm-chat-actions"><button data-cost-confirm>確認保存內部成本</button><button data-cost-cancel>取消</button><button data-cost-undo hidden>復原本次保存</button></div>`;
  const status=node.querySelector('[data-cost-task-status]'),confirm=node.querySelector('[data-cost-confirm]'),cancel=node.querySelector('[data-cost-cancel]'),undo=node.querySelector('[data-cost-undo]');
  confirm.onclick=()=>{confirm.disabled=true;try{if(activePreview!==p.id||!node.isConnected||!host.contains(node))throw Error('比較已被新任務取代或已離開聊天室');const saved=analysis.apply(p.id);activePreview=null;status.textContent='已保存本機內部分析；Excel 與對客售價沒有變動。';cancel.disabled=true;undo.hidden=false;undo.onclick=()=>{try{if(!node.isConnected||!host.contains(node))throw Error('此操作紀錄已離開聊天室，不能用舊按鈕復原');analysis.undo(saved.receiptId);status.textContent='已復原本次內部分析保存。';undo.disabled=true;render();}catch(e){status.textContent=e.message;}};render();}catch(e){status.textContent=e.message;}};
  cancel.onclick=()=>{if(activePreview===p.id)invalidate();confirm.disabled=true;cancel.disabled=true;status.textContent='此比較已取消，沒有保存。';};
  if(!chatObserver){chatObserver=new MutationObserver(()=>{if(disposed)return;for(const old of chatTasks)if(!old.isConnected||!host.contains(old)){if(old.dataset.costTask===activePreview)invalidate();chatTasks.delete(old);}});chatObserver.observe(host,{childList:true});}
  chatTasks.add(node);host.append(node);context.ui?.openChat?.();context.ui?.scrollChatToBottom?.();
 }
 async function run(kind,fn){stop();const at=++generation,key=currentKey();controller=new AbortController();const signal=controller.signal;busy=kind;error='';render();try{const result=await fn(signal);if(disposed||at!==generation||currentKey()!==key)return;return result;}catch(e){if(at===generation&&!disposed)error=String(e.message||e);}finally{if(at===generation&&!disposed){busy='';controller=null;render();}}}
 async function click(e){const b=e.target.closest('button');if(!b||!root?.contains(b))return;
  try{
   if(b.hasAttribute('data-cost-close')){stop();root.hidden=true;return;}
   if(b.hasAttribute('data-cost-load')){await run('load',signal=>analysis.load({signal}));return;}
   if(b.hasAttribute('data-cost-row')){stop();invalidate();selected=b.dataset.costRow;error='';render();return;}
   if(b.hasAttribute('data-cost-page')){page+=Number(b.dataset.costPage);render();return;}
   if(b.hasAttribute('data-cost-choice')){stop();invalidate();const v=analysis.view(),entry=selectedState(v),f=formFor(entry.row);Object.assign(f,{itemCode:b.dataset.costChoice,currency:'',conditionsConfirmed:false,quantityConfirmed:false});error='';render();return;}
   if(b.hasAttribute('data-cost-ai')){const id=selected;await run('ai',async signal=>{const result=await analysis.suggest(id,{signal});if(!signal.aborted)aiResults.set(id,result);});return;}
   if(b.hasAttribute('data-cost-preview')){invalidate();const f=forms.get(selected);const p=analysis.preview(copy(f));appendPreview(p);message('已在主聊天室產生比較；請至聊天室按確認。');root.hidden=true;return;}
   if(b.hasAttribute('data-cost-export')){const key=currentKey(),data=await analysis.exportData();if(key!==currentKey()||!analysis.canUse())throw Error('身分或草稿已變更，未匯出成本紀錄');download(data);message('已匯出內部分析紀錄；內容含成本資料，請作內部保存。');return;}
  }catch(e){message(e.message||e);}
 }
 function change(e){
  if(e.target.hasAttribute('data-cost-filter')){filter=e.target.value;page=0;render();return;}
  const key=e.target.dataset.costField;if(!key)return;const f=forms.get(selected);if(!f)return;
  invalidate();f[key]=e.target.type==='checkbox'?e.target.checked:e.target.value;
  if(key==='itemCode'){f.currency='';f.conditionsConfirmed=false;f.quantityConfirmed=false;render();}
 }
 const unsubscribe=context.assistant?.subscribeState?.(()=>{
  if(disposed||!root)return;const key=currentKey();if(key!==lastBinding){lastBinding=key;stop();invalidate();forms.clear();aiResults.clear();selected='';for(const node of chatTasks)node.remove();chatTasks.clear();}
  else invalidate();
  if(!analysis.canUse()){stop();root.hidden=true;root.replaceChildren();document.getElementById('leavesCostMatchButton')?.remove();for(const node of chatTasks)node.remove();chatTasks.clear();return;}
  if(!root.hidden)render();
 });
 return Object.freeze({
  mount(){const host=context.getComposerToolsHost?.()||context.getComposerDock?.();if(!host||!analysis.canUse())return;let b=document.getElementById('leavesCostMatchButton');if(!b){b=document.createElement('button');b.id='leavesCostMatchButton';b.type='button';b.className='leaves-composer-tool';b.textContent='標準成本比對';b.onclick=()=>this.open();host.append(b);}},
  open(){if(!analysis.canUse()){context.ui?.alert?.('標準成本比對僅限管理員／最高管理員。','內部成本');return false;}if(!root){root=document.createElement('aside');root.id=ID;root.className='quotation-inspector qcm-window';root.setAttribute('role','dialog');root.setAttribute('aria-label','標準成本比對');document.body.append(root);root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',e=>{if(e.target.dataset.costField)change(e);});}lastBinding=currentKey();root.hidden=false;root.classList.add('is-open');render();return true;},
  handleChatCommand(text){if(!/^(?:請|幫我|請幫我|我要|開啟|打開|進行|請開啟|請打開)*\s*(?:比對標準成本|標準成本比對|報價成本比對)[。！!\s]*$/.test(String(text||'').trim()))return null;const ok=this.open();return{handled:true,message:ok?'已開啟標準成本比對，請讀取成本快照並選擇項目。所有保存仍需比較後按確認。':'目前身分無法使用內部成本分析。'};},
  dispose(){disposed=true;stop();invalidate();unsubscribe?.();chatObserver?.disconnect();win?.cleanup?.();root?.remove();document.getElementById('leavesCostMatchButton')?.remove();for(const node of chatTasks)node.remove();chatTasks.clear();forms.clear();aiResults.clear();root=null;}
 });
}
