export const QUOTATION_ENGINE_VERSION = '0.6.1';
export const QUOTATION_STAGE = 'ai-workbook-editing';

function inferDocumentKind(name=''){const value=String(name||'').toLowerCase();return /成本|工料|cost|price[-_ ]?list|material/.test(value)?'cost_master_candidate':'quotation_candidate';}
function stableHash(input=''){let hash=2166136261;for(const ch of String(input||'')){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(36).padStart(7,'0');}
function createSourceFileId(fileMeta={}){return `quote-source-${stableHash([fileMeta.name,Number(fileMeta.size||0),Number(fileMeta.lastModified||0),fileMeta.type,fileMeta.extension].join('|'))}`;}
function stripQuote(v=''){return String(v||'').trim().replace(/^[「『\"']+|[」』\"']+$/g,'').replace(/[。！!；;]+$/,'').trim();}
function numeric(v){const n=Number(String(v||'').replace(/,/g,''));return Number.isFinite(n)?n:null;}
function suggestionId(){return `qa-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;}

export function createQuotationEngine(){
  return Object.freeze({
    version:QUOTATION_ENGINE_VERSION,stage:QUOTATION_STAGE,
    schemas:Object.freeze({costMaster:'draft-policy-ready',quotationProject:'multi-draft-foundation',quoteItem:'workbook-grid-v1',costComponent:'planned',workbookAction:'quote-action-v1'}),
    capabilities:Object.freeze({parseQuotation:true,matchCost:true,calculate:false,mutateWorkbook:true,exportWorkbook:true,draftEnvelope:true,draftRegistry:true,draftReopen:true,inspectorSync:true,readCostMaster:true,costGatewayReadOnly:true,dragDropIntake:true,manualCellEdit:true,aiCellSuggestions:true,chatWorkbookCommands:true,acceptRejectDiff:true,compareView:true}),
    createDraftEnvelope(fileMeta={},accessRole='member'){
      const kind=inferDocumentKind(fileMeta.name);const createdAt=new Date().toISOString();const sourceFileId=createSourceFileId(fileMeta);return{id:`quote-draft-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,draftId:null,sourceFileId,quotationProjectId:null,kind,status:'draft',pendingChangeCount:0,createdAt,updatedAt:createdAt,file:{...fileMeta},sourceImmutable:true,costMasterPolicy:{compareDraftOnly:kind==='cost_master_candidate',canPublishCostMaster:['admin','owner'].includes(accessRole),publishCreatesNewVersion:true,overwritePreviousVersion:false},quotationPolicy:{workingCopyOnly:kind==='quotation_candidate',exportCreatesNewFile:true,overwriteOriginalFile:false}};
    },
    normalizeDraftEnvelope(draft={}){if(!draft||typeof draft!=='object')return null;if(!draft.draftId)draft.draftId=String(draft.id||'');if(!draft.id)draft.id=String(draft.draftId||'');return draft;},
    createSuggestion({sheet,address,oldValue,newValue,reason='',source='ai',kind='cell-update',row=null,payload=null}={}){return{id:suggestionId(),sheet:String(sheet||''),address:String(address||'').toUpperCase(),oldValue,newValue,status:'pending',reason:String(reason||''),source,kind,row:Number.isInteger(row)?row:null,payload:payload&&typeof payload==='object'?payload:null,createdAt:new Date().toISOString()};},
    parseChatEditCommand(text,model,workbook){
      if(!model?.structured||!workbook)return null;const raw=String(text||'').trim();if(!raw)return null;const sheet=workbook.getSheet(model,model.activeSheet);if(!sheet)return null;const schema=workbook.inferTableSchema(model,sheet.name);const suggestions=[];
      const add=(row,col,newValue,reason)=>{if(row<0||col==null)return;const address=workbook.columnAddress(model,col,row);const oldValue=workbook.getCell(model,sheet.name,address)?.value??'';suggestions.push(this.createSuggestion({sheet:sheet.name,address,oldValue,newValue,reason,source:'chat'}));};
      let m=raw.match(/第\s*(\d+)\s*(?:項|列|行).*?(?:名稱|項目(?:名稱)?|工程項目)\s*(?:改成|改為|改|變成|設為)\s*(.+)$/i);if(m){const row=workbook.findItemRow(model,sheet.name,m[1]);add(row,schema.columns.itemName,stripQuote(m[2]),`聊天指令：第 ${m[1]} 項名稱`);}
      m=raw.match(/第\s*(\d+)\s*(?:項|列|行).*?(?:單價|價格|售價)\s*(?:改成|改為|改|變成|設為)\s*\$?\s*([\d,.]+)/i);if(m){const row=workbook.findItemRow(model,sheet.name,m[1]);add(row,schema.columns.unitPrice,numeric(m[2]),`聊天指令：第 ${m[1]} 項單價`);}
      m=raw.match(/第\s*(\d+)\s*(?:項|列|行).*?(?:數量|qty)\s*(?:改成|改為|改|變成|設為)\s*([\d,.]+)/i);if(m){const row=workbook.findItemRow(model,sheet.name,m[1]);add(row,schema.columns.qty,numeric(m[2]),`聊天指令：第 ${m[1]} 項數量`);}
      m=raw.match(/管理費.*?(?:改成|改為|設為|調整為|改)\s*([\d.]+)\s*%/i);if(m){const pct=numeric(m[1]);for(let r=schema.headerRow+1;r<=sheet.range.e.r;r++){const nameCol=schema.columns.itemName??sheet.range.s.c;const addr=workbook.columnAddress(model,nameCol,r);const name=String(workbook.getCell(model,sheet.name,addr)?.display||workbook.getCell(model,sheet.name,addr)?.value||'');if(name.includes('管理費')){const targetCol=schema.columns.unitPrice??schema.columns.amount??nameCol+1;add(r,targetCol,pct/100,`聊天指令：管理費 ${pct}%`);break;}}}
      m=raw.match(/(?:把|將)\s*([A-Z]+\d+)\s*(?:改成|改為|設為|改)\s*(.+)$/i);if(m){const address=m[1].toUpperCase();const oldValue=workbook.getCell(model,sheet.name,address)?.value??'';let value=stripQuote(m[2]);const maybe=numeric(value);if(maybe!==null&&/^[$\d,\.\s]+$/.test(String(m[2])))value=maybe;suggestions.push(this.createSuggestion({sheet:sheet.name,address,oldValue,newValue:value,reason:`聊天指令：${address}`,source:'chat'}));}
      m=raw.match(/(?:新增|增加)(?:一)?(?:列|行|項)(?:[:：]?\s*)(.+)$/i);if(m){const name=stripQuote(m[1]).replace(/[。！!]+$/,'').trim();if(name){const row=sheet.range.e.r+1;const payload={};if(schema.columns.itemName!=null)payload[schema.columns.itemName]=name;if(schema.columns.itemNo!=null)payload[schema.columns.itemNo]=row-schema.headerRow;suggestions.push(this.createSuggestion({sheet:sheet.name,address:`ROW:${row+1}`,oldValue:'',newValue:name,reason:`聊天指令：新增「${name}」`,source:'chat',kind:'append-row',row,payload}));}}
      if(!suggestions.length)return null;return{handled:true,suggestions,message:`已在「${sheet.name}」建立 ${suggestions.length} 筆待確認修改。請在報價工作台逐格按「採用／略過」，或使用「全部採用」。`};
    },
    health(){return{ok:true,version:QUOTATION_ENGINE_VERSION,stage:QUOTATION_STAGE};}
  });
}
