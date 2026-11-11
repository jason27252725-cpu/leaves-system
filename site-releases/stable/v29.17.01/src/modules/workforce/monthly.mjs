import {periodStart} from './model.mjs';
import {workbook} from './xlsx.mjs';
export const styles=[['project','專案／週（設計、施工圖）'],['daily','逐日多案（3D、攝影、AI）'],['category','類別／週（會計行政）']];
export const leaveKinds=[['sick','病假'],['personal','事假'],['annual','特休'],['other','其他假別']];
export const leaveStates={pending:'待確認',approved:'已確認',rejected:'未通過',withdrawn:'已撤回'};
export function accountingGroup(entry, projectName){
 const type=String(entry.work_type||'').trim();
 if(/^(會計|財務)/.test(type))return ['account','account','會計'];
 if(/^行政/.test(type))return ['admin','admin','行政'];
 if(/^軟裝/.test(type)||entry.project_id)return ['soft',entry.project_id||type,projectName];
 return ['other','other','待分類事務'];
}
export function unrecordedWorkdays(calendar,entries,leaves,today){
 const recorded=new Set(entries.map(e=>e.work_date));
 const away=new Map();
 for(const l of leaves)if(l.status==='approved'||l.status==='pending')away.set(l.work_date,(away.get(l.work_date)||0)+l.minutes);
 return Object.keys(calendar||{}).filter(d=>calendar[d]>0&&d<today&&!recorded.has(d)&&(away.get(d)||0)<calendar[d]).sort();
}
export function buildMonthly(data,style='project',projects=[]){
 if(!styles.some(x=>x[0]===style))throw Error('月報版型無效');
 const month=data.month?.slice(0,7);if(!/^\d{4}-\d{2}$/.test(month))throw Error('月份無效');
 const names=new Map((data.reportProjects??projects).map(p=>[p.project_id,p.name])),seen=new Set(),groups=new Map();let planned=0,actual=0,missing=0;
 const entries=[...data.entries].sort((a,b)=>a.work_date.localeCompare(b.work_date)||a.id.localeCompare(b.id));
 for(const e of entries){
  if(!e.work_date.startsWith(month)||seen.has(e.id))throw Error('月報日期或重複明細異常');seen.add(e.id);
  if(!Number.isSafeInteger(e.planned_minutes)||e.planned_minutes<0||e.actual_minutes!==null&&(!Number.isSafeInteger(e.actual_minutes)||e.actual_minutes<0))throw Error('工時明細異常');
  const week=periodStart(e.work_date,'week'),project=names.get(e.project_id)||e.project_name||(e.project_id?'專案 '+e.project_id:'內部事務');
  const bucket=style==='category'?accountingGroup(e,project):null;
  const label=style==='daily'?e.work_date:bucket?bucket[2]:project;
  const key=style==='daily'?e.work_date:bucket?bucket.slice(0,2):[e.business,e.project_id];
  const k=JSON.stringify([week,key]);
  const g=groups.get(k)||{week,label,business:e.business,planned:0,actual:0,missing:0,details:[]};
  g.planned+=e.planned_minutes;planned+=e.planned_minutes;
  if(e.actual_minutes===null){g.missing++;missing++;}else{g.actual+=e.actual_minutes;actual+=e.actual_minutes;}
  g.details.push({...e,projectName:project});groups.set(k,g);
 }
 const leaveTotals={approved:0,pending:0};for(const l of data.leaves||[]){if(!l.work_date.startsWith(month))throw Error('請假日期不屬於本月');if(l.status in leaveTotals)leaveTotals[l.status]+=l.minutes;}
 return{style,month,groups:[...groups.values()],entries,planned,actual,missing,leaveTotals,plans:data.plans||[],closed:!!data.closed};
}
export function cellParts(value){const out=[];let part='';for(const c of String(value)){if(part.length+c.length>30000){out.push(part);part='';}part+=c;}out.push(part);return out;}
export function monthlyWorkbook(data,style,projects,name){
 const r=buildMonthly(data,style,projects);
 const summary=[['LEAVES 月報',name,r.month],['版型',styles.find(x=>x[0]===style)[1]],['狀態',r.closed?'已核定':'工作月報草稿（含未確認資料）'],['每日預計小時',r.planned/60],['已填實際小時',r.actual/60],['實際待確認筆數',r.missing],['已確認請假小時',r.leaveTotals.approved/60],['待確認請假小時',r.leaveTotals.pending/60],[],['週起日','日期／專案／類別','每日預計小時','已填實際小時','待確認筆數','工作明細'],...r.groups.flatMap(g=>cellParts(g.details.map(e=>e.work_date+' '+e.projectName+' / '+e.work_type+'：'+e.description).join('\n')).map((text,i)=>[g.week,g.label+(i?'（續）':''),i?'':g.planned/60,i?'':g.missing?'待確認（已填 '+g.actual/60+'h）':g.actual/60,i?'':g.missing,text]))];
 const detail=[['固定人員 ID','日期','專案 ID','業務','工作類別','內容','每日預計小時','實際小時','版本'],...r.entries.map(e=>[e.employee_id,e.work_date,e.project_id||'',e.business,e.work_type,e.description,e.planned_minutes/60,e.actual_minutes===null?'待確認':e.actual_minutes/60,e.revision])];
 const leave=[['日期','假別','小時','狀態','版本'],...(data.leaves||[]).map(l=>[l.work_date,leaveKinds.find(k=>k[0]===l.leave_kind)?.[1]||l.leave_kind,l.minutes/60,leaveStates[l.status],l.revision])];
 const plans=[['期間起日','期間類型','專案 ID','工作類別','計畫內容','期間預計小時','計算說明'],...r.plans.map(p=>[p.period_start,p.period_kind,p.project_id||'',p.work_type,p.description,p.planned_minutes/60,'期間預計獨立呈現，不與每日預計相加；跨月週不自動拆分'])];
 return workbook([['月報彙整',summary],['每日明細',detail],['請假紀錄',leave],['期間計畫',plans]]);
}

import {el,button,field,select,dialog,busy,errorText,hours} from '../shared/dom.mjs';
import {hoursToMinutes} from './model.mjs';
export function mountLeaves(root,api,{date,employeeId,data,reload}){
 const own=employeeId===api.person().employeeId,locked=data.closed,canReview=api.can('attendance.manage');
 function edit(old){const d=dialog(old?'更正請假':'補登請假'),kind=select('假別',leaveKinds,old?.leave_kind||'sick'),time=field('請假小時','number',old?old.minutes/60:Math.min(480,data.scheduledMinutes)/60,{min:0,max:24,step:'any'}),note=field('備註（選填）','text',old?.note||'',{maxLength:500});const id=old?.id||crypto.randomUUID();
  d.content.append(el('p',{},date+'；請假確認後獨立統計，不計入專案工作。更正已確認資料將重新送審。'),kind.node,time.node,note.node);
  const save=button('保存並送出確認',()=>busy(save,d.status,async()=>{await api.progress('leave.save',{id,employeeId,date,kind:kind.input.value,minutes:hoursToMinutes(time.input.value),note:note.input.value,expectedRevision:old?.revision||0},true);d.close();await reload();}),'li-primary');d.content.append(save);
 }
 const list=el('div',{class:'li-leave-list'});for(const l of data.leaves||[]){const row=el('article',{class:'li-card'},el('strong',{},leaveKinds.find(x=>x[0]===l.leave_kind)?.[1]||l.leave_kind),el('span',{},' '+hours(l.minutes)+'h · '+leaveStates[l.status]));
  if(!locked&&own&&api.can('progress.edit')){row.append(button('更正',()=>edit(l)));if(l.status!=='withdrawn')row.append(button('撤回',()=>act(row,'leave.save',{id:l.id,employeeId,date,kind:l.leave_kind,minutes:l.minutes,note:l.note,status:'withdrawn',expectedRevision:l.revision})));}
  if(!locked&&canReview&&l.status==='pending')for(const[state,label]of [['approved','確認請假'],['rejected','退回']])row.append(button(label,()=>act(row,'leave.review',{id:l.id,employeeId,date,status:state,expectedRevision:l.revision})));
  list.append(row);
 }
 async function act(row,action,payload){const status=el('p',{class:'li-status'}),b=document.activeElement;row.append(status);await busy(b,status,async()=>{await api.progress(action,payload,true);await reload();});}
 root.append(el('h3',{},'請假與補登'),el('p',{class:'li-note'},'請假可補登；實際出勤小時仍依公司核對。假別只記必要資訊。'),list);
 if(own&&!locked&&api.can('progress.edit'))root.append(button('＋ 補登請假',()=>edit()));
}
