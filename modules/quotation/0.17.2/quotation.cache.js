// Cache updates preserve the original <f> node, styles and all other cell XML.
export function patchFormulaCacheXml(xml,address,cell){
 const re=new RegExp('<c\\b([^>]*\\br="'+address+'"[^>]*)>([\\s\\S]*?)<\\/c>'),match=re.exec(xml);
 if(!match||!/<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>)/.test(match[2])||!cell.formula||typeof cell.value!=='number'||!Number.isFinite(cell.value))throw Error('FORMULA_CACHE_EXPORT_TARGET_INVALID:'+address);
 let inner=match[2],next='<v>'+String(cell.value)+'</v>';
 inner=/<v\b[^>]*>[\s\S]*?<\/v>/.test(inner)?inner.replace(/<v\b[^>]*>[\s\S]*?<\/v>/,next):/<v\b[^>]*\/>/.test(inner)?inner.replace(/<v\b[^>]*\/>/,next):inner+next;
 const attrs=match[1].replace(/\s+t="[^"]*"/g,'');
 const updated='<c'+attrs+'>'+inner+'</c>';
 return xml.slice(0,match.index)+updated+xml.slice(match.index+match[0].length);
}
