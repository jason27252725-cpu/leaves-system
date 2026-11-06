// Review choices belong to one in-memory working draft. They never edit source cells.
const key=issue=>JSON.stringify([issue.code,issue.sheet,issue.row]);
export function reviewStamp(state,issue,workbook){
 const sheet=workbook.getSheet(state.model,issue.sheet);if(!sheet)return '';
 const schema=workbook.inferTableSchema(state.model,sheet.name,'customer');
 const cells=Object.entries(schema.columns).sort(([a],[b])=>a.localeCompare(b)).map(([field,col])=>{const address=workbook.columnAddress(state.model,col,issue.row),cell=workbook.getCell(state.model,sheet.name,address);return[field,address,cell?.value??'',cell?.formula||''];});
 return JSON.stringify(cells);
}
export function isReviewIgnored(state,issue,workbook){
 if(issue?.code!=='UNPRICED_ITEM')return false;
 const decision=state.reviewDecisions?.get(key(issue));return !!decision&&decision.stamp===reviewStamp(state,issue,workbook);
}
export function syncReviewDecisions(state,workbook){
 state.reviewDecisions??=new Map();const present=new Set();
 for(const issue of state.audit?.issues||[]){if(issue.code!=='UNPRICED_ITEM')continue;const id=key(issue);present.add(id);issue.reviewIgnored=isReviewIgnored(state,issue,workbook);if(!issue.reviewIgnored)state.reviewDecisions.delete(id);}
 for(const id of state.reviewDecisions.keys())if(!present.has(id))state.reviewDecisions.delete(id);
 for(const id of state.unpricedSelection||[])if(!(state.audit.issues||[]).some(x=>x.id===id&&!x.reviewIgnored))state.unpricedSelection.delete(id);
 state.audit.ignoredUnpriced=(state.audit.issues||[]).filter(x=>x.reviewIgnored).length;
 state.audit.pendingUnpriced=Math.max(0,(state.audit.unpriced||0)-state.audit.ignoredUnpriced);
 return state.audit;
}
export function setReviewIgnored(state,issue,ignored,workbook,{sync=true}={}){
 if(issue?.code!=='UNPRICED_ITEM')throw Error('只有尚未估價項目可以暫時忽略；計算或公式錯誤仍需處理。');
 state.reviewDecisions??=new Map();if(ignored)state.reviewDecisions.set(key(issue),{stamp:reviewStamp(state,issue,workbook),at:new Date().toISOString()});else state.reviewDecisions.delete(key(issue));
 if(sync)syncReviewDecisions(state,workbook);
}
