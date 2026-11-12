import {el,button,dialog,busy,errorText} from '../shared/dom.mjs';
import {companyWorkbook} from '../workforce/company-form.mjs';
import {mountCompanyPreview} from '../workforce/company-preview.mjs';
export async function openReportAction(api,action){
 const at=api.epoch();if(action.kind!=='monthly-export'||!/^20\d\d-\d\d-01$/.test(action.month)||typeof action.employeeId!=='string')throw Error('月報條件無效');
 const d=dialog('月報預覽與匯出',{modal:false,width:1100,height:730});d.content.classList.add('li-shell');
 const valid=()=>{if(at!==api.epoch()||!d.box.open)throw Error('STALE_SESSION');};
 async function read(){const r=await api.progress('monthly.data',{employeeId:action.employeeId,month:action.month});valid();const {staff}=await api.progress('staff.list');valid();const person=staff.find(p=>p.employeeId===action.employeeId);if(!person)throw Error('FORBIDDEN');
  if(action.project){const projects=r.reportProjects||[];const found=projects.filter(p=>p.project_id===action.project||p.name===action.project);const matches=found.length?found:projects.filter(p=>p.name.includes(action.project));if(matches.length!==1)throw Error('請在進度與工時確認唯一的專案名稱。');r.entries=r.entries.filter(e=>e.project_id===matches[0].project_id);r.plans=(r.plans||[]).filter(e=>e.project_id===matches[0].project_id);}
  return{r,person};
 }
 try{const {r,person}=await read(),paper=el('section');d.content.append(el('p',{class:'li-note'},action.project?'本次僅列所選專案，班表與請假仍為該人整月資料。':'匯出前重新核對伺服器版本。'),button('匯出 Excel',()=>busy(document.activeElement,d.status,async()=>{const fresh=await read();const blob=await companyWorkbook(fresh.r,fresh.r.profile.style,fresh.r.reportProjects||[],fresh.person);valid();const a=el('a',{href:URL.createObjectURL(blob),download:'拾葉-'+fresh.person.name+'-'+action.month.slice(0,7)+'-月報.xlsx'});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);d.status.textContent='已核對並匯出。';}),'li-primary'),paper);await mountCompanyPreview(paper,r,r.profile.style,r.reportProjects||[],person,()=>d.status.textContent='請到進度與工時更正來源紀錄，再重新開啟預覽。');valid();}
 catch(e){d.status.textContent=errorText(e);}
}
