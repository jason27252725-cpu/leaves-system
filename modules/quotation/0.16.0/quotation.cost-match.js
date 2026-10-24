import {customerSheets} from './quotation.visibility.js';
import {auditedNames,costRuleNotes,costRuleRevision} from './quotation.cost-rules.js';

export {costRuleRevision};
export const copy=value=>JSON.parse(JSON.stringify(value));
export function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
export async function digest(value){const bytes=new TextEncoder().encode(canonical(value));if(globalThis.crypto?.subtle){const h=await globalThis.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');}return sha256(bytes);}
// SHA-256 fallback for local HTTP previews, where Web Crypto is unavailable.
// Used only for immutable content fingerprints, never identity/session generation.
function sha256(bytes){
 const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],data=new Uint8Array(Math.ceil((bytes.length+9)/64)*64),w=new Uint32Array(64),rotr=(x,n)=>(x>>>n)|(x<<(32-n));
 data.set(bytes);data[bytes.length]=0x80;const dv=new DataView(data.buffer);dv.setUint32(data.length-8,Math.floor(bytes.length/0x20000000));dv.setUint32(data.length-4,(bytes.length*8)>>>0);
 for(let offset=0;offset<data.length;offset+=64){
  for(let i=0;i<16;i++)w[i]=dv.getUint32(offset+i*4);
  for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=((rotr(x,7)^rotr(x,18)^(x>>>3))+w[i-16]+(rotr(y,17)^rotr(y,19)^(y>>>10))+w[i-7])>>>0;}
  let[a,b,c,d,e,f,g,z]=h;
  for(let i=0;i<64;i++){const t1=(z+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  [a,b,c,d,e,f,g,z].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
 }return h.map(x=>x.toString(16).padStart(8,'0')).join('');
}
export function norm(value=''){return String(value).normalize('NFKC').toLowerCase().replace(/[\s，、,。:：()（）\-*×/／]/g,'');}
export function decimal(value){const s=String(value??'').trim().replace(/,/g,'');return /^\d+(?:\.\d{1,6})?$/.test(s)&&Number.isFinite(Number(s))&&Number(s)<=1e9?Number(s):null;}
export function specifications(text=''){
 const out={},raw=String(text).normalize('NFKC');
 const fields={w:'widthCm',寬:'widthCm',d:'depthCm',深:'depthCm',h:'heightCm',高:'heightCm'};
 const scale=unit=>/^(mm|毫米)$/i.test(unit)?.1:/^(m|公尺)$/i.test(unit)?100:1;
 const set=(key,value)=>{if(out[key]!=null&&Math.abs(out[key]-value)>1e-6)out.conflict=true;out[key]=value;};
 for(const m of raw.matchAll(/([WDH寬深高])\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|公分|毫米|公尺|m)?/gi)){
  const tail=raw.slice(m.index+m[0].length),shared=tail.match(/^(?:\s*[*×x]\s*(?:[WDH寬深高]\s*[:：]?\s*)?\d+(?:\.\d+)?)*\s*(mm|cm|公分|毫米|公尺|m)(?![a-z])/i)?.[1],unit=m[3]||shared;
  if(unit){const ambiguousThickness=!m[3]&&/^(mm|毫米)$/i.test(unit)&&/層板/.test(raw)&&/^\s*[*×x]\s*(?:[D深]\s*\d+(?:\.\d+)?\s*[*×x]\s*)?\d+(?:\.\d+)?\s*(?:mm|毫米)/i.test(tail);if(!ambiguousThickness)set(fields[m[1].toLowerCase()],Number(m[2])*scale(unit));}
 }
 for(const m of raw.matchAll(/(?:厚\s*[:：]?\s*|^)(\d+(?:\.\d+)?)\s*(mm|cm|毫米|公分)(?=\s*[-－]?\s*(?:系統板|蜂巢|側包板|假門片)|\s*(?:厚|$))/gi))set('thicknessMm',Number(m[1])*scale(m[2])*10);
 const t=raw.match(/(?:厚\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|毫米|公分)|(\d+(?:\.\d+)?)\s*(mm|毫米)\s*(?:厚|假門片|側包板|系統板))/i);
 if(t)set('thicknessMm',Number(t[1]||t[3])*scale(t[2]||t[4])*10);
 // An unlabelled third dimension is interpreted as thickness only for a shelf,
 // never for a cabinet, lamp, or explicit H dimension. Material remains unknown.
 const shelf=raw.match(/[W寬]\s*\d+(?:\.\d+)?\s*[*×x]\s*[D深]\s*\d+(?:\.\d+)?\s*[*×x]\s*(\d+(?:\.\d+)?)\s*(mm|cm|毫米|公分)/i);
 if(shelf&&/(?:蜂巢|層板)/.test(raw)&&!/層板燈/.test(raw)){set('thicknessMm',Number(shelf[1])*scale(shelf[2])*10);out.thicknessInferred=true;}
 return out;
}
const familyRules=[['蜂巢',/蜂巢/],['穿鞋椅',/穿鞋|穿脫鞋/],['鞋櫃',/鞋櫃/],['衣櫃',/衣櫃|衣櫥/],['書桌',/書桌|寫字桌/],['矮櫃',/矮櫃|低櫃/],['吊櫃',/吊櫃|上櫃/],['展示櫃',/展示/],['淺高櫃',/淺高櫃/],['壁板',/壁板|系統板.*直貼|牆板/],['抽屜',/抽屜|暗抽/],['洗燈溝',/燈溝|燈槽/],['透氣孔',/透氣孔|通風孔/],['鋁框門',/鋁框門/],['滑鏡',/滑鏡/],['滑門',/滑門|移門/],['假門片',/假門片/],['側包板',/側包板/],['遮線盒',/遮線盒/],['門片安裝',/門片.*安裝/],['洗軌道',/洗軌道/],['插座開孔',/插座.*孔/],['出車費',/出車|搬運/],['廢棄清運',/廢棄物|清運/],['R角',/倒\s*r角|r角|圓角/i],['層板燈',/層板燈/],['層板',/層板/]];
export function family(text){return familyRules.find(([name,re])=>re.test(text)&&(name!=='蜂巢'||/層板/.test(text)||/蜂巢板/.test(text)&&!/櫃|書桌|門/.test(text)))?.[0]||'';}
const matchFamily=text=>{const f=family(text);return f==='蜂巢'?'層板':f;};
const unrelatedFee=text=>/監造費|管理費|設計費|規費|保險費|稅金|稅額|利潤|折扣|優惠|^(?:小計|合計|總計)/.test(text);
function grams(value){const s=norm(value).replace(/系統|上項|加/g,'');return new Set([...s].slice(0,-1).map((x,i)=>x+s[i+1]));}
export function profile(item){
 const legacy=norm(auditedNames[item.itemCode])===norm(item.itemName)&&item.tradeCode==='system_cabinet';
 const declared=item.pricingBasis?._leaves_linear?.approved===true&&item.pricingBasis._leaves_linear.algorithm==='per-base-quantity-v1'&&typeof item.pricingBasis._leaves_linear.actorId==='string';
 const known=legacy||declared,addon=legacy?/^上項/.test(item.itemName):['accessory','processing'].includes(item.costKind),job=item.unit==='場'||!legacy&&item.costKind==='logistics';
 return {known,legacy,declared,addon,job,family:family(item.itemName),hold:legacy&&!declared&&['SC-008','SC-020'].includes(item.itemCode),note:[legacy?(costRuleNotes[item.itemCode]||'依來源規格核對材料、工法及範圍。'):declared?'管理員已確認按基準量計價；仍須核對本案數量、單位與適用條件。':'此項尚未確認計價條件，只提供候選，不自動試算。'].filter(Boolean).join(' ')};
}
export function requirements(row,item,input={}){
 const localNote=row.sourceCells?.note?.formula?'':row.sourceCells?.note?.value??(row.contextNotes?.length?'':row.note||'');
 const p=profile(item),observed=specifications(row.itemName+' '+localNote),sourceSpec=specifications(item.itemName+' '+String(item.specDescription||'')),missing=[],conflicts=[],expectedDimensions={};
 if(observed.conflict)conflicts.push('原列規格有互相矛盾的尺寸');
 for(const key of ['widthCm','depthCm','heightCm','thicknessMm']){
  const structured=item.dimensions?.[key],fromName=sourceSpec[key],expected=structured??fromName;if(expected==null)continue;
  expectedDimensions[key]=Number(expected);
  if(structured!=null&&fromName!=null&&Math.abs(Number(structured)-fromName)>1e-6)conflicts.push('標準成本的名稱與結構化尺寸矛盾：'+key);
  const actual=observed[key]??decimal(input[key]);
  if(actual==null)missing.push(key);else if(Math.abs(actual-Number(expected))>1e-6)conflicts.push(`${key}：本列 ${actual} ≠ 標準 ${expected}`);
 }
 if(item.tradeCode==='system_cabinet'&&/木作|實木|木皮|美耐板/.test(row.itemName+' '+row.section)&&!/系統/.test(row.itemName+' '+row.section))conflicts.push('本列工種／材質不是已確認的系統櫃，不能直接沿用');
 if(unrelatedFee(row.itemName))conflicts.push('本列為管理／比例費用，不是材料或系統櫃成本項目');
 const rowFamily=matchFamily(row.itemName),standardFamily=matchFamily(item.itemName);if(!rowFamily&&standardFamily&&norm(row.itemName)!==norm(item.itemName))conflicts.push('本列種類尚未識別，不能直接沿用此材料成本');if(rowFamily&&standardFamily&&rowFamily!==standardFamily)conflicts.push('項目種類不同，不能僅依名稱相似套價');
 const text=row.itemName+' '+localNote;
 const deniedHoneycomb=/(?:非|不是|不採用|不使用|不含|不用|不做)\s*蜂巢|蜂巢(?:板|層板)?\s*(?:不適用|未採用)/.test(text),uncertainHoneycomb=/(?:待確認|未確認|可能|疑似)\s*(?:為)?\s*蜂巢|蜂巢(?:板|層板)?\s*(?:待確認|未確認)/.test(text),constructionRequired=p.legacy&&item.itemCode==='SC-001'&&(!/蜂巢/.test(text)||uncertainHoneycomb);
 if(p.legacy&&item.itemCode==='SC-001'&&deniedHoneycomb)conflicts.push('原列明確排除蜂巢板，不能沿用蜂巢層板成本');
 else if(constructionRequired){if(input.construction==='other')conflicts.push('本列材料不是蜂巢板，不能沿用蜂巢層板成本');else if(input.construction!=='honeycomb')missing.push('construction');}
 if(p.legacy&&(item.itemCode==='SC-003'&&/兩側|左右兩片/.test(text)||item.itemCode==='SC-004'&&/下方/.test(text)))conflicts.push('燈溝所在部位不同，不能混用下方與兩側單價');
 if(p.legacy&&(item.itemCode==='SC-013'&&/座式|暗抽/.test(text)||item.itemCode==='SC-014'&&/三節|暗抽/.test(text)||item.itemCode==='SC-015'&&/三節|座式/.test(text)))conflicts.push('抽屜型式不同，不能混用單價');
 return{...p,observed,expectedDimensions,missing,conflicts,constructionRequired};
}
// Candidate discovery is intentionally broader than eligibility to use a price.
// All previews still pass requirements() and evaluate() independently.
const aliasName=value=>norm(value).replace(/衣櫥/g,'衣櫃').replace(/寫字檯|寫字台|工作桌/g,'書桌').replace(/電視櫃|床尾櫃|收納櫃/g,'矮櫃').replace(/吊掛櫃|壁掛櫃/g,'吊櫃').replace(/置物板|置物層架/g,'層板');
const storageGroup=f=>['鞋櫃','衣櫃','矮櫃','吊櫃','展示櫃','淺高櫃'].includes(f)?'櫃體':f;
export function candidates(row,snapshot,rules=[]){
 if(unrelatedFee(row.itemName))return[];
 const name=aliasName(row.itemName),tokens=grams(name),f=matchFamily(name),hint=rules.find(r=>r.key===norm(row.itemName)+'|'+norm(row.unit))?.itemCode;
 return snapshot.items.map(item=>{const exact=norm(row.itemName)===norm(item.itemName),other=aliasName(item.itemName),sameAlias=name===other,sf=matchFamily(other),sameFamily=!!f&&f===sf,related=!!f&&!!sf&&storageGroup(f)===storageGroup(sf),remembered=hint===item.itemCode;
  const g=grams(other),intersection=[...g].filter(x=>tokens.has(x)).length,similarity=intersection/Math.max(1,Math.min(g.size,tokens.size));
  const lexical=intersection>=2&&similarity>=.45;if(f&&sf&&storageGroup(f)!==storageGroup(sf)&&!exact&&!remembered)return null;
  if(!exact&&!sameAlias&&!sameFamily&&!related&&!remembered&&!lexical)return null;
  const match=requirements(row,item),score=(exact?100:0)+(sameAlias?35:0)+(sameFamily?30:related?20:0)+(remembered?20:0)+similarity*30-(match.conflicts.length?12:0),level=match.conflicts.length||match.hold||!match.known?'reference-only':match.missing.length?'needs-information':'compatible';
  const reasons=[exact?'名稱相同':sameAlias?'別稱可對應':sameFamily?'項目類型相近':related?'同屬櫃體，需核對用途':'部分名稱相近'];
  if(match.conflicts.length)reasons.push('有明確差異，僅供參考，不直接套價');else if(match.missing.length)reasons.push('缺少條件，尚不能確認套價');else reasons.push('規格初步相符，仍需核對計價條件');
  return{itemCode:item.itemCode,score:Math.round(score*100)/100,match,remembered,level,reasons};
 }).filter(x=>x&&x.score>5).sort((a,b)=>b.score-a.score||a.itemCode.localeCompare(b.itemCode)).slice(0,5);
}
export function quotationRows(model,workbook){
 if(!model?.structured)return[];const out=[];
 for(const sheet of customerSheets(model)){
  const schema=workbook.inferTableSchema(model,sheet.name,'customer');
  if(['itemName','unit','qty'].some(k=>schema.columns[k]==null))continue;
  if(Object.values(schema.columns).some(c=>sheet.hiddenCols.has(c)))continue;
  for(const row of workbook.classifyRows(model,sheet.name,'customer')){
   if(!['QUOTE_ITEM','UNPRICED_ITEM','BUNDLED_ITEM'].includes(row.type))continue;
   const safe={};for(const key of ['row','itemNo','itemName','unit','qty','unitPrice','amount','note','section','area','type'])safe[key]=row[key]??'';
   safe.contextNotes=row.contextNotes||[];safe.note=[safe.note,...safe.contextNotes.map(n=>`[${n.sheet}!${n.address}] ${n.text}`)].filter(Boolean).join('；').slice(0,2800);
   const sourceCells={};for(const[key,col]of Object.entries(schema.columns)){
    const address=workbook.columnAddress(model,col,row.row),cell=workbook.getCell(model,sheet.name,address);
    sourceCells[key]={address,value:cell?.value??'',formula:String(cell?.formula||'')};
   }
   // Use the real quantity rather than Excel's rounded display string. Keep raw
   // input cells in the binding so a visually identical edit still invalidates it.
   if(sourceCells.qty&&typeof sourceCells.qty.value==='number')safe.qty=String(sourceCells.qty.value);
   const ref=workbook.columnAddress(model,schema.columns.itemName,row.row);
   // A line with unresolved/shared values is a candidate only. It never supplies a cost by itself.
   out.push({...safe,sourceCells,id:JSON.stringify([sheet.name,row.row]),sheet:sheet.name,address:ref});
  }
 }
 return out;
}
export function validateItem(raw){
 const x=copy(raw);if(!/^[A-Z0-9][A-Z0-9_-]{0,47}$/.test(x.itemCode)||typeof x.itemName!=='string'||!x.itemName.trim()||typeof x.unit!=='string'||!x.unit.trim()||typeof x.currency!=='string'||!x.currency.trim())throw Error('成本項目識別資料不完整');
 if(typeof x.unitCost!=='number'||!Number.isFinite(x.unitCost)||x.unitCost<0||x.unitCost>1e9||typeof x.baseQty!=='number'||!Number.isFinite(x.baseQty)||x.baseQty<=0||x.baseQty>1e9)throw Error('成本金額或基準數量無效，沒有以 0 代替');
 for(const n of Object.values(x.dimensions||{}))if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<=0))throw Error('標準尺寸格式無效');
 return x;
}
export async function pinCostSnapshot(client,{environment,signal,check=()=>{}}){
 check();const start=await client.current({signal});check();const version=start.version;
 if(start.environment!==environment||version?.status!=='published'||!version.current||!version.label||!version.publishedAt||!Number.isInteger(version.itemCount)||version.itemCount<1||version.itemCount>10000)throw Error('Current 成本版本資訊不完整，無法固定快照');
 const items=[];let offset=0;
 while(offset<version.itemCount){const page=await client.list({offset,limit:100,signal});check();if(page.environment!==environment||page.versionLabel!==version.label||page.total!==version.itemCount||page.offset!==offset||!Array.isArray(page.items)||!page.items.length||page.items.length>100)throw Error('讀取期間成本版本或分頁變更，已停止，沒有混用價格');items.push(...page.items.map(validateItem));offset+=page.items.length;}
 const end=await client.current({signal});check();if(canonical(start.version)!==canonical(end.version)||end.environment!==environment||items.length!==version.itemCount||new Set(items.map(x=>x.itemCode)).size!==items.length)throw Error('成本版本或項目數在讀取時變更，請重新讀取');
 items.sort((a,b)=>a.itemCode.localeCompare(b.itemCode));
 // The legacy gateway does not expose the UUID. The database uniquely constrains
 // (environment, version_label); retain that real composite key, never invent a UUID.
 const identity={environment,label:version.label,publishedAt:version.publishedAt};
 const content={identity,version:copy(version),items};const hash=await digest(content);check();
 return {...content,hash,identityType:'environment+unique-version-label',databaseVersionId:typeof version.id==='string'?version.id:null,capturedAt:new Date().toISOString()};
}
export function computeCost(qty,unitCost,baseQty,rounding='exact'){
 const q=decimal(qty),b=decimal(baseQty),c=decimal(unitCost);if(q==null||q<=0||!b||c==null)throw Error('計價數量或價格無效');
 if(!['exact','0','2'].includes(rounding))throw Error('尚未選擇成本小數處理方式');
 const scale=1000000n,toInt=n=>BigInt(Math.round(n*1e6));
 const numerator=toInt(q)*toInt(c),denominator=toInt(b)*scale;
 let value;
 if(rounding==='exact'){
  const precision=1000000n;if(numerator*precision%denominator!==0n)throw Error('算式超過 6 位小數，請明確選擇本案進位規則');
  value=Number(numerator*precision/denominator)/1e6;
 }else{const factor=rounding==='0'?1n:100n;value=Number((numerator*factor*2n+denominator)/(denominator*2n))/Number(factor);}
 if(!Number.isFinite(value)||value>1e9)throw Error('單列成本超出本版精確計算範圍（10 億），請拆分核對');return value;
}
export function sumCosts(values){
 let micros=0n;for(const value of values){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9)throw Error('部分小計包含無效成本');micros+=BigInt(Math.round(value*1e6));}
 const fraction=(micros%1000000n).toString().padStart(6,'0').replace(/0+$/,'');return(micros/1000000n).toString()+(fraction?'.'+fraction:'');
}
