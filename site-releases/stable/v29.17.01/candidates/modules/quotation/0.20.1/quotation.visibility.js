// One outbound-data policy shared by chat, audit and assistant edits.
export function hiddenSheet(model,sheet){const meta=model?.workbook?.Workbook?.Sheets||[];return !!(meta.find(x=>x.name===sheet.name)?.Hidden||(!meta.some(x=>x.name)&&meta[sheet.index]?.Hidden));}
export const internalSheet=sheet=>/(成本|內部|廠商|毛利|利潤|cost|vendor|profit|margin)/i.test(sheet.displayName||sheet.name||'');
export function customerSheets(model){return(model?.sheets||[]).filter(s=>!hiddenSheet(model,s)&&!internalSheet(s));}
export function contextSheets(model,{accessRole='member',query=''}={}){const allowInternal=['owner','admin'].includes(accessRole)&&/(內部|廠商|成本|實際數量|追加減|毛利|利潤)/.test(query);return(model?.sheets||[]).filter(s=>!hiddenSheet(model,s)&&(!internalSheet(s)||allowInternal));}
export function visibleContextModel(model,options={}){
 const sheets=contextSheets(model,options).map(s=>['owner','admin'].includes(options.accessRole)?s:{...s,hiddenRows:new Set([...s.hiddenRows,...(s.revealedRows||[])])}),names=new Set(sheets.map(s=>s.name)),activeSheet=names.has(model.activeSheet)?model.activeSheet:sheets[0]?.name||'';
 return{...model,sheets,activeSheet,sheetNames:sheets.map(s=>s.name),audit:null};
}
