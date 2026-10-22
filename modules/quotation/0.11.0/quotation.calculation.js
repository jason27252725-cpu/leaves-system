// Formula text never comes from AI. Only existing visible customer formulas are evaluated.
export function createQuotationCalculation({workbook,visibleSheets}){
 const key=(sheet,address)=>sheet+'!'+address;
 const split=k=>{const i=k.lastIndexOf('!');return{sheet:k.slice(0,i),address:k.slice(i+1)};};
 const same=(a,b)=>typeof a==='number'&&typeof b==='number'?Math.abs(a-b)<1e-9:Object.is(a,b);
 function accessible(model,name,address){
  const sh=visibleSheets(model).find(s=>s.name===name),cell=sh?.cells.get(address),p=model.XLSX.utils.decode_cell(address),r=sh?.customerRange||sh?.range;
  if(!sh||!r||p.r<r.s.r||p.r>r.e.r||p.c<r.s.c||p.c>r.e.c||sh.hiddenRows.has(p.r)||sh.hiddenCols.has(p.c))throw Error('公式參照超出可見客戶報價範圍；請在 Excel 核對來源。');
  for(const m of sh.merges||[])if(p.r>=m.s.r&&p.r<=m.e.r&&p.c>=m.s.c&&p.c<=m.e.c&&(p.r!==m.s.r||p.c!==m.s.c))throw Error('公式參照合併儲存格的非主格，需要人工核對。');
  return{sh,cell};
 }
 function resolve(model,{targets=[],changed=[],cascade=true}={}){
  const values=new Map(),memo=new Map(),visiting=new Set(),failures=new Map(),accepted=new Set(),roots=new Set(targets.map(t=>key(t.sheet,t.address))),changedKeys=new Set(changed),candidates=new Map();let visits=0;
  if(cascade)for(const sh of visibleSheets(model))for(const cell of sh.cells.values())if(cell.formula){try{accessible(model,sh.name,cell.address);candidates.set(key(sh.name,cell.address),{sheet:sh.name,address:cell.address});}catch{}}
  const visit=(name,address,depth=0)=>{
   const k=key(name,address);if(memo.has(k))return memo.get(k);if(visiting.has(k))throw Error('公式有循環參照，沒有自動更動。');
   if(depth>64||++visits>20000)throw Error('公式連動範圍過大，請縮小目標或在 Excel 重算。');
   const{cell}=accessible(model,name,address);if(!cell)return '';
   if(!cell.formula){if(cell.type==='e')throw Error('來源儲存格含有錯誤值，請先核對來源。');return cell.value;}
   if(/\b(?:TODAY|NOW|RAND|RANDBETWEEN|INDIRECT|OFFSET|WEBSERVICE)\s*\(|\[|\]/i.test(cell.formula))throw Error('動態、外部或間接參照公式需要在 Excel 核對，沒有自動更動。');
   visiting.add(k);
   try{
    const result=workbook.evaluateExistingFormula(model,name,address,(s,a)=>visit(s,a,depth+1));
    if(!result.ok||typeof result.value!=='number'||!Number.isFinite(result.value)||Math.abs(result.value)>1e12)throw Error('本機尚無法可靠計算此公式（'+(result.code||'非數值結果')+'），原公式與數值保留。');
    memo.set(k,result.value);values.set(k,{sheet:name,address,value:result.value,formula:cell.formula});return result.value;
   }finally{visiting.delete(k);}
  };
  const attempt=(k,t)=>{try{visit(t.sheet,t.address);accepted.add(k);return true;}catch(error){failures.set(k,{...t,reason:error.message});return false;}};
  for(const k of roots){const t=split(k);try{const{cell}=accessible(model,t.sheet,t.address);if(!cell?.formula)throw Error('此儲存格沒有既有公式；請指定要修改的內容。');attempt(k,t);}catch(error){failures.set(k,{...t,reason:error.message});}}
  // Include downstream visible customer formulas; never recalculate internal/hidden sheets.
  const collect=(k,out,seen=new Set())=>{if(seen.has(k)||!values.has(k))return;seen.add(k);out.add(k);for(const d of model.formulas?.get(k)?.deps||[])collect(d,out,seen);};
  const frontier=new Set(changedKeys),processed=new Set(roots);for(const k of accepted)collect(k,frontier);
  for(let pass=0;pass<65;pass++){
   let added=0;
   for(const[k,t]of candidates){if(processed.has(k)||frontier.has(k))continue;const deps=model.formulas?.get(k)?.deps||new Set();if([...deps].some(d=>frontier.has(d))){processed.add(k);added++;if(attempt(k,t))collect(k,frontier);}}
   if(!added)break;if(pass===64)throw Error('公式連動層數過多，請縮小範圍。');
  }
  // Values belonging to a failed root are only retained when they were also reached by
  // a successful root. Re-evaluate successful roots to avoid incomplete dependency writes.
  const needed=new Set();for(const k of accepted)collect(k,needed);
  const updates=[...values].filter(([k,v])=>needed.has(k)&&!same(model.sheets.find(s=>s.name===v.sheet)?.cells.get(v.address)?.value,v.value)).map(([,v])=>({...v,before:model.sheets.find(s=>s.name===v.sheet).cells.get(v.address).value}));
  if(updates.length>500)throw Error('連動公式差異超過500筆，請縮小目標。');
  return{updates,blocked:[...failures.values()]};
 }
 function preview(model,targets){return resolve(model,{targets,cascade:false});}
 function apply(model,request){const out=resolve(model,request);if(out.updates.length)workbook.refreshFormulaValues(model,out.updates);return{...out,changes:out.updates.map(v=>({key:key(v.sheet,v.address),target:v.sheet+'!'+v.address+'／公式重算（保留 ='+v.formula+'）',before:v.before,after:v.value}))};}
 return{preview,resolve,apply,accessible};
}
