// Preserve the workbook implementation while checking live, individual grants.
export function quotationAccess(context){
 const epoch=context.identityEpoch?.();
 return permission=>{if(context.identityEpoch?.()!==epoch||!context.identityCan?.('quotation.use')||!context.identityCan?.(permission))throw Object.assign(Error('目前身分沒有這項報價權限。'),{code:'FORBIDDEN'});};
}
export function guardQuotationWorkbook(workbook,context,check=quotationAccess(context)){
 const mutation=new Set(['setCell','applyCellBatch','appendRow','refreshFormulaValues','recalculate']);
 const wrapped={...workbook};
 for(const [key,fn] of Object.entries(workbook))if(typeof fn==='function')wrapped[key]=function(...args){
  if(mutation.has(key)){check('quotation.edit');if(!context.assistant?.guardMutation())throw Object.assign(Error('目前無法修改報價。'),{code:'FORBIDDEN'});}
  if(key==='exportWorkingCopy')check('quotation.export');
  if(key==='parseFile')check('quotation.use');
  return fn.apply(wrapped,args);
 };
 return Object.freeze(wrapped);
}
