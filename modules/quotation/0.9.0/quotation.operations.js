export function createQuotationOperations({workbook,visibleSheets,sheet,editable,change,itemTypes,calculation}){
 const allowedRows=(s,sh)=>workbook.classifyRows(s.model,sh.name,'customer');
 const number=v=>{if(typeof v==='number')return Number.isFinite(v)?v:null;const t=String(v??'').replace(/,/g,'').trim();return t&&Number.isFinite(Number(t))?Number(t):null;};
 const selected=(s,scope)=>scope==='all'?visibleSheets(s.model):[sheet(s.model)];
 const hidden=(sh,schema)=>[...sh.hiddenRows].some(r=>r>schema.headerRow&&r<=(sh.customerRange||sh.range).e.r);
 function targets(s,raw){
  if(raw===undefined)return null;
  if(!Array.isArray(raw)||!raw.length||raw.length>20)throw Error('請指定1至20個明確儲存格');
  return raw.map(t=>{if(!t||Object.keys(t).some(k=>!['sheet','address'].includes(k))||typeof t.address!=='string'||!/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(t.address))throw Error('診斷儲存格格式錯誤');const sh=sheet(s.model,t.sheet);calculation.accessible(s.model,sh.name,t.address);if(!workbook.getCell(s.model,sh.name,t.address))throw Error('目標儲存格不存在');return{sheet:sh.name,address:t.address};});
 }
 function numbering(s,sh,{format='preserve',start=1,reset='section'}={}){
  const schema=workbook.inferTableSchema(s.model,sh.name,'customer');
  if(schema.columns.itemNo==null||schema.confidence<3)throw Error(sh.displayName+'：沒有可辨識的項次欄位，請指定儲存格。');
  if(hidden(sh,schema))throw Error(sh.displayName+' 含隱藏列，請先決定是否納入編號；未更動隱藏資料。');
  let n=start-1;const edits=[];
  for(const row of allowedRows(s,sh)){
   if(['SECTION','AREA_HEADER','SUBTOTAL','SUMMARY'].includes(row.type)){if(reset==='section')n=start-1;continue;}
   if(!itemTypes.includes(row.type))continue;n++;
   const address=workbook.columnAddress(s.model,schema.columns.itemNo,row.row),cell=editable(s.model,sh,address),old=String(cell.value??'').trim();
   if(old&&!/^\d+$/.test(old)&&format!=='arabic')throw Error(sh.displayName+' 有文字項次。請說「項次全部改成阿拉伯數字」以指定轉換規則。');
   if(cell.value!==n)edits.push({sh,address,value:n,label:row.itemName+'／項次'});
  }return edits;
 }
 function diagnose(s,scope='all',targetList=null){
  const sheets=selected(s,scope),audit=workbook.audit({...s.model,sheets},{viewMode:'customer'}),issues=[];
  for(const issue of audit.issues||[]){
   if(['ITEM_NUMBER_GAP','ITEM_NUMBER_ORDER'].includes(issue.code))continue;
   const sh=sheets.find(x=>x.name===issue.sheet);if(!sh)continue;
   let repairKind=null,expected=null,reason='需要補充資料或人工判斷，沒有自動套用。';
   if(issue.code==='AMOUNT_MISMATCH'){
    const row=allowedRows(s,sh).find(x=>x.row===issue.row),q=number(row?.qty),p=number(row?.unitPrice);
    try{const cell=editable(s.model,sh,issue.address);if(!cell.formula&&q!=null&&p!=null&&q>=0&&p>=0){expected=Math.round(q*p*100)/100;if(Number.isFinite(expected)&&expected<=1e9){repairKind='amount';reason='依目前數量×單價重算固定複價，不變更單價或公式。';}}}catch(error){reason=error.message;}
   }
   if(issue.code==='FORMULA_VALUE_MISMATCH'){
    try{const out=calculation.preview(s.model,[{sheet:sh.name,address:issue.address}]),update=out.updates.find(u=>u.sheet===sh.name&&u.address===issue.address);
     if(update&&!out.blocked.some(b=>b.sheet===sh.name&&b.address===issue.address)){repairKind='formula';expected=update.value;reason='保留既有公式，依目前可見來源重算；連動差異會一併預覽。';}
     else reason=out.blocked[0]?.reason||'目前重算結果沒有可套用差異，請重新檢查。';
    }catch(error){reason=error.message;}
   }
   issues.push({...issue,repairKind,expected,reason,safeFix:undefined});
  }
  for(const sh of sheets){
   const schema=workbook.inferTableSchema(s.model,sh.name,'customer');if(schema.columns.itemNo==null||schema.confidence<3)continue;
   let n=0,blocked='';try{numbering(s,sh);}catch(error){blocked=error.message;}
   for(const row of allowedRows(s,sh)){
    if(['SECTION','AREA_HEADER','SUBTOTAL','SUMMARY'].includes(row.type)){n=0;continue;}
    if(!itemTypes.includes(row.type))continue;n++;const old=String(row.itemNo??'').trim();if(/^\d+$/.test(old)&&Number(old)===n)continue;
    const code=!old?'ITEM_NUMBER_MISSING':/^\d+$/.test(old)?'ITEM_NUMBER_ORDER':'ITEM_NUMBER_FORMAT';
    issues.push({id:'sequence-'+sh.index+'-'+row.row,sheet:sh.name,row:row.row,address:workbook.columnAddress(s.model,schema.columns.itemNo,row.row),code,severity:'notice',message:`${row.itemName}：項次「${old||'空白'}」，依現有列順序應為 ${n}。`,repairKind:blocked?null:'numbering',expected:n,reason:blocked||'依現有列順序，每章節／區域從1開始；不移動列。'});
   }
  }
  return targetList?issues.filter(i=>targetList.some(t=>t.sheet===i.sheet&&t.address===i.address)):issues;
 }
 const tools=[
  {name:'quotation.audit',description:'本機檢查客戶報價，結果保留本機。args:{scope?:"active"|"all",targets?:[{sheet?:工作表精確名稱,address:使用者明確指定的儲存格}]}；預設all，targets可限定指定儲存格。不修改資料。'},
  {name:'quotation.recalculate',description:'保留既有公式，預覽重算及可見客戶報價的連動差異，確認後才套用。args:{scope?:"active"|"all",targets?:[{sheet?:工作表精確名稱,address:使用者明確指定的儲存格}]}。不改公式、不猜儲存格、不處理隱藏/內部/外部/動態參照；全表必須明確要求。'},
  {name:'quotation.renumber',description:'校正項次，不移動列。args:{scope:"active"|"all",format?:"preserve"|"arabic",start?:正整數,reset?:"section"|"continuous"}。預設保留文字編號、補空白數字，每章節從1開始。使用者明說轉數字才format:arabic；全工作表必須明確要求。'},
  {name:'quotation.repair',localOnly:true,description:'本機任務控制器使用：依保存的診斷ID產生安全修正差異。'}
 ];
 function run(s,tool,args,changes){
  const results=[],diagnostics=[],formulaTargets=[];let blocked=0;
  if(tool==='quotation.audit'){
   if(Object.keys(args).some(k=>!['scope','targets'].includes(k))||args.scope!==undefined&&!['active','all'].includes(args.scope))throw Error('診斷範圍格式錯誤');
   const targetList=targets(s,args.targets),issues=diagnose(s,targetList?'all':args.scope||'all',targetList);diagnostics.push({module:'quotation',issues,targets:targetList});
   results.push(`本機診斷：${issues.length} 項提醒，${issues.filter(x=>x.repairKind).length} 項可產生安全修正預覽。這不是工程正確性的全面保證。`,...issues.map(x=>`${x.sheet}!${x.address||'R'+(x.row+1)} [${x.code}] ${x.message} ${x.repairKind?'可預覽修正。':x.reason}`));
  }else if(tool==='quotation.recalculate'){
   if(Object.keys(args).some(k=>!['scope','targets'].includes(k))||args.scope!==undefined&&!['active','all'].includes(args.scope))throw Error('重算範圍格式錯誤');
   const targetList=targets(s,args.targets);formulaTargets.push(...(targetList||selected(s,args.scope||'active').flatMap(sh=>[...sh.cells.values()].filter(c=>c.formula).flatMap(c=>{try{calculation.accessible(s.model,sh.name,c.address);return[{sheet:sh.name,address:c.address}];}catch{return[];}}))));
   if(!formulaTargets.length)results.push('指定範圍沒有可重算的既有公式，沒有修改資料。');
   results.push('只重新計算既有公式；保留公式文字、數量與單價。連動的小計／總計若有差異，會完整列入確認表。');
   diagnostics.push({module:'quotation',issues:diagnose(s,targetList?'all':args.scope||'active',targetList),targets:targetList});
  }else if(tool==='quotation.renumber'){
   if(Object.keys(args).some(k=>!['scope','format','start','reset'].includes(k))||!['active','all'].includes(args.scope)||args.format!==undefined&&!['preserve','arabic'].includes(args.format)||args.reset!==undefined&&!['section','continuous'].includes(args.reset)||args.start!==undefined&&(!Number.isSafeInteger(args.start)||args.start<1||args.start>1e6))throw Error('編號規則格式錯誤');
   const edits=selected(s,args.scope).flatMap(sh=>numbering(s,sh,args));
   for(const e of edits)change(s,e.sh,e.address,e.value,e.label,changes);
   results.push(`只校正項次；保留原列順序。起始 ${args.start||1}，${args.reset==='continuous'?'連續編號':'每章節／區域重新開始'}。`);
  }else if(tool==='quotation.repair'){
   if(Object.keys(args).some(k=>!['scope','issueIds','format','targets'].includes(k))||args.scope!==undefined&&!['active','all'].includes(args.scope)||args.format!==undefined&&!['preserve','arabic'].includes(args.format)||args.issueIds&&args.targets)throw Error('修正範圍格式錯誤');
   if(args.issueIds!==undefined&&(!Array.isArray(args.issueIds)||args.issueIds.length>500||args.issueIds.some(x=>typeof x!=='string')))throw Error('診斷識別碼格式錯誤');
   const targetList=targets(s,args.targets),current=diagnose(s,args.issueIds||targetList?'all':args.scope||'active',targetList),ids=args.issueIds?new Set(args.issueIds):null;
   if(ids&&[...ids].some(id=>!current.some(x=>x.id===id)))throw Error('診斷目標已改變，請重新診斷。');
   const issues=ids?current.filter(x=>ids.has(x.id)):current,numberSheets=new Set(),edits=[];
   for(const issue of issues){
    if(issue.repairKind==='formula'){formulaTargets.push({sheet:issue.sheet,address:issue.address});continue;}
    if(issue.repairKind==='numbering'||/^ITEM_NUMBER_/.test(issue.code)&&args.format==='arabic'){numberSheets.add(issue.sheet);continue;}
    if(issue.repairKind==='amount'){const sh=sheet(s.model,issue.sheet);edits.push({sh,address:issue.address,value:issue.expected,label:'固定複價重算'});continue;}
    blocked++;results.push(`待決定：${issue.sheet}!${issue.address||''} ${issue.message} ${issue.reason}`);
   }
   for(const name of numberSheets){try{edits.push(...numbering(s,sheet(s.model,name),{format:args.format||'preserve'}));results.push(name+'：項次需要連動校正，同表的實際編號差異會完整列出。');}catch(error){blocked++;results.push('未處理：'+error.message);}}
   for(const e of edits)change(s,e.sh,e.address,e.value,e.label,changes);
   results.push(`本次僅預覽可確定的本機修正；${blocked} 項仍需補充或人工判斷。未改單價、公式文字、內部成本或原始檔。`);
   diagnostics.push({module:'quotation',issues,targets:targetList||(ids?issues.map(i=>({sheet:i.sheet,address:i.address})):null)});
  }
  return{results,diagnostics,formulaTargets,outcome:blocked?'needs-input':changes.length||formulaTargets.length?'preview':tool==='quotation.audit'?'diagnosed':'no-change'};
 }
 return{tools,run,diagnose};
}
