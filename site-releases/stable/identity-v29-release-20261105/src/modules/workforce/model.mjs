// Integer storage is unchanged; the UI uses decimal hours throughout.
export function hoursToMinutes(value,{optional=false,max=24}={}){
 const raw=String(value??'').trim();if(optional&&raw==='')return null;
 if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw))throw Error('小時請填有效數字，例如 2.5、3.5。');
 const n=Number(raw),scaled=n*60,stored=Math.round(scaled);
 if(!Number.isFinite(n)||n<0||n>max||!Number.isSafeInteger(stored)||Math.abs(scaled-stored)>1e-8)throw Error('小時數值超出範圍或無法精確保存，請核對後再填寫。');
 return stored;
}
export const hoursInputValue=value=>value===null||value===undefined?'':value/60;
export function hourDraftValues(draft,timeIndices){
 if(!Array.isArray(draft?.values))throw Error('草稿格式無效');
 if(draft.timeUnit&&draft.timeUnit!=='hours')throw Error('草稿單位不符，原資料已保留。');
 return draft.values.map((v,i)=>draft.timeUnit==='hours'||!timeIndices.includes(i)||String(v).trim()===''?v:hoursInputValue(minutes(v,{max:44640})));
}
export function minutes(value,{optional=false,max=1440}={}){if(optional&&String(value).trim()==='')return null;const n=Number(value);if(String(value).trim()===''||!Number.isInteger(n)||n<0||n>max)throw Error('工時資料無效，請重新核對。');return n;}
export function periodStart(day,kind){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('請選擇日期');const d=new Date(day+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==day)throw Error('日期無效');if(kind==='month')d.setUTCDate(1);else if(kind==='week')d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));else throw Error('期間無效');return d.toISOString().slice(0,10);}
export function summarizeReport(report){if(report?.basis!=='current-confirmed-month-snapshots'||!Array.isArray(report.rows))throw Error('報表依據不符');const groups=new Map(),seen=new Set();let total=0;for(const r of report.rows){const e=r.entry,k=r.closureId+'|'+e.id;if(seen.has(k))throw Error('報表含重複資料，已停止匯出');seen.add(k);if(!Number.isSafeInteger(e.actual_minutes)||e.actual_minutes<0)throw Error('報表含未確認工時');total+=e.actual_minutes;const id=[r.employeeId,e.project_id,e.business].join('|');const g=groups.get(id)||{employeeId:r.employeeId,name:r.name,project:r.projectName||'內部事務',business:e.business,minutes:0};g.minutes+=e.actual_minutes;groups.set(id,g);}return {rows:[...groups.values()].map(r=>({...r,ratio:total?r.minutes/total:0})),total,excluded:report.excludedMonths||[]};}
export function csvCell(v){const s=String(v??'');return '"'+(/^[\s]*[=+@-]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';}
export function reportMatrix(report){
 summarizeReport(report);const employees=new Map(),groups=new Map(),months=new Map();
 for(const r of report.rows){const e=r.entry;employees.set(r.employeeId,{id:r.employeeId,name:r.name});
  const key=JSON.stringify([e.project_id,e.business]),g=groups.get(key)||{projectId:e.project_id,project:r.projectName||'內部事務',business:e.business,minutes:0,people:{}};
  g.minutes+=e.actual_minutes;g.people[r.employeeId]=(g.people[r.employeeId]??0)+e.actual_minutes;groups.set(key,g);
  const mk=JSON.stringify([e.work_date.slice(0,7),r.employeeId,e.project_id,e.business]),month=months.get(mk)||{month:e.work_date.slice(0,7),employeeId:r.employeeId,name:r.name,project:r.projectName||'內部事務',business:e.business,minutes:0};month.minutes+=e.actual_minutes;months.set(mk,month);
 }
 return {employees:[...employees.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-TW')||a.id.localeCompare(b.id)),groups:[...groups.values()].sort((a,b)=>a.project.localeCompare(b.project,'zh-TW')||a.business.localeCompare(b.business)),months:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)||a.name.localeCompare(b.name,'zh-TW'))};
}
export function reportCSV(report){const sum=summarizeReport(report);const rows=[['核定工時報表','僅含當前有效月結；不含未核定／撤回月份與歷史匯入'],['產生時間',report.generatedAt],['範圍',report.scope],['員工','專案','業務','實際小時','占本次總工時比例'],...sum.rows.map(r=>[r.name,r.project,r.business,r.minutes/60,(r.ratio*100).toFixed(2)+'%']),[],['排除月份（未計入）'],['員工ID','月份','狀態'],...sum.excluded.map(r=>[r.employeeId,r.month,r.status])];return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');}
