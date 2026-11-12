import {createTeamFeed,teamCardOrder,teamPositionKey} from './team-feed.mjs';
import {el,button,field,select,dialog,busy,errorText,localDate,hours,roles} from '../shared/dom.mjs';
import {hoursToMinutes} from '../workforce/model.mjs';
import {mountLeaves} from '../workforce/monthly.mjs';
import {leaveKinds,leaveStates} from '../workforce/monthly.mjs';
export function dayBudget(values,scheduled=480,leave=0){const total=values.reduce((n,v)=>n+(String(v).trim()===''?0:hoursToMinutes(v)),0);if(total>1440)throw Error('當日安排合計不可超過 24 小時');const available=Math.max(0,scheduled-leave);return{total,available,remaining:Math.max(0,available-total),overtime:Math.max(0,total-available)};}
export function shiftDate(day,offset){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
export async function openDailyWindow(api,{openReports=()=>{},date:initialDate=localDate()}={}){
 const at=api.epoch(),person=api.person();if(!person||!api.can('progress.view'))throw Error('目前身分沒有每日進度權限');
 const active=document.querySelector('.li-daily-window[open]');
 if(active?._epoch===at && active._employee===person.employeeId && active._date?.value===initialDate){
   window.LeavesWindowStack?.raise(active);active.focus();return active._handle;
 }
 const d=dialog('每日進度與補填',{modal:false,width:650,height:565,close:()=>window.LeavesWindowStack?.unregister(d.box)});
 d.box._handle=d;d.box._epoch=at;d.box._employee=person.employeeId;
 window.LeavesWindowStack?.register(d.box);window.LeavesWindowStack?.raise(d.box);
 d.box.addEventListener('pointerdown',()=>window.LeavesWindowStack?.raise(d.box));
 d.box.classList.add('li-daily-window');const date=field('填寫日期','date',initialDate,{max:localDate()}),panel=el('div');d.box._date=date.input;let seq=0,saveCurrent=async()=>{},loading=false;
 const check=()=>{if(!d.box.isConnected||api.epoch()!==at||api.person()?.employeeId!==person.employeeId)throw Error('登入已變更，請重新開啟');};
 const choose=async day=>{if(loading)return;try{await saveCurrent();date.input.value=day;await load();}catch(e){d.status.textContent=errorText(e);}};
 d.content.append(el('p',{class:'li-daily-person'},person.name,el('span',{class:'li-role','data-role':person.role},roles[person.role])),el('div',{class:'li-toolbar'},date.node,button('今天',()=>choose(localDate())),button('昨天',()=>choose(shiftDate(localDate(),-1)))),panel);date.input.onchange=()=>choose(date.input.value);
 async function load(){const s=++seq,day=date.input.value;if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>localDate())throw Error('請選擇今天或之前的日期');loading=true;date.input.disabled=true;panel.replaceChildren();d.status.textContent='讀取 '+day+'…';saveCurrent=async()=>{};
 try{const [review,pr]=await Promise.all([api.progress('day.view',{employeeId:person.employeeId,date:day}),api.progress('projects.list')]);check();if(s!==seq)return;
 const locked=review.closed||!api.can('progress.edit'),existing=review.entries,rows=[],list=el('div',{class:'li-daily-rows'}),budget=el('div',{class:'li-day-budget'}),leaveBox=el('div'),draftKey='daily-hours-v1:'+person.employeeId+':'+day;let dirty=false;
 const snapshot=()=>rows.map(r=>({id:r.id,revision:r.revision,projectId:r.project.input.value,business:r.business.input.value,description:r.description.input.value,hours:r.time.input.value,actualHours:r.actual.input.value,workType:r.type.input.value}));
 saveCurrent=async()=>{if(dirty&&!locked)await api.drafts.save(draftKey,{unit:'hours',rows:snapshot()});};
 const changed=()=>{dirty=true;paint();saveCurrent().catch(e=>d.status.textContent=errorText(e));};
 function paint(){try{const leave=review.leaves.filter(x=>x.status==='approved').reduce((n,l)=>n+l.minutes,0),b=dayBudget(rows.map(r=>r.time.input.value),review.scheduledMinutes,leave);budget.replaceChildren(el('div',{},'班表',el('strong',{},hours(review.scheduledMinutes)+'h')),el('div',{},'已確認請假',el('strong',{},hours(leave)+'h')),el('div',{},'工作安排',el('strong',{},hours(b.total)+'h')),el('div',{},'尚可安排',el('strong',{},hours(b.remaining)+'h')),...(b.overtime?[el('p',{class:'li-note'},'超出正常可安排 '+hours(b.overtime)+'h，請核對加班或請假重疊。')]:[]));}catch(e){budget.textContent=e.message;}}
 function add(e={}){const r={id:e.id||crypto.randomUUID(),revision:e.revision||0};r.project=select('專案',[['','內部事務'],...pr.projects.map(p=>[p.project_id,p.name])],e.projectId??e.project_id??'');r.business=select('業務',[['internal','內部事務'],['design','設計'],['construction','工程']],e.business||'internal');r.type=field('工作類別','text',e.workType||e.work_type||'每日工作',{maxLength:100});r.description=field('工作內容','text',e.description||'',{maxLength:2000});r.time=field('預計小時','number',e.hours??(e.planned_minutes==null?'':e.planned_minutes/60),{min:0,max:24,step:'any'});r.actual=field('實際小時（空白待確認）','number',e.actualHours??(e.actual_minutes==null?'':e.actual_minutes/60),{min:0,max:24,step:'any'});
 const formMode=review.reportStyle||'project';
 const suggestions=formMode==='daily'?['3D 渲染','空間攝影','修圖','AI 網站']:formMode==='category'?['會計／零用金','會計／對帳','會計／發票','行政／採買','行政／人事','軟裝／家具']:['設計發想','施工圖','現場協調','專案會議'];
 const choices=el('datalist',{id:'tasks-'+r.id},suggestions.map(value=>el('option',{value})));
 r.type.input.setAttribute('list',choices.id);
 const firstRow=formMode==='category'?[r.type.node,r.business.node,r.project.node]:formMode==='daily'?[r.type.node,r.project.node,r.business.node]:[r.project.node,r.business.node,r.type.node];
 const remove=button('移除',()=>{rows.splice(rows.indexOf(r),1);node.remove();changed();});remove.disabled=locked||existing.some(x=>x.id===r.id);remove.title=remove.disabled?'已保存項目請更正內容或時數，保留歷程':'移除未保存項目';const node=el('section',{class:'li-daily-row'},el('div',{class:'li-grid'},firstRow,choices),el('div',{class:'li-grid'},r.description.node,r.time.node,r.actual.node),remove);
 for(const f of [r.project,r.business,r.type,r.description,r.time,r.actual]){f.input.disabled=locked;f.input.oninput=()=>{if(f===r.project)r.business.input.value=r.project.input.value?'design':'internal';changed();};}rows.push(r);list.append(node);paint();}
 existing.forEach(add);if(!existing.length&&!review.leaves.some(l=>['pending','approved'].includes(l.status)))add();
 const save=button(day===localDate()?'送出今日進度':'送出 '+day+' 補填',()=>busy(save,d.status,async()=>{check();dayBudget(rows.map(r=>r.time.input.value),review.scheduledMinutes);const entries=rows.map(r=>{if(!r.description.input.value.trim()||!r.type.input.value.trim())throw Error('請填寫工作內容與類別');if((r.business.input.value==='internal')!==(r.project.input.value===''))throw Error('請核對專案與業務分類');return{id:r.id,date:day,employeeId:person.employeeId,expectedRevision:r.revision,projectId:r.project.input.value||null,business:r.business.input.value,workType:r.type.input.value.trim(),description:r.description.input.value.trim(),plannedMinutes:hoursToMinutes(r.time.input.value),actualMinutes:hoursToMinutes(r.actual.input.value,{optional:true})};});
 const fingerprint=JSON.stringify(entries);if(save.dataset.fingerprint!==fingerprint){save.dataset.fingerprint=fingerprint;save.dataset.requestId=crypto.randomUUID();}await saveCurrent();await api.progress('daily.submit',{date:day,entries,requestId:save.dataset.requestId},true);check();dirty=false;api.drafts.remove(draftKey);window.dispatchEvent(new CustomEvent('leaves:daily-saved',{detail:{date:day,employeeId:person.employeeId}}));d.close();}),'li-primary');save.disabled=locked;
 const restore=button('恢復未送出的草稿',()=>busy(restore,d.status,async()=>{const saved=await api.drafts.load(draftKey);check();if(saved?.unit!=='hours')throw Error('沒有可恢復的草稿');if(!Array.isArray(saved.rows)||review.entries.some(e=>!saved.rows.some(row=>row.id===e.id))||saved.rows.some(r=>r.revision!==(review.entries.find(e=>e.id===r.id)?.revision||0)))throw Error('草稿基準已改變，請先核對每日明細');rows.length=0;list.replaceChildren();saved.rows.forEach(add);dirty=true;d.status.textContent='已恢復，尚未送出';}));restore.disabled=locked;
 panel.append(el('p',{class:'li-note'},(day===localDate()?'今天填寫':'補填日期：'+day)+(locked?' · 已核定或僅可查看':'')),budget,list,el('div',{class:'li-actions'},Object.assign(button('＋ 新增工作',()=>{add();changed();}),{disabled:locked}),restore,save),leaveBox);
 mountLeaves(leaveBox,api,{date:day,employeeId:person.employeeId,data:review,reload:async()=>{await saveCurrent();await load();}});d.status.textContent='';
 const saved=await api.drafts.load(draftKey);check();if(saved)d.status.textContent=(Date.now()-Date.parse(saved._draftSavedAt||'')>30*86400000?'此草稿已超過 30 天，請核對後送出或自行處理。':'此日期有未送出草稿，可按「恢復」。')+'切換日期會保留草稿。';
 }catch(e){d.status.textContent=errorText(e);}finally{loading=false;date.input.disabled=false;}}
 await load();return d;
}
export async function openTeamDay(api){
 const person=api.person(),at=api.epoch();if(!person||!api.can('progress.view')||!['owner','boss','supervisor'].includes(person.role))throw Error('目前身分沒有團隊進度權限');
 const existing=document.querySelector('.li-team-window[open]');if(existing){if(existing._teamEpoch===at){window.LeavesWindowStack?.raise(existing);existing.focus();return existing._teamHandle;}existing.close();}
 let feed,closed=false;
 const d=dialog('團隊今日進度',{modal:false,width:960,height:620,close:()=>{closed=true;feed?.dispose();window.removeEventListener('leaves:daily-saved',localSaved);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);window.LeavesWindowStack?.unregister(d.box);}});
 d.box.classList.add('li-team-window');d.box._teamEpoch=at;d.box._teamHandle=d;window.LeavesWindowStack?.register(d.box);window.LeavesWindowStack?.raise(d.box);d.box.addEventListener('pointerdown',()=>window.LeavesWindowStack?.raise(d.box));
 const date=field('日期','date',localDate()),role=select('職務',[['','全部職務'],...Object.entries(roles)],''),cards=el('div',{class:'li-team-cards'}),count=el('span',{class:'li-team-count'}),missing=el('details',{class:'li-team-missing'}),leaveSummary=el('details',{class:'li-team-leaves'}),empty=el('p',{class:'li-team-empty'},'尚無同仁提交此日期的進度。');
 const nodes=new Map(),seen=new Set();let cache=[],scheduled=0;
 const valid=()=>!closed&&d.box.isConnected&&at===api.epoch()&&api.person()?.employeeId===person.employeeId&&api.can('progress.view')&&['owner','boss','supervisor'].includes(api.person()?.role);
 const fullLeave=x=>scheduled>0&&x.leaves.filter(l=>l.status==='approved').reduce((n,l)=>n+l.minutes,0)>=scheduled;
 const time=value=>new Date(value).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false});
 function card(x){const {p,rows,leaves,submittedAt}=x,first=x.firstSubmittedAt||submittedAt,planned=rows.reduce((n,r)=>n+r.planned_minutes,0),known=rows.filter(r=>r.actual_minutes!==null),actual=known.reduce((n,r)=>n+r.actual_minutes,0);
  return el('article',{class:'li-team-card','data-employee':p.employeeId,'data-position':teamPositionKey(p)},
   el('header',{},el('h3',{},p.name),el('span',{class:'li-role','data-role':p.role},p.position||roles[p.role])),
   el('ul',{},rows.map(r=>el('li',{},el('span',{},r.projectName||'內部事務'),el('p',{},r.description),el('small',{},'預計 '+hours(r.planned_minutes)+'h'+(r.actual_minutes!==null?' · 已登錄實際 '+hours(r.actual_minutes)+'h':' · 實際待確認'))))),
   ...leaves.map(l=>el('p',{class:'li-team-leave-line'},(leaveKinds.find(k=>k[0]===l.leave_kind)?.[1]||l.leave_kind)+' '+hours(l.minutes)+'h · '+leaveStates[l.status])),
   el('footer',{},el('span',{},'安排 '+hours(planned)+'h'+(known.length?' · 已登錄實際 '+hours(actual)+'h':'')),el('time',{},'首次 '+time(first)+(submittedAt!==first?' · 更新 '+time(submittedAt):''))),
   el('details',{class:'li-team-card-meta'},el('summary',{},'詳細資料'),el('span',{},'固定 ID '+p.employeeId)));
 }
 function paint(){if(!valid()){d.close();return;}const visible=cache.filter(x=>!role.input.value||x.p.role===role.input.value),submitted=teamCardOrder(visible),unsubmitted=visible.filter(x=>!x.submittedAt&&!fullLeave(x)),onLeave=visible.filter(x=>x.leaves.length);
  count.textContent='已提交 '+submitted.length+' / '+visible.length+' 人 · 全日已確認請假 '+visible.filter(fullLeave).length+' 人';
  missing.replaceChildren(el('summary',{},'尚未提交 '+unsubmitted.length+' 人'),el('p',{},unsubmitted.map(x=>x.p.name).join('、')||'此範圍沒有尚待提交的人員。'));
  leaveSummary.replaceChildren(el('summary',{},'請假資訊 '+onLeave.length+' 人'),...onLeave.map(x=>el('p',{},x.p.name+' · '+x.leaves.map(l=>(leaveKinds.find(k=>k[0]===l.leave_kind)?.[1]||l.leave_kind)+' '+hours(l.minutes)+'h · '+leaveStates[l.status]).join('、'))));
  empty.remove();let entering=0;const wanted=new Set(submitted.map(x=>x.p.employeeId));for(const [id,value]of nodes)if(!wanted.has(id)){value.node.remove();nodes.delete(id);}
  for(let i=0;i<submitted.length;i++){const x=submitted[i],id=x.p.employeeId,stamp=JSON.stringify(x),old=nodes.get(id);let node=old?.node;
   if(!old||old.stamp!==stamp){const opened=old?.node.querySelector('details')?.open;node=card(x);if(opened)node.querySelector('details').open=true;if(!seen.has(id)){node.classList.add('li-team-card-enter');node.style.animationDelay=Math.min(entering++,6)*50+'ms';node.style.animationFillMode='both';seen.add(id);}if(old)old.node.replaceWith(node);nodes.set(id,{node,stamp});}
   if(cards.children[i]!==node)cards.insertBefore(node,cards.children[i]||null);
  }
  if(!submitted.length)cards.append(empty);
 }
 const status=(state,error)=>{if(!valid()){d.close();return;}if(state==='error'){d.status.textContent=errorText(error);if(['AUTH_REQUIRED','AUTH_REVOKED','FORBIDDEN'].includes(error?.code))d.close();}else if(state==='fallback')d.status.textContent='即時通知暫停，重新連線後自動補讀，也可按重新讀取。';else if(state==='syncing')d.status.textContent='正在同步變更…';else d.status.textContent=(state==='connected'?'即時通知已連線':'已同步')+' · '+new Date().toLocaleTimeString('zh-TW');};
 feed=createTeamFeed({read:(a,p,signal)=>api.progress(a,p,false,{signal}),watch:(day,options)=>api.watchTeamDay(day,options),environment:person.environment,onData:r=>{if(!valid())return d.close();cache=r.people;scheduled=r.scheduledMinutes;paint();},onState:status});
 const refresh=button('重新讀取',()=>feed.refresh()),ask=button('詢問 AI',()=>{if(valid())api.openTeamChat(date.input.value,role.input.value);});
 function focus(){feed?.focus();}function localSaved(){feed?.notify();}
 date.input.onchange=()=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date.input.value))return;cache=[];nodes.clear();seen.clear();cards.replaceChildren();count.textContent='讀取中…';missing.replaceChildren();leaveSummary.replaceChildren();feed.setDate(date.input.value);};role.input.onchange=paint;
 window.addEventListener('leaves:daily-saved',localSaved);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
 d.content.append(el('div',{class:'li-toolbar'},date.node,role.node,refresh,ask,count),el('div',{class:'li-team-notes'},missing,leaveSummary),cards);feed.setDate(date.input.value);return d;
}
