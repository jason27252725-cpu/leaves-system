import {el,field,button,busy,errorText} from './shared/dom.mjs';
export function mountReportQuestion(root,api,query,check){
 const historical=query.kind==='history';const input=field('詢問這個報表','text',historical?'請摘要此份歷史來源的工時與來源差異，不與其他來源相加。':'請摘要已核定工時，並指出哪些月份尚未計入。',{maxLength:2000}),status=el('p',{class:'li-status','aria-live':'polite'}),answer=el('pre',{style:'white-space:pre-wrap;font:inherit'});let controller=null;
 const ask=button('請 AI 說明報表',()=>busy(ask,status,async()=>{if(!input.input.value.trim())throw Error('請輸入問題');controller=new AbortController();cancel.hidden=false;try{const r=await api.chat(input.input.value+'\n請一律以小時及小數呈現工時，不列出其他時間單位。',{report:query,signal:controller.signal});check();answer.textContent=r.text;status.textContent=historical?'AI 說明僅供參考；以此份來源明細與匯出數字為準。':'AI 說明僅供參考；核定明細與匯出數字為準。';}catch(e){throw Object.assign(e,{message:errorText(e)});}finally{controller=null;cancel.hidden=true;}}));
 const cancel=button('停止回答',()=>controller?.abort());cancel.hidden=true;
 root.append(el('section',{class:'li-card'},el('h3',{},'報表說明'),el('p',{class:'li-note'},historical?'AI 只讀取你選定的同一份歷史來源與查詢條件；空白不當零，不合併其他來源。':'AI 會重新讀取你有權限的同一範圍核定資料，不會修改工時。'),input.node,ask,cancel,status,answer));
}
