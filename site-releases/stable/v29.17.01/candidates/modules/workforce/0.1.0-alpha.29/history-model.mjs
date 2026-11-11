import {csvCell} from './model.mjs';
export function validateHistory(report,rows){
 if(report?.basis!=='historical-source-cells'||report.policy!=='separate-source-datasets-no-addition'||!report.source?.sourceHash)throw Error('歷史報表依據不符');
 const seen=new Set();let total=0,numeric=0;
 for(const r of rows){const k=JSON.stringify([r.sheet,r.cell]);if(seen.has(k)||r.source_hash!==report.source.sourceHash)throw Error('歷史明細來源重複或混用');seen.add(k);if(r.minutes!==null){if(!Number.isSafeInteger(r.minutes)||r.minutes<0)throw Error('歷史工時數字無效');total+=r.minutes;numeric++;}}
 if(rows.length!==report.summary.cells||numeric!==report.summary.numericCells||(numeric?total:null)!==report.summary.minutes)throw Error('明細與歷史報表合計不一致，已停止匯出');
 return true;
}
export function historySheets(r,rows){validateHistory(r,rows);const label={design:'設計',construction:'工程',internal:'內部事務'};
 return [['來源與範圍',[['項目','內容'],['來源檔',r.source.filename],['來源指紋',r.source.sourceHash],['來源期間',r.source.period],['查詢條件',JSON.stringify(r.filters)],['資料基礎',r.basis],['說明',r.notice],['來源數值合計小時',r.summary.minutes===null?'來源空白':r.summary.minutes/60],['原表空白格',r.summary.blankCells],...(r.source.notes||[]).map(n=>['備註',n])]],
 ['專案彙總',[['專案代碼','專案名稱','小時','原表空白格'],...r.projects.map(p=>[p.projectCode,p.projectName,p.minutes===null?'來源空白':p.minutes/60,p.blankCells])]],
 ['歷史人員',[['來源人員代碼','來源姓名','小時','原表空白格'],...r.people.map(p=>[p.employeeCode,p.employeeName,p.minutes===null?'來源空白':p.minutes/60,p.blankCells])]],
 ['來源儲存格',[['工作表','儲存格','人員代碼','姓名','專案代碼','專案','業務','來源期間','週範圍','工作類型','工作說明','小時','原公式文字'],...rows.map(x=>[x.sheet,x.cell,x.employee_code,x.employee_name,x.project_code,x.project_name,label[x.business],x.period,x.details.sourceWeek||'',x.details.workType||'',x.details.description||'',x.minutes===null?'來源空白':x.minutes/60,x.details.sourceFormula||''])]],
 ['來源差異',[['個案','年度表小時','個案表小時','個案減年度小時','狀態','說明'],...r.differences.map(d=>[d.evidence.project,d.evidence.annualMinutes/60,d.evidence.projectMinutes/60,d.evidence.differenceMinutes/60,'待核對',d.evidence.note])]]];
}
export function historyCSV(report,rows){return '\uFEFF'+historySheets(report,rows).flatMap(([name,data])=>[[name],...data,[]]).map(r=>r.map(csvCell).join(',')).join('\r\n');}
