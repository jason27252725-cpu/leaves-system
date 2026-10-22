import {copy,canonical,norm,decimal,quotationRows,candidates,requirements,computeCost,sumCosts,pinCostSnapshot,costRuleRevision} from './quotation.cost-match.js';

export function createCostAnalysis({context,workspace,workbook,cost,clock=Date.now}){
 const projects=new Map();let disposed=false,ticket=null,lastUndo=null,serial=0;
 function authorized(){
  const s=context.getSessionSnapshot?.(),role=String(context.accessRole||'');
  if(disposed||!s?.authenticated||!['owner','admin'].includes(role)||s.accessRole&&s.accessRole!==role)throw Error('此內部成本分析僅限目前登入的管理員／最高管理員');
  const token=context.assistant?.sessionToken?.();if(!token)throw Error('工作階段識別不存在，請重新登入');
  return{token,role,environment:context.environment};
 }
 function active(){const a=authorized(),id=workspace.getActiveDraftId?.(),state=workspace.getRecord?.(id);if(!id||!state?.model?.structured)throw Error('請先匯入並開啟一份可解析的 Excel 報價草稿');return{...a,id,state};}
 function binding(){const a=active();return canonical({session:a.token,role:a.role,environment:a.environment,draft:a.id});}
 function project(required=true){const a=active(),p=projects.get(a.id);if(p&&p.binding!==binding()){projects.delete(a.id);ticket=null;lastUndo=null;throw Error('身分或工作階段已變更，成本分析已失效，請重新讀取');}if(required&&!p)throw Error('請先讀取 Current 成本快照');return p;}
 function rows(){const a=active();return quotationRows(a.state.model,workbook);}
 function findRow(id){const row=rows().find(r=>r.id===id);if(!row)throw Error('報價列已不存在或不可見，請重新比對');return row;}
 function rowStamp(row){return canonical(row);}
 function valid(record,p,seen=new Set()){
  if(!record||record.snapshotHash!==p.snapshot.hash||record.ruleRevision!==costRuleRevision||seen.has(record.rowId))return false;
  seen.add(record.rowId);let row;try{row=findRow(record.rowId);}catch{return false;}if(record.rowStamp!==rowStamp(row))return false;
  if(record.parentId){const parent=p.records.get(record.parentId);if(parent?.receiptId!==record.parentReceipt||!valid(parent,p,seen))return false;}
  return true;
 }
 function statuses(){const p=project(),all=rows();return all.map(row=>{const saved=p.records.get(row.id),ok=valid(saved,p);return{row,saved:copy(saved||null),status:saved?(ok?'confirmed':'stale'):'pending'};});}
 function evaluate(input,p){
  if(!input||typeof input!=='object')throw Error('沒有可預覽的計價條件');
  const row=findRow(input.rowId),item=p.snapshot.items.find(x=>x.itemCode===input.itemCode);if(!item)throw Error('選擇的成本項目不在固定快照中');
  const r=requirements(row,item,input);
  if(!r.known)throw Error(r.note);if(r.hold)throw Error(r.note);
  if(r.conflicts.length)throw Error(r.conflicts.join('；'));
  if(r.missing.length)throw Error('仍缺規格：'+r.missing.join('、'));
  if(!input.conditionsConfirmed||!input.quantityConfirmed)throw Error('請逐案核對規格、包含範圍與實際計價數量');
  const note=String(input.note||'').trim();if(note.length<8||note.length>1200)throw Error('請填寫至少 8 字的本案規格／計價依據（上限 1200 字）');
  if(input.currency!==item.currency||!['inclusive','exclusive'].includes(input.taxBasis))throw Error('須確認來源幣別及含稅／未稅條件；系統不自行推定');
  const quantity=decimal(input.quantity);if(quantity==null||quantity<=0)throw Error('請填入有效、正數的實際成本計價數量');
  if((norm(row.unit)!==norm(item.unit)||decimal(row.qty)!==quantity)&&String(input.conversionNote||'').trim().length<8)throw Error('單位或計價數量不同，需填寫換算／計數依據；不自動猜測台尺、公尺、組或片');
  if(['片','組','處','件','場'].includes(item.unit)&&!Number.isInteger(quantity))throw Error('本項依片／組／處／件／場的實際整數計數，不自行採用小數');
  const fullText=row.itemName+' '+row.note+' '+note;
  if(item.itemCode==='SC-035'&&/無電梯|沒有電梯/.test(fullText))throw Error('有電梯出車費不能套用於無電梯搬運');
  if(item.itemCode==='SC-036'){
   const floors=[...fullText.matchAll(/(\d+)\s*(?:F\b|樓)/gi)].map(m=>Number(m[1]));
   const chinese={一:1,二:2,兩:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};for(const m of fullText.matchAll(/([一二兩三四五六七八九十])樓/g))floors.push(chinese[m[1]]);
   if(/(?:^|[^無沒])有電梯|地下|\bB\s*\d+\s*F\b/i.test(fullText)||floors.some(n=>n!==3))throw Error('此標準只適用無電梯搬運 3F，不按其他樓層換算');
   if(decimal(input.floor)!==3)throw Error('請明確確認本案搬運樓層為 3F；其他樓層保留待決');
  }
  if(item.itemCode==='SC-023'&&!(decimal(input.openingCm)>60))throw Error('此項須核對開孔量測方向及超過 60cm 的實際尺寸');
  let parent=null;const scope=String(input.scope||'').trim();
  if(r.addon){
   if(!input.parentId||input.parentId===row.id)throw Error('加項必須指定另一個已確認主項');
   parent=p.records.get(input.parentId);if(!valid(parent,p)||parent.kind!=='base')throw Error('所屬主項尚未確認或已失效，請先處理主項');
   if(scope.length<3||scope.length>160)throw Error('請填寫本加項的具體位置／計數範圍，避免重複計價');
   const pf=parent.family;
   if(['SC-018','SC-019'].includes(item.itemCode)&&pf!=='書桌')throw Error('此加項必須連結書桌主項');
   if(item.itemCode==='SC-032'&&pf!=='壁板')throw Error('壁板結構加項必須連結壁板主項');
   if(['SC-022','SC-023'].includes(item.itemCode)&&parent.itemCode==='SC-008')throw Error('鞋櫃透氣孔是否已包含尚未釐清，禁止重複加價');
  }
  if(r.job){if(scope.length<3||scope.length>160||!Number.isInteger(quantity))throw Error('場級費用需填寫工地／批次範圍及整數場數');}
  const group=['SC-035','SC-036'].includes(item.itemCode)?'transport':['SC-022','SC-023'].includes(item.itemCode)?'vent':['SC-013','SC-014','SC-015'].includes(item.itemCode)?'drawer':['SC-003','SC-004'].includes(item.itemCode)?'lighting-groove':item.itemCode;
  const duplicateKey=(r.job||r.addon)?canonical([group,parent?.rowId||'job',norm(scope)]):'';
  for(const old of p.records.values())if(old.rowId!==row.id&&valid(old,p)&&duplicateKey&&old.duplicateKey===duplicateKey)throw Error('同一主項／工地批次範圍已有相同或互斥費用，請核對後合併處理');
  const amount=computeCost(quantity,item.unitCost,item.baseQty,input.rounding);
  return{rowId:row.id,rowStamp:rowStamp(row),sheet:row.sheet,address:row.address,itemName:row.itemName,itemCode:item.itemCode,standardName:item.itemName,kind:r.job?'job':r.addon?'addon':'base',family:r.family,parentId:parent?.rowId||'',parentTarget:parent?`${parent.sheet}!${parent.address} · ${parent.itemName}`:'',parentReceipt:parent?.receiptId||'',scope,duplicateKey,quantity,unit:item.unit,unitCost:item.unitCost,baseQty:item.baseQty,amount,currency:item.currency,taxBasis:input.taxBasis,rounding:input.rounding,calculation:`${quantity} ÷ ${item.baseQty} × ${item.unitCost}`,note,conversionNote:String(input.conversionNote||'').trim(),supplemental:Object.fromEntries(['widthCm','depthCm','heightCm','thicknessMm','floor','openingCm'].filter(k=>input[k]!==undefined&&String(input[k])!=='').map(k=>[k,decimal(input[k])])),sourceLine:item.sourceLine??null,sourceNote:String(item.sourceNote||''),snapshotHash:p.snapshot.hash,versionKey:copy(p.snapshot.identity),ruleRevision:costRuleRevision,remember:input.remember===true};
 }
 return Object.freeze({
  canUse(){try{authorized();return true;}catch{return false;}},
  choices(rowId){const p=project();return copy(candidates(findRow(rowId),p.snapshot,p.rules));},
  async load({signal}={}){
   const a=active(),bound=binding();const existing=project(false);if(existing)return copy(existing.snapshot);
   const check=()=>{if(signal?.aborted)throw Error('已取消讀取成本快照');if(binding()!==bound)throw Error('讀取期間身分或草稿已變更，已捨棄成本結果');};
   const snapshot=await pinCostSnapshot(cost,{environment:a.environment,signal,check});check();
   // Concurrent callers share the first accepted snapshot instead of replacing a ledger.
   if(!projects.has(a.id))projects.set(a.id,{binding:bound,snapshot:copy(snapshot),records:new Map(),rules:[],revision:0});
   return copy(project().snapshot);
  },
  view(){const p=project(false);if(!p)return{ready:false,rows:rows()};const list=statuses(),totals={};for(const x of list)if(x.status==='confirmed'){const r=x.saved,k=r.currency+'|'+r.taxBasis;(totals[k]??={currency:r.currency,taxBasis:r.taxBasis,amount:'0',values:[],count:0}).values.push(r.amount);totals[k].count++;}for(const t of Object.values(totals)){t.amount=sumCosts(t.values);delete t.values;}
   return{ready:true,snapshot:copy(p.snapshot),rows:list,totals:Object.values(totals),pending:list.filter(x=>x.status!=='confirmed').length,confirmed:list.filter(x=>x.status==='confirmed').length,rules:copy(p.rules),revision:p.revision};},
  preview(input){const p=project(),after=evaluate(input,p),before=p.records.get(after.rowId)||null;if(before&&valid(before,p)&&canonical({...before,receiptId:null,confirmedAt:null})===canonical({...after,receiptId:null,confirmedAt:null}))throw Error('與已確認的內部分析沒有差異');
   ticket={id:'cost-preview-'+(++serial),binding:binding(),revision:p.revision,at:clock(),input:copy(input),before:copy(before),after:copy(after)};
   return copy({id:ticket.id,before,after,warning:'只保存本機內部分析，不修改 Excel 或對客售價。'});
  },
  cancelPreview(){ticket=null;},
  apply(id){if(context.assistant?.guardMutation?.()!==true)throw Error('目前系統暫停修改，沒有保存內部分析');const p=project(),t=ticket;if(!t||t.id!==id)throw Error('此比較已取消或被新比較取代');if(clock()-t.at>600000||t.binding!==binding()||t.revision!==p.revision)throw Error('此比較已過期或資料已變更，請重新預覽');
   const now=evaluate(t.input,p);if(canonical(now)!==canonical(t.after))throw Error('規格、數量、主項或成本條件已變更，請重新預覽');
   const saved={...copy(now),receiptId:'cost-receipt-'+(++serial),confirmedAt:new Date(clock()).toISOString()};
   p.records.set(saved.rowId,saved);p.revision++;
   const rulesBefore=copy(p.rules);if(saved.remember){const row=findRow(saved.rowId),key=norm(row.itemName)+'|'+norm(row.unit);p.rules=p.rules.filter(x=>x.key!==key);p.rules.push({key,itemCode:saved.itemCode,ruleRevision:costRuleRevision,scope:'this-draft-only'});}
   lastUndo={id:saved.receiptId,rowId:saved.rowId,before:t.before,after:copy(saved),binding:t.binding,revision:p.revision,rulesBefore};ticket=null;return copy(saved);
  },
  undo(id){if(context.assistant?.guardMutation?.()!==true)throw Error('目前系統暫停修改，沒有復原內部分析');const p=project(),u=lastUndo;if(!u||u.id!==id||u.binding!==binding()||u.revision!==p.revision||canonical(p.records.get(u.rowId))!==canonical(u.after)||!valid(u.after,p))throw Error('分析、主項或報價列已有後續變更，不能用舊復原覆蓋');if(u.before)p.records.set(u.rowId,copy(u.before));else p.records.delete(u.rowId);p.rules=copy(u.rulesBefore);p.revision++;ticket=null;lastUndo=null;return{ok:true};},
  async exportData(){const p=project();return{schemaVersion:1,type:'LEAVES-INTERNAL-COST-ANALYSIS',createdAt:new Date().toISOString(),ruleRevision:costRuleRevision,draftId:active().id,sourceFileName:active().state.draft?.file?.name||'',snapshot:copy(p.snapshot),analysis:statuses().map(x=>({row:copy(x.row),status:x.status,record:x.saved})),rules:copy(p.rules),summary:copy(this.view().totals),notice:'內部成本分析，含成本機密。僅匯出本工作階段紀錄；不是對客報價，也不是工程量驗證。quantityValidated=false。'};},
  async suggest(rowId,{signal}={}){
   const p=project(),bound=binding(),row=findRow(rowId),stamp=rowStamp(row),choices=candidates(row,p.snapshot,p.rules);if(!choices.length)throw Error('沒有具依據的本機候選，請先搜尋或補足項目規格');
   const planning=context.assistant?.suggestCostCandidate;if(typeof planning!=='function')throw Error('目前 Core 未提供成本候選專用 AI 介面，仍可使用本機候選比對');
   const check=()=>{if(signal?.aborted||binding()!==bound||rowStamp(findRow(rowId))!==stamp||project().snapshot.hash!==p.snapshot.hash)throw Error('AI 分析已取消，或身分／草稿／報價列已變更，結果已捨棄');};
   const safeField=k=>row.sourceCells?.[k]?.formula?'[公式衍生值未提供]':row[k];
   const evidence={row:{itemName:safeField('itemName'),note:safeField('note'),unit:safeField('unit'),qty:safeField('qty'),section:''},candidates:choices.map(c=>{const i=p.snapshot.items.find(x=>x.itemCode===c.itemCode);return{itemCode:i.itemCode,itemName:i.itemName,specDescription:String(i.specDescription||''),unit:i.unit,dimensions:i.dimensions||{},conditionNote:c.match.note,conflicts:c.match.conflicts,missing:c.match.missing};})};
   // Explicit user action only. No entire workbook, sale prices, Cost Master prices,
   // raw model data, tokens, or ledger contents are sent. Workbook text is untrusted.
   check();const result=await planning(evidence,{signal});
   check();const text=String(result||'').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');let parsed;try{if(text.length>12000)throw Error();parsed=JSON.parse(text);}catch{throw Error('AI 候選回覆格式無效，沒有套用任何結果');}
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).some(k=>!['itemCode','reason','questions'].includes(k))||parsed.itemCode!==null&&!choices.some(x=>x.itemCode===parsed.itemCode)||typeof parsed.reason!=='string'||parsed.reason.length>1200||!Array.isArray(parsed.questions)||parsed.questions.length>8||parsed.questions.some(x=>typeof x!=='string'||x.length>500))throw Error('AI 回覆不在允許候選或格式範圍，已捨棄');
   return{...copy(parsed),rowId,source:'AI candidate only',noPriceCalculation:true};
  },
  dispose(){disposed=true;ticket=null;lastUndo=null;projects.clear();}
 });
}
