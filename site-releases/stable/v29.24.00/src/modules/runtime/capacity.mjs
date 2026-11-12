import {el,button,table,dialog,busy,hours} from '../shared/dom.mjs';
const mb=n=>(n/1000000).toFixed(1)+' MB';
const labels={expiredRequestReceipts:'過期請求收據',expiredUncommittedPreviews:'過期未提交預覽',expiredLoginLimitBuckets:'過期限流紀錄',coreRecordsDeleted:'業務紀錄刪除筆數'};
export async function mountCapacity(root,api,check=()=>{}){
 const status=el('p',{class:'li-status'}),body=el('section');root.replaceChildren(el('h2',{},'容量與維護'),el('div',{class:'li-toolbar'},button('重新量測',()=>busy(document.activeElement,status,load)),button('清理安全暫存',()=>clean())),status,body);
 async function load(){const r=await api.read('capacity',{action:'inspect'});check();const ratio=r.databaseBytes/r.quotaBytes;
  const meter=el('progress',{max:100,value:Math.min(100,ratio*100),'aria-label':'資料庫參考使用率'});
  body.replaceChildren(el('div',{class:'li-capacity-main'},el('strong',{},mb(r.databaseBytes)+' / '+mb(r.quotaBytes)+' · '+(ratio*100).toFixed(1)+'%'),meter,el('p',{},'參考剩餘 '+mb(Math.max(0,r.quotaBytes-r.databaseBytes)))),el('p',{class:'li-note'},r.quotaBasis+'。測量含專案資料庫及系統資料庫，不含 WAL、附件或流量。附件容量尚未取得。'),el('p',{class:'li-note'},'量測時間 '+new Date(r.measuredAt).toLocaleString('zh-TW')),
  el('h3',{},'主要資料占用'),table(['資料項目','占用容量'],r.tables.map(t=>[t.name,mb(t.bytes)])),el('h3',{},'近期容量'),table(['日期','容量','工作筆數'],r.samples.map(s=>[s.sample_day,mb(s.database_bytes),s.work_rows])),el('h3',{},'可清理項目'),table(['項目','符合時間條件筆數'],[['未提交過期預覽',r.cleanupPreview.expiredPreviews],['過期限流紀錄',r.cleanupPreview.expiredLoginLimits]]),el('h3',{},'最近維護'),table(['時間','處理結果'],r.runs.map(run=>[new Date(run.created_at).toLocaleString('zh-TW'),Object.entries(run.result).map(([k,v])=>(labels[k]||k)+' '+v).join(' · ')])));
  status.textContent='已量測。實際帳務額度請以雲端方案頁為準。';
 }
 async function clean(){const d=dialog('清理技術暫存',{modal:false,width:560,height:330});d.content.append(el('p',{},'清理依既有到期與引用規則執行，保留工作、請假、月結、人員及稽核歷史。'),button('確認清理',()=>busy(document.activeElement,d.status,async()=>{check();await api.progress('storage.cleanup',{confirm:'CLEAN_TRANSIENT_ONLY'},true);check();d.close();await load();}),'li-primary'));}
 await load();
}
