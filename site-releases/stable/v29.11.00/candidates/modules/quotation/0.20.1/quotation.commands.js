// A deliberately small grammar for unambiguous cell edits. Other phrasing stays with the AI.
export function parseExplicitCellCommand(raw,{targetsFor,readCell}){
 let text=String(raw||'').trim().replace(/^[@＠](?:助手|assistant)\s*[:：]?/i,'');
 if(/^(?:請)?(?:不要|別|不必)/.test(text)||/(?:如果|假如|例如|比方|怎麼|如何|教我)/.test(text))return null;
 text=text.replace(/^(?:(?:請你|請妳|請|麻煩|幫我|替我|協助|把|將|我想要|我要)\s*)+/,'');
 const m=text.match(/^((?:'(?:[^']|'')+'|[^\s!，,。；;「」【】（）()]+)!\s*\$?[A-Z]{1,3}\$?[1-9]\d{0,5}|\$?[A-Z]{1,3}\$?[1-9]\d{0,5})\s*(?:的(?:項次|數量|單價|備註|內容|值))?\s*(?:由\s*(.+?)\s*)?(?:改成|改為|改到|設成|設為|設定為|調整為|變成)\s*(.+)$/i);
 if(!m)return null;
 let valueText=m[3].trim();
 // Only strip complete, known preview-only suffixes. Never ignore an unknown second instruction.
 valueText=valueText.replace(/(?:[，,；;。]\s*(?:只改這一格|只修改這一格|先預覽|先讓我確認修改(?:前後)?差異|先讓我確認(?:修改)?差異|先給我看(?:修改)?差異|先不要套用|不要直接套用|確認後再改))+[。！!\s]*$/,'').replace(/[。！!]$/,'').trim();
 const quoted=valueText.match(/^(?:「([\s\S]*)」|『([\s\S]*)』|"([^"\n]*)"|'([^'\n]*)')$/);
 const numeric=/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
 let value;
 if(quoted)value=quoted.slice(1).find(x=>x!==undefined);
 else if(numeric.test(valueText))value=Number(valueText.replace(/,/g,''));
 else return{question:'請把要填入的文字加上「引號」，或提供一個明確數字；多個操作請分開提出。尚未建立修改。'};
 const targets=targetsFor(m[1]);if(targets.length!==1)throw Error('請指定唯一工作表與儲存格');
 const target=targets[0],cell=readCell(target);
 if(m[2]!==undefined){const old=m[2].trim().replace(/^[「『"']|[」』"']$/g,'');const expected=numeric.test(old)?Number(old.replace(/,/g,'')):old;if(!Object.is(cell.value,expected)&&String(cell.value)!==old)throw Error('目前值與指令中的原值不一致，請重新核對後預覽');}
 return{version:1,summary:`預覽 ${target.sheet}!${target.address} 的明確修改`,question:'',steps:[{tool:'quotation.cell',args:{...target,value}}]};
}
