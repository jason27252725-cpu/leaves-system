export const WORKBOOK_BRIDGE_VERSION = '0.6.0';
const ALLOWED_EXTENSIONS = new Set(['xlsx', 'xlsm', 'pdf']);
const SHEETJS_ESM_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
const MAX_MODEL_ROWS = 5000;
const MAX_MODEL_COLS = 120;
let sheetJsPromise = null;

function getExtension(name = '') {
  const value = String(name || '');
  return value.includes('.') ? value.split('.').pop().toLowerCase() : '';
}
function cellAddress(XLSX, row, col) { return XLSX.utils.encode_cell({r:row,c:col}); }
function inferType(value) {
  if (value == null || value === '') return 'z';
  if (typeof value === 'number') return 'n';
  if (typeof value === 'boolean') return 'b';
  if (value instanceof Date) return 'd';
  return 's';
}
async function loadSheetJs() {
  if (globalThis.XLSX?.read) return globalThis.XLSX;
  if (!sheetJsPromise) sheetJsPromise = import(SHEETJS_ESM_URL).then(mod => mod?.default?.read ? mod.default : mod);
  const XLSX = await sheetJsPromise;
  if (!XLSX?.read || !XLSX?.utils) throw new Error('SHEETJS_LOAD_FAILED');
  return XLSX;
}
function safeRange(XLSX, ws) {
  const raw = ws?.['!ref'] || 'A1:A1';
  let range;
  try { range = XLSX.utils.decode_range(raw); } catch (_) { range = {s:{r:0,c:0},e:{r:0,c:0}}; }
  range.e.r = Math.min(range.e.r, range.s.r + MAX_MODEL_ROWS - 1);
  range.e.c = Math.min(range.e.c, range.s.c + MAX_MODEL_COLS - 1);
  return range;
}
function cloneValue(value) { return value instanceof Date ? new Date(value.getTime()) : value; }
function simpleCellAddress(row,col){let n=col+1,s='';while(n){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return `${s}${row+1}`;}
function buildSheetModel(XLSX, ws, name) {
  const range = safeRange(XLSX, ws);
  const cells = new Map();
  for (const address of Object.keys(ws || {})) {
    if (address.startsWith('!')) continue;
    let pos; try { pos = XLSX.utils.decode_cell(address); } catch (_) { continue; }
    if (pos.r < range.s.r || pos.r > range.e.r || pos.c < range.s.c || pos.c > range.e.c) continue;
    const cell = ws[address];
    cells.set(address, { address, row:pos.r, col:pos.c, value:cloneValue(cell?.v ?? ''), display:cell ? XLSX.utils.format_cell(cell) : '', formula:String(cell?.f||''), type:String(cell?.t||inferType(cell?.v)) });
  }
  const originalRange = ws?.['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : range;
  return { name, range, cells, truncatedRows:originalRange.e.r > range.e.r, truncatedCols:originalRange.e.c > range.e.c };
}
function inferSchemaFromSheet(sheet) {
  if (!sheet) return {headerRow:0,columns:{}};
  const keywords = {
    itemNo:['項次','編號','no','序號'], itemName:['工程項目','項目名稱','項目','品名','名稱'], unit:['單位'], qty:['數量','qty'], unitPrice:['單價','售價','價格'], amount:['複價','合價','金額','小計'], note:['備註','說明']
  };
  let best={row:sheet.range.s.r,score:-1,columns:{}};
  const maxRow=Math.min(sheet.range.e.r,sheet.range.s.r+25);
  for(let r=sheet.range.s.r;r<=maxRow;r++){
    let score=0; const columns={};
    for(let c=sheet.range.s.c;c<=sheet.range.e.c;c++){
      const cell=sheet.cells.get(simpleCellAddress(r,c));
      const txt=String(cell?.display||cell?.value||'').trim().toLowerCase(); if(!txt) continue;
      for(const [key,list] of Object.entries(keywords)) if(list.some(k=>txt.includes(k.toLowerCase()))){ if(columns[key]==null) columns[key]=c; score++; }
    }
    if(score>best.score) best={row:r,score,columns};
  }
  return {headerRow:best.row,columns:best.columns,confidence:best.score};
}

export function createWorkbookBridge() {
  return Object.freeze({
    version: WORKBOOK_BRIDGE_VERSION,
    stage: 'ai-workbook-editing',
    allowedExtensions: [...ALLOWED_EXTENSIONS],
    inspectFile(file) {
      if (!file) return { ok: false, reason: 'NO_FILE' };
      const name = String(file.name || ''); const extension = getExtension(name);
      return { ok: ALLOWED_EXTENSIONS.has(extension), name, extension, size:Number(file.size||0), type:String(file.type||''), lastModified:Number(file.lastModified||0), reason:ALLOWED_EXTENSIONS.has(extension)?'':'UNSUPPORTED_EXTENSION' };
    },
    createWorkingCopyDescriptor(fileMeta = {}) {
      const name = String(fileMeta.name || 'quotation.xlsx'); const ext = getExtension(name) || 'xlsx'; const stem = name.replace(/\.[^.]+$/, '') || 'quotation';
      return { sourceImmutable:true, sourceName:name, workingCopy:`${stem}-LEAVES-AI-DRAFT.${ext}`, futureOfficialExport:`${stem}-LEAVES-AI-REVISION.${ext}`, overwriteOriginalFile:false, mutationEnabled:['xlsx','xlsm'].includes(ext), exportEnabled:['xlsx','xlsm'].includes(ext) };
    },
    async parseFile(file) {
      const meta=this.inspectFile(file); if(!meta.ok) throw new Error(meta.reason||'UNSUPPORTED_EXTENSION');
      if(meta.extension==='pdf') return {ok:true,structured:false,kind:'pdf',meta,sheets:[],sheetNames:[],activeSheet:'',sourceFile:file,warning:'PDF 目前以安全文件模式掛載；表格化編輯以 XLSX/XLSM 為主。'};
      const XLSX=await loadSheetJs(); const buffer=await file.arrayBuffer();
      const wb=XLSX.read(buffer,{type:'array',cellFormula:true,cellStyles:true,cellDates:true,bookVBA:meta.extension==='xlsm'});
      const sheetNames=[...(wb.SheetNames||[])];
      const sheets=sheetNames.map(name=>buildSheetModel(XLSX,wb.Sheets[name],name));
      if(!wb.Workbook) wb.Workbook={}; if(!wb.Workbook.CalcPr) wb.Workbook.CalcPr={}; wb.Workbook.CalcPr.fullCalcOnLoad=true; wb.Workbook.CalcPr.forceFullCalc=true;
      const original=new Map(); sheets.forEach(sh=>sh.cells.forEach((cell,addr)=>original.set(`${sh.name}!${addr}`,{...cell,value:cloneValue(cell.value)})));
      return {ok:true,structured:true,kind:'excel',meta,sourceFile:file,buffer,workbook:wb,XLSX,sheets,sheetNames,activeSheet:sheetNames[0]||'',original,dirty:false,editCount:0,createdAt:new Date().toISOString()};
    },
    getSheet(model,name='') { return model?.sheets?.find(s=>s.name===(name||model.activeSheet)) || model?.sheets?.[0] || null; },
    getCell(model,sheetName,address) { return this.getSheet(model,sheetName)?.cells?.get(String(address||'').toUpperCase()) || null; },
    setCell(model,sheetName,address,value,{formula=null}={}) {
      if(!model?.structured) throw new Error('WORKBOOK_NOT_STRUCTURED'); const XLSX=model.XLSX; const sh=this.getSheet(model,sheetName); if(!sh) throw new Error('SHEET_NOT_FOUND');
      const addr=String(address||'').toUpperCase(); const ws=model.workbook.Sheets[sh.name]; const decoded=XLSX.utils.decode_cell(addr); const existing=ws[addr]||{};
      const next={...existing};
      if(formula!=null && String(formula).trim()){next.f=String(formula).replace(/^=/,''); if(next.v==null) next.v=0;} else {delete next.f; next.v=value; next.t=inferType(value); delete next.w;}
      ws[addr]=next; if(!ws['!ref']) ws['!ref']=addr; else {const range=XLSX.utils.decode_range(ws['!ref']); range.s.r=Math.min(range.s.r,decoded.r);range.s.c=Math.min(range.s.c,decoded.c);range.e.r=Math.max(range.e.r,decoded.r);range.e.c=Math.max(range.e.c,decoded.c);ws['!ref']=XLSX.utils.encode_range(range);}
      const cell={address:addr,row:decoded.r,col:decoded.c,value:cloneValue(next.v??''),display:next.f?`=${next.f}`:(next.v==null?'':String(next.v)),formula:String(next.f||''),type:String(next.t||inferType(next.v))}; sh.cells.set(addr,cell); sh.range.s.r=Math.min(sh.range.s.r,decoded.r);sh.range.s.c=Math.min(sh.range.s.c,decoded.c);sh.range.e.r=Math.max(sh.range.e.r,decoded.r);sh.range.e.c=Math.max(sh.range.e.c,decoded.c); model.dirty=true;model.editCount=Number(model.editCount||0)+1; return cell;
    },
    originalCell(model,sheetName,address){return model?.original?.get(`${sheetName}!${String(address||'').toUpperCase()}`)||null;},
    inferTableSchema(model,sheetName=''){return inferSchemaFromSheet(this.getSheet(model,sheetName));},
    findItemRow(model,sheetName,itemNumber){const sh=this.getSheet(model,sheetName); if(!sh)return -1; const schema=inferSchemaFromSheet(sh); const col=schema.columns.itemNo ?? sh.range.s.c; for(let r=schema.headerRow+1;r<=sh.range.e.r;r++){const addr=cellAddress(model.XLSX,r,col);const v=sh.cells.get(addr)?.value;if(String(v).trim()===String(itemNumber).trim())return r;} const fallback=schema.headerRow+Number(itemNumber); return fallback<=sh.range.e.r?fallback:-1;},
    columnAddress(model,col,row){return cellAddress(model.XLSX,row,col);},
    appendRow(model,sheetName='',values={}){
      if(!model?.structured) throw new Error('WORKBOOK_NOT_STRUCTURED');
      const sh=this.getSheet(model,sheetName); if(!sh) throw new Error('SHEET_NOT_FOUND');
      const XLSX=model.XLSX, ws=model.workbook.Sheets[sh.name]; const row=sh.range.e.r+1;
      const entries=Array.isArray(values)?values.map((value,index)=>[sh.range.s.c+index,value]):Object.entries(values||{}).map(([col,value])=>[Number(col),value]);
      for(const [col,value] of entries){if(!Number.isInteger(col)||col<0)continue;const addr=cellAddress(XLSX,row,col);const existing=ws[addr]||{};ws[addr]={...existing,v:value,t:inferType(value)};delete ws[addr].f;delete ws[addr].w;}
      const ref=ws['!ref']?XLSX.utils.decode_range(ws['!ref']):{s:{r:row,c:sh.range.s.c},e:{r:row,c:sh.range.s.c}};ref.e.r=Math.max(ref.e.r,row);for(const [col] of entries){if(Number.isInteger(col)){ref.s.c=Math.min(ref.s.c,col);ref.e.c=Math.max(ref.e.c,col);}}ws['!ref']=XLSX.utils.encode_range(ref);
      const rebuilt=buildSheetModel(XLSX,ws,sh.name);const idx=model.sheets.findIndex(x=>x.name===sh.name);if(idx>=0)model.sheets[idx]=rebuilt;model.dirty=true;model.editCount=Number(model.editCount||0)+Math.max(1,entries.length);return{row,sheet:rebuilt};
    },
    async exportWorkingCopy(model,fileName='') {
      if(!model?.structured) throw new Error('WORKBOOK_NOT_STRUCTURED'); const XLSX=model.XLSX; const ext=model.meta?.extension==='xlsm'?'xlsm':'xlsx'; const name=fileName||String(model.meta?.name||`LEAVES-AI-DRAFT.${ext}`).replace(/\.[^.]+$/,`-LEAVES-AI-DRAFT.${ext}`);
      model.workbook.Workbook ||= {}; model.workbook.Workbook.CalcPr ||= {}; model.workbook.Workbook.CalcPr.fullCalcOnLoad=true; model.workbook.Workbook.CalcPr.forceFullCalc=true;
      XLSX.writeFile(model.workbook,name,{bookType:ext,bookVBA:ext==='xlsm',cellStyles:true,compression:true}); return {ok:true,fileName:name,formatFidelity:'best-effort-browser'};
    },
    health() { return { ok:true, version:WORKBOOK_BRIDGE_VERSION, stage:'ai-workbook-editing', sheetJs:'lazy-cdn', maxModelRows:MAX_MODEL_ROWS, maxModelCols:MAX_MODEL_COLS }; }
  });
}
