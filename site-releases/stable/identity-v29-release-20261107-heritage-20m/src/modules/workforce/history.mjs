import {el,button,select,table,busy,hours,errorText} from '../shared/dom.mjs';
import {historySheets,historyCSV} from './history-model.mjs';
import {workbook} from './xlsx.mjs';
import {mountReportQuestion} from './report-ai.mjs';
const kindLabel={annual:'年度來源',project:'跨年個案', 'person-monthly':'個人月度彙總','monthly-detail':'每週實際明細'};
function download(name,blob){const url=URL.createObjectURL(blob),a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function mountHistory(root,api,parentCheck){
 const status=el('p',{class:'li-status','aria-live':'polite'}),output=el('div');let sequence=0;
 const check=at=>{parentCheck();if(!root.isConnected||at!==sequence)throw Object.assign(Error('畫面已切換'),{code:'STALE_SESSION'});};
 const history=(action,payload={})=>api.read('history',{...payload,action});
 const catalog=await history('catalog');parentCheck();
 const source=select('來源資料集（一次僅選一份）',catalog.sources.map(s=>[s.sourceHash,kindLabel[s.kind]+' · '+s.filename]));
 const project=select('專案',[['','全部專案']]),person=select('歷史人員',[['','全部歷史人員']]);
 const query=()=>({sourceHash:source.input.value,...(project.input.value?{projectKey:project.input.value}:{}),...(person.input.value?Object.fromEntries(['employeeCode','employeeName'].map((k,i)=>[k,JSON.parse(person.input.value)[i]])): {})});
 const show=button('查詢歷史工時',()=>busy(show,status,()=>load(false)),'li-primary');
 root.append(el('h2',{},'歷史工時來源'),el('p',{class:'li-note'},'年度、跨年個案與月報表可能重疊，各自查詢、不相加。歷史姓名尚未對應新帳號；目前由具全公司報表權限者查閱。'),el('div',{class:'li-toolbar'},source.node,project.node,person.node,show),status,output);
 async function load(reset){const at=++sequence;output.replaceChildren();status.textContent='讀取來源…';if(reset){project.input.value='';person.input.value='';}
  const q=query(),r=await history('report',q);check(at);
  if(reset){project.input.replaceChildren(el('option',{value:''},'全部專案'),...r.projects.map(p=>el('option',{value:p.projectKey},(p.projectCode?p.projectCode+' · ':'')+p.projectName)));person.input.replaceChildren(el('option',{value:''},'全部歷史人員'),...r.people.map(p=>el('option',{value:JSON.stringify([p.employeeCode,p.employeeName])},p.employeeName+' ['+p.employeeCode+']')));}
  output.append(el('div',{class:'li-card'},el('h3',{},r.source.filename),el('strong',{},hours(r.summary.minutes)+' 小時'),el('p',{},r.notice),el('p',{class:'li-note'},'來源期間：'+r.source.period+' · '+r.summary.numericCells+' 個數值格；'+r.summary.blankCells+' 個原表空白格')),table(['專案代碼','專案','來源小時','原表空白格'],r.projects.map(p=>[p.projectCode,p.projectName,hours(p.minutes),p.blankCells])),el('h3',{},'歷史人員貢獻'),table(['來源代碼','姓名','來源小時','原表空白格'],r.people.map(p=>[p.employeeCode,p.employeeName,hours(p.minutes),p.blankCells])));
  if(r.differences.length)output.append(el('h3',{},'來源差異（不自動修正）'),table(['個案','年度表小時','個案表小時','個案減年度','狀態'],r.differences.map(d=>[d.evidence.project,hours(d.evidence.annualMinutes),hours(d.evidence.projectMinutes),hours(d.evidence.differenceMinutes),'待核對'])));
  const details=el('div'),detailButton=button('查看來源儲存格',()=>busy(detailButton,status,async()=>{const page=await history('rows',q);check(at);details.replaceChildren(table(['工作表／儲存格','人員','專案／工作','期間／週','來源小時'],page.rows.map(x=>[x.sheet+'!'+x.cell,x.employee_name,x.project_name+' / '+(x.details.workType||''),x.period+' '+(x.details.sourceWeek||''),x.minutes===null?'來源空白':hours(x.minutes)])),el('p',{class:'li-note'},'顯示前 '+page.rows.length+' 筆，共 '+page.totalRows+' 筆；完整明細請下載 Excel 或 CSV。'));}));
  async function exportReport(format){const rows=[];let offset=0;do{const page=await history('rows',{...q,offset});check(at);if(page.source.sourceHash!==q.sourceHash||page.offset!==offset)throw Error('歷史明細來源不符');rows.push(...page.rows);if(rows.length>100000||page.nextOffset!==null&&page.nextOffset<=offset)throw Error('歷史明細分頁錯誤');offset=page.nextOffset;status.textContent='正在核對匯出明細：'+rows.length+' / '+page.totalRows;}while(offset!==null);check(at);const blob=format==='xlsx'?workbook(historySheets(r,rows)):new Blob([historyCSV(r,rows)],{type:'text/csv;charset=utf-8'});download('LEAVES-歷史來源報表.'+format,blob);status.textContent='完整來源明細已核對並匯出。';}
  const excel=button('下載 Excel',()=>busy(excel,status,()=>exportReport('xlsx'))),csv=button('下載 CSV',()=>busy(csv,status,()=>exportReport('csv')));output.append(el('div',{class:'li-actions'},detailButton,excel,csv),details);
  if(api.can('ai.use'))mountReportQuestion(output,api,{kind:'history',...q},()=>check(at));status.textContent='已同步；每次查詢只計一份來源。';
 }
 source.input.addEventListener('change',()=>load(true).catch(e=>{if(e.code!=='STALE_SESSION')status.textContent=errorText(e);}));await load(true);
}
