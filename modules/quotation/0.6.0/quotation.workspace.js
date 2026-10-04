import { attachQuotationWindow } from './quotation.window.js';

export const QUOTATION_WORKSPACE_VERSION = '0.6.0';
const ROOT_ID = 'leavesQuotationInspector';

function esc(v=''){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
function cellKey(sheet,address){return `${sheet}!${address}`;}
function displayValue(cell){if(!cell)return'';const display=String(cell.display??'');if(display!=='')return display;if(cell.formula)return `=${cell.formula}`;return String(cell.value??'');}
function parseEditedValue(text){const raw=String(text??'').trim();if(raw==='')return'';if(/^[-+]?\d+(?:,\d{3})*(?:\.\d+)?$/.test(raw)){const n=Number(raw.replace(/,/g,''));if(Number.isFinite(n))return n;}if(/^true$/i.test(raw))return true;if(/^false$/i.test(raw))return false;return raw;}
function colLabel(n){let x=n+1,s='';while(x){const r=(x-1)%26;s=String.fromCharCode(65+r)+s;x=Math.floor((x-1)/26);}return s;}
function money(n){const num=Number(n);return Number.isFinite(num)?new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(num):String(n??'');}

function suggestionFor(state,sheet,address){return [...state.suggestions.values()].find(s=>s.sheet===sheet&&s.address===address&&s.status==='pending')||null;}
function acceptedCount(state){return [...state.suggestions.values()].filter(s=>s.status==='accepted').length;}
function pendingCount(state){return [...state.suggestions.values()].filter(s=>s.status==='pending').length;}
function issueCount(state){return state.issues?.length||0;}

function buildGridHtml(state, workbook, {original=false}={}) {
  const model=state.model;const sh=workbook.getSheet(model,model.activeSheet);if(!sh)return'<div class="quotation-workbook-empty">找不到工作表。</div>';
  const startR=sh.range.s.r,startC=sh.range.s.c;const endR=Math.min(sh.range.e.r,startR+(state.visibleRows||220)-1);const endC=Math.min(sh.range.e.c,startC+39);
  let head='<th class="q-row-head"></th>';for(let c=startC;c<=endC;c++)head+=`<th>${colLabel(c)}</th>`;
  let body='';
  for(let r=startR;r<=endR;r++){
    let row=`<th class="q-row-head">${r+1}</th>`;
    for(let c=startC;c<=endC;c++){
      const addr=workbook.columnAddress(model,c,r);const current=workbook.getCell(model,sh.name,addr);const origin=workbook.originalCell(model,sh.name,addr);const shownCell=original?origin:current;const suggestion=!original?suggestionFor(state,sh.name,addr):null;const currentText=displayValue(shownCell);const changed=displayValue(origin)!==displayValue(current);const formula=String(shownCell?.formula||'');const cls=[changed&&!original?'is-manual-changed':'',suggestion?'has-suggestion':'',formula?'is-formula':''].filter(Boolean).join(' ');
      row+=`<td class="${cls}" data-sheet="${esc(sh.name)}" data-address="${addr}" ${formula?`title="公式：=${esc(formula)}"`:''}><span class="q-cell-value" ${original?'':'contenteditable="true" spellcheck="false" data-sheet="'+esc(sh.name)+'" data-address="'+addr+'"'}>${esc(currentText)}</span>${formula?'<span class="q-formula-dot" title="此格含 Excel 公式"></span>':''}${suggestion?`<span class="q-cell-proposed">→ ${esc(String(suggestion.newValue??''))}</span><span class="q-cell-actions"><button type="button" data-action="accept-suggestion" data-suggestion-id="${esc(suggestion.id)}" title="採用">✓</button><button type="button" data-action="reject-suggestion" data-suggestion-id="${esc(suggestion.id)}" title="略過">×</button></span>`:''}</td>`;
    }
    body+=`<tr>${row}</tr>`;
  }
  const more=sh.range.e.r>endR?`<div class="quotation-workbook-more"><button type="button" data-action="show-more-rows">再顯示 ${Math.min(150,sh.range.e.r-endR)} 列</button><span>目前顯示到第 ${endR+1} 列</span></div>`:'';
  return `<div class="quotation-sheet-grid" data-grid-kind="${original?'original':'draft'}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${more}`;
}

function buildSuggestionPanel(state){const items=[...state.suggestions.values()].filter(s=>s.status==='pending');if(!items.length&&!(state.issues||[]).length)return'<div class="quotation-review-empty">目前沒有待確認修改。你可以直接雙擊/編輯儲存格，或在 LEAVES AI 聊天輸入「把第 12 項單價改成 8200」。</div>';
  const sug=items.slice(0,80).map(s=>`<div class="quotation-review-row"><div><strong>${esc(s.sheet)} · ${esc(s.address)}</strong><span>${esc(String(s.oldValue??''))} → <b>${esc(String(s.newValue??''))}</b></span><small>${esc(s.reason||'AI 建議')}</small></div><div><button data-action="accept-suggestion" data-suggestion-id="${esc(s.id)}">採用</button><button data-action="reject-suggestion" data-suggestion-id="${esc(s.id)}">略過</button></div></div>`).join('');
  const issues=(state.issues||[]).slice(0,40).map(x=>`<div class="quotation-review-row is-issue"><div><strong>${esc(x.sheet)} · ${esc(x.address||`第 ${x.row+1} 列`)}</strong><span>${esc(x.message)}</span><small>疑慮 · 不會自動改值</small></div></div>`).join('');
  return sug+issues;
}

function workspaceHtml(state,context,workbook){const model=state.model;const draft=state.draft;const structured=!!model?.structured;const sh=structured?workbook.getSheet(model,model.activeSheet):null;const role=context.accessRole;return`<div class="quotation-workspace-shell">
<header class="quotation-workspace-header" data-role="workspaceDrag"><div class="quotation-workspace-title"><span>LEAVES AI · QUOTATION</span><h3>${esc(draft.file?.name||'報價工作台')}</h3><div class="quotation-mini-meta"><b>${esc(String(model?.meta?.extension||draft.file?.extension||'').toUpperCase())}</b><b>Draft</b><b>原始檔保護 ✓</b><b>${esc(role)}</b></div></div><div class="quotation-workspace-actions"><span class="quotation-sync-pill"><i></i>AI 同步</span><button type="button" data-action="workspace-reset-size" title="重設大小"><i class="fa-solid fa-expand"></i></button><button type="button" data-action="workspace-close" aria-label="關閉">×</button></div></header>
${structured?`<div class="quotation-workspace-toolbar"><div class="quotation-sheet-tabs">${model.sheetNames.map(name=>`<button type="button" data-action="sheet" data-sheet-name="${esc(name)}" class="${name===model.activeSheet?'is-active':''}">${esc(name)}</button>`).join('')}</div><div class="quotation-workspace-tools"><button type="button" data-action="toggle-compare" class="${state.compare?'is-active':''}"><i class="fa-solid fa-code-compare"></i>比較</button><button type="button" data-action="run-local-check"><i class="fa-solid fa-wand-magic-sparkles"></i>檢查</button><button type="button" data-action="accept-all" ${pendingCount(state)?'':'disabled'}>全部採用 ${pendingCount(state)||''}</button><button type="button" data-action="reject-all" ${pendingCount(state)?'':'disabled'}>全部略過</button><button type="button" data-action="append-row"><i class="fa-solid fa-plus"></i>新增列</button><button type="button" data-action="export-workbook"><i class="fa-solid fa-file-arrow-down"></i>匯出草案</button></div></div>
<div class="quotation-workspace-main ${state.compare?'is-compare':''}">${state.compare?`<section class="quotation-grid-pane"><div class="quotation-pane-label">ORIGINAL · 唯讀</div>${buildGridHtml(state,workbook,{original:true})}</section><section class="quotation-grid-pane"><div class="quotation-pane-label">DRAFT · 可編輯</div>${buildGridHtml(state,workbook,{original:false})}</section>`:`<section class="quotation-grid-pane is-single">${buildGridHtml(state,workbook,{original:false})}</section>`}</div>
<div class="quotation-review-dock"><div class="quotation-review-head"><div><span>AI / RULE REVIEW</span><strong>待確認 ${pendingCount(state)} · 已採用 ${acceptedCount(state)} · 疑慮 ${issueCount(state)}</strong></div><small>AI 建議不會直接寫入；採用後才進工作草案。</small></div><div class="quotation-review-list">${buildSuggestionPanel(state)}</div></div>`:`<div class="quotation-pdf-state"><i class="fa-regular fa-file-pdf"></i><h4>${esc(draft.file?.name||'PDF')}</h4><p>${esc(model?.warning||'PDF 已安全掛載。這一版的可編輯 Grid 以 XLSX / XLSM 為主。')}</p></div>`}
<footer class="quotation-workspace-footer"><span>${structured?`${esc(model.activeSheet)} · ${sh?`${sh.range.e.r-sh.range.s.r+1} 列 × ${sh.range.e.c-sh.range.s.c+1} 欄`:''} · 手動修改 ${model.editCount||0}`:'文件模式'}</span><span>${structured?'瀏覽器匯出為工作草案；Excel 開啟時會重新計算公式。':'原始檔不覆寫'}</span></footer>
</div>`;}

function localCheck(state,engine,workbook){const model=state.model;if(!model?.structured)return;const sh=workbook.getSheet(model,model.activeSheet);const schema=workbook.inferTableSchema(model,sh.name);const cols=schema.columns;state.issues=[];
  if(cols.itemName==null){state.issues.push({sheet:sh.name,row:schema.headerRow,address:'',message:'沒有可靠辨識到「工程項目 / 項目名稱」欄位；可繼續手動編輯。'});return;}
  for(let r=schema.headerRow+1;r<=sh.range.e.r;r++){
    const nameAddr=workbook.columnAddress(model,cols.itemName,r),name=String(workbook.getCell(model,sh.name,nameAddr)?.value||'').trim();if(!name)continue;
    if(cols.qty!=null&&cols.unitPrice!=null&&cols.amount!=null){const q=Number(workbook.getCell(model,sh.name,workbook.columnAddress(model,cols.qty,r))?.value);const p=Number(workbook.getCell(model,sh.name,workbook.columnAddress(model,cols.unitPrice,r))?.value);const aAddr=workbook.columnAddress(model,cols.amount,r);const aCell=workbook.getCell(model,sh.name,aAddr);const a=Number(aCell?.value);if(Number.isFinite(q)&&Number.isFinite(p)&&Number.isFinite(a)&&!aCell?.formula){const expected=Math.round(q*p*100)/100;if(Math.abs(expected-a)>.5&&!suggestionFor(state,sh.name,aAddr)){const sug=engine.createSuggestion?engine.createSuggestion({sheet:sh.name,address:aAddr,oldValue:a,newValue:expected,reason:`數量 ${money(q)} × 單價 ${money(p)} = ${money(expected)}`,source:'rule'}):null;if(sug)state.suggestions.set(sug.id,sug);}}
    }
    if(cols.unit!=null){const unit=String(workbook.getCell(model,sh.name,workbook.columnAddress(model,cols.unit,r))?.value||'').trim();if(!unit)state.issues.push({sheet:sh.name,row:r,address:workbook.columnAddress(model,cols.unit,r),message:`「${name}」缺少單位。`});}
  }
}

export function createQuotationWorkspace({context,engine,workbook,cost}){
  const records=new Map();let activeId='';let winManager=null;let disposed=false;
  const getActive=()=>records.get(activeId)||null;
  const render=()=>{const state=getActive();if(!state)return null;let root=document.getElementById(ROOT_ID);if(!root){root=document.createElement('aside');root.id=ROOT_ID;root.className='quotation-inspector quotation-workspace';document.body.appendChild(root);}root.innerHTML=workspaceHtml(state,context,workbook);root.classList.add('is-open');winManager?.cleanup?.();winManager=attachQuotationWindow(root,root.querySelector('[data-role="workspaceDrag"]'),context,{defaultWidth:760,defaultHeight:760,offsetFromChat:true,minWidth:480,minHeight:420});bind(root,state);return root;};
  const applySuggestion=(state,id,accept)=>{const s=state.suggestions.get(id);if(!s||s.status!=='pending')return false;if(accept){if(s.kind==='append-row'){const result=workbook.appendRow(state.model,s.sheet,s.payload||{});const sh=result?.sheet||workbook.getSheet(state.model,s.sheet);if(sh)state.visibleRows=Math.max(state.visibleRows||220,Math.min(5000,sh.range.e.r-sh.range.s.r+1));}else workbook.setCell(state.model,s.sheet,s.address,s.newValue);s.status='accepted';}else s.status='rejected';state.draft.pendingChangeCount=pendingCount(state);return true;};
  const bind=(root,state)=>{
    const click=async e=>{const b=e.target.closest('button[data-action]');if(!b)return;const a=b.dataset.action;
      if(a==='workspace-close'){root.classList.remove('is-open');return;}if(a==='workspace-reset-size'){winManager?.reset?.();return;}if(a==='sheet'){state.model.activeSheet=b.dataset.sheetName||state.model.activeSheet;state.visibleRows=220;state.issues=[];render();return;}if(a==='toggle-compare'){state.compare=!state.compare;render();return;}if(a==='show-more-rows'){state.visibleRows=Math.min((state.visibleRows||220)+150,5000);render();return;}
      if(a==='accept-suggestion'){applySuggestion(state,b.dataset.suggestionId,true);render();return;}if(a==='reject-suggestion'){applySuggestion(state,b.dataset.suggestionId,false);render();return;}if(a==='accept-all'){[...state.suggestions.values()].filter(x=>x.status==='pending').forEach(x=>applySuggestion(state,x.id,true));render();return;}if(a==='reject-all'){[...state.suggestions.values()].filter(x=>x.status==='pending').forEach(x=>applySuggestion(state,x.id,false));render();return;}if(a==='run-local-check'){localCheck(state,engine,workbook);render();return;}if(a==='append-row'){const sh=workbook.getSheet(state.model,state.model.activeSheet);const schema=workbook.inferTableSchema(state.model,sh?.name||'');const values={};if(schema.columns.itemNo!=null)values[schema.columns.itemNo]=(sh?.range?.e?.r??schema.headerRow)-schema.headerRow+1;workbook.appendRow(state.model,sh?.name||'',values);state.visibleRows=Math.max(state.visibleRows||220,(sh?.range?.e?.r||0)-sh.range.s.r+2);render();return;}if(a==='export-workbook'){try{const result=await workbook.exportWorkingCopy(state.model,state.workbookInfo?.futureOfficialExport);context.ui?.alert?.(`已輸出工作草案：${result.fileName}\n\n提醒：目前瀏覽器版以資料、公式與一般 Workbook 結構為主；複雜圖形/列印保真會在後續 Server Workbook Patch 再做最後驗證。`,'報價工作台');}catch(err){context.ui?.alert?.(`匯出失敗：${err.message||err}`,'報價工作台');}return;}
    };
    const focus=e=>{const editor=e.target.closest('.q-cell-value[contenteditable="true"]');if(!editor)return;editor.dataset.before=editor.textContent||'';};
    const blur=e=>{const editor=e.target.closest('.q-cell-value[contenteditable="true"]');if(!editor)return;if(e.relatedTarget?.closest?.('[data-action]')) return;const raw=editor.textContent??'';const before=editor.dataset.before??'';if(raw!==before){const value=parseEditedValue(raw);workbook.setCell(state.model,editor.dataset.sheet,editor.dataset.address,value);state.issues=[];state.draft.updatedAt=new Date().toISOString();}render();};
    const key=e=>{const editor=e.target.closest('.q-cell-value[contenteditable="true"]');if(!editor)return;if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();editor.blur();}if(e.key==='Escape'){e.preventDefault();editor.textContent=editor.dataset.before||'';editor.blur();}};
    root.addEventListener('click',click);root.addEventListener('focusin',focus);root.addEventListener('focusout',blur);root.addEventListener('keydown',key);
    root._quotationWorkspaceCleanup=()=>{root.removeEventListener('click',click);root.removeEventListener('focusin',focus);root.removeEventListener('focusout',blur);root.removeEventListener('keydown',key);};
    if(state.compare){const grids=[...root.querySelectorAll('.quotation-sheet-grid')];if(grids.length===2){let syncing=false;grids.forEach((g,i)=>g.addEventListener('scroll',()=>{if(syncing)return;syncing=true;grids[1-i].scrollTop=g.scrollTop;grids[1-i].scrollLeft=g.scrollLeft;requestAnimationFrame(()=>syncing=false);},{passive:true}));}}
  };
  const register=({draft,workbookInfo,sourceFile,model})=>{const id=String(draft.draftId||draft.id);records.set(id,{draft,workbookInfo,sourceFile,model,suggestions:new Map(),issues:[],compare:false,visibleRows:220});activeId=id;return records.get(id);};
  return Object.freeze({
    async importFile({file,draft,workbookInfo}){if(disposed)throw new Error('MODULE_SESSION_ENDED');const model=await workbook.parseFile(file);if(disposed)throw new Error('MODULE_SESSION_ENDED');const state=register({draft,workbookInfo,sourceFile:file,model});if(model.structured)localCheck(state,engine,workbook);render();return state;},
    hasDraft(id){return !disposed&&records.has(String(id||''));},openDraft(id){if(disposed||!records.has(String(id||'')))return false;activeId=String(id);render();return true;},close(){document.getElementById(ROOT_ID)?.classList.remove('is-open');},
    handleChatCommand(text){if(disposed)return null;const state=getActive();if(!state?.model?.structured||typeof engine.parseChatEditCommand!=='function')return null;const result=engine.parseChatEditCommand(text,state.model,workbook);if(!result?.handled)return null;for(const s of result.suggestions||[])state.suggestions.set(s.id,s);state.draft.pendingChangeCount=pendingCount(state);render();return result;},
    dispose(){disposed=true;winManager?.cleanup?.();winManager=null;const root=document.getElementById(ROOT_ID);root?._quotationWorkspaceCleanup?.();root?.remove?.();records.clear();activeId='';},
    getActiveDraftId:()=>activeId,getRecord:id=>records.get(String(id||''))||null,getStatus:()=>({open:document.getElementById(ROOT_ID)?.classList.contains('is-open')||false,activeDraftId:activeId,draftCount:records.size,pending:getActive()?pendingCount(getActive()):0})
  });
}
