// Plans contain final, confirmed values. Intermediate dependent formula values are
// calculated locally from the current step; no additional field may be written.
export function quotationSequence({workbook,calculation,clone,fingerprint,assert}) {
 return function sequence(before,after,changes) {
  const allowed=new Set(changes.map(c=>c.key)),groups=new Map(),formulas=[];
  for(const c of changes){const match=/^(.*)!([A-Z]{1,3}[1-9]\d*)$/.exec(c.key||'');assert(match,'無法辨識逐步修改目標');const [,sheet,address]=match,cell=workbook.getCell(before.model,sheet,address);assert(cell,'修改目標已不存在');
   if(cell.formula)formulas.push({sheet,address});
   else{const key=sheet+'!'+address.replace(/[A-Z]/g,'');if(!groups.has(key))groups.set(key,[]);groups.get(key).push({sheet,address,value:c.after});}
  }
  const steps=[...groups.values()].map(edits=>({edits,target:edits[0],label:edits.map(e=>e.sheet+'!'+e.address).join('、')}));
  if(!steps.length&&formulas.length)steps.push({edits:[],target:formulas[0],label:'保留公式，重算 '+formulas.length+' 個相依欄位'});
  function advance(s,index){const step=steps[index];assert(step,'逐步操作已失效');
   if(step.edits.length)workbook.applyCellBatch(s.model,step.edits);
   const out=calculation.apply(s.model,{changed:step.edits.map(e=>e.sheet+'!'+e.address),targets:index===steps.length-1?formulas:[]});
   for(const c of out.changes)if(!allowed.has(c.key))throw Object.assign(Error('相依公式需合併來源步驟以維持已確認範圍'),{code:'REQUIRES_GROUP'});
   if(index===steps.length-1){
    // Verify values, formulas, formats and structure before transferring final
    // journal timestamps and invalidated suggestions from the approved preview.
    const semantic=model=>{const wb=clone(model.workbook);for(const ws of Object.values(wb.Sheets||{}))for(const [key,cell]of Object.entries(ws))if(!key.startsWith('!')&&cell&&typeof cell==='object')delete cell.w;return fingerprint(wb);};
    assert(semantic(s.model)===semantic(after.model)&&fingerprint(s.model.sheets)===fingerprint(after.model.sheets),'逐步計算與已確認差異不一致，已停止');
    return clone(after);
   }
   return s;
  }
  return{steps,advance,coalesce(){if(steps.length<2)return false;const edits=steps.flatMap(x=>x.edits);steps.splice(0,steps.length,{edits,target:edits[0]||formulas[0],label:`合併 ${edits.length} 個相依來源欄位，保持合計一致`});return true;}};
 };
}
