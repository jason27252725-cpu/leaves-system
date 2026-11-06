// Preserve source XML bytes outside requested edits, including namespace prefixes.
const sheetNS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export function spreadsheetXml(source){
 const prefixes=[...source.matchAll(/xmlns:([\w.-]+)=["']([^"']+)["']/g)].filter(m=>m[2]===sheetNS).map(m=>m[1]);
 if(!prefixes.length)return{xml:source,restore:s=>s};
 if(prefixes.length!==1)throw Error('EXPORT_AMBIGUOUS_SPREADSHEET_NAMESPACE');
 const prefix=prefixes[0],escaped=prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),names=new Set(['c','f','v','is','t','calcPr']);
 if(!new RegExp('</?'+escaped+':').test(source))return{xml:source,restore:s=>s};
 const xml=source.replace(new RegExp('<(/?)'+escaped+':([\\w.-]+)(?=[\\s/>])','g'),(_,close,name)=>{names.add(name);return '<'+close+name;});
 // An unprefixed element with these names would make the normalization ambiguous.
 if([...source.matchAll(/<\/?([\w.-]+)(?=[\s/>])/g)].some(m=>names.has(m[1])))throw Error('EXPORT_AMBIGUOUS_SPREADSHEET_NAMESPACE');
 return{xml,restore:s=>s.replace(/<(\/?)([\w.-]+)(?=[\s/>])/g,(all,close,name)=>names.has(name)?'<'+close+prefix+':'+name:all)};
}
const decode=s=>s.replace(/&#x([\da-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(m,h,d,n)=>h?String.fromCodePoint(parseInt(h,16)):d?String.fromCodePoint(Number(d)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[n]);
const attributes=s=>Object.fromEntries([...s.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g)].map(m=>[m[1],decode(m[3])]));
export function workbookSheetPaths(workbookXml,relsXml){
 const root=attributes(workbookXml.match(/<(?:[\w.-]+:)?workbook\b([^>]*)>/)?.[1]||''),rp=Object.entries(root).filter(([k,v])=>k.startsWith('xmlns:')&&v==='http://schemas.openxmlformats.org/officeDocument/2006/relationships').map(([k])=>k.slice(6));
 const rels=new Map();for(const m of relsXml.matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*)\/?\s*>/g)){const a=attributes(m[1]);if(a.TargetMode!=='External'&&a.Id&&a.Target)rels.set(a.Id,a.Target);}
 const out=new Map();for(const m of workbookXml.matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*)\/?\s*>/g)){
  const a=attributes(m[1]),id=rp.map(p=>a[p+':id']).find(Boolean)||a['r:id'];if(!a.name||!id||!rels.has(id))continue;
  const t=rels.get(id);if(/^[a-z]+:|[?#\\]/i.test(t))throw Error('EXPORT_INVALID_WORKSHEET_PATH');
  const parts=(t.startsWith('/')?t.slice(1):'xl/'+t).split('/'),normal=[];for(const part of parts){if(part==='..'){if(!normal.length)throw Error('EXPORT_INVALID_WORKSHEET_PATH');normal.pop();}else if(part&&part!=='.')normal.push(part);}out.set(a.name,normal.join('/'));
 }
 return out;
}
