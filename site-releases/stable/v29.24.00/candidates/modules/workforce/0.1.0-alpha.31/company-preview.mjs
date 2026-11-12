import {companyDocument} from './company-form.mjs';
import {el,button} from './shared/dom.mjs';
const parse=text=>new DOMParser().parseFromString(text,'application/xml');
const index=ref=>[...ref.replace(/\d/g,'')].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
const number=(node,key,fallback)=>Number(node?.getAttribute(key)||fallback);
function color(node){const rgb=node?.getAttribute('rgb');return /^[A-Fa-f0-9]{8}$/.test(rgb||'')?'#'+rgb.slice(2):null;}
export async function mountCompanyPreview(root,data,style,projects,person,edit){
 root.replaceChildren(el('p',{class:'li-status'},'正在排入公司原表…'));
 const doc=await companyDocument(data,style,projects,person);
 if(!root.isConnected)return;
 const styles=parse(doc.files['xl/styles.xml']),xfs=[...styles.querySelector('cellXfs').children],fonts=[...styles.querySelector('fonts').children];
 const strings=doc.files['xl/sharedStrings.xml']?[...parse(doc.files['xl/sharedStrings.xml']).querySelectorAll('si')].map(si=>[...si.querySelectorAll('t')].map(n=>n.textContent).join('')):[];
 const borders=[...styles.querySelector('borders').children],fills=[...styles.querySelector('fills').children];
 const sheets=el('div');let page=0;
 function paint(){
  const current=doc.pages[page],xml=parse(current.xml),cells=new Map([...xml.querySelectorAll('sheetData row c')].map(c=>[c.getAttribute('r'),c]));
  const merged=new Map(),hidden=new Set();
  for(const n of xml.querySelectorAll('mergeCell')){
   const [from,to]=n.getAttribute('ref').split(':'),c1=index(from),c2=index(to),r1=Number(from.replace(/\D/g,'')),r2=Number(to.replace(/\D/g,''));
   merged.set(r1+','+c1,{rows:r2-r1+1,cols:c2-c1+1});
   for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++)if(r!==r1||c!==c1)hidden.add(r+','+c);
  }
  const t=el('table',{class:'li-company-sheet','aria-label':current.name}),cols=el('colgroup');
  for(let c=1;c<=43;c++){const source=[...xml.querySelectorAll('cols col')].find(n=>number(n,'min',0)<=c&&number(n,'max',0)>=c);cols.append(el('col',{style:'width:'+Math.max(12,number(source,'width',8)*7)+'px'}));}t.append(cols);
  const rows=el('tbody');
  for(const row of xml.querySelectorAll('sheetData row')){
   const r=number(row,'r',0);if(r>72)continue;
   const tr=el('tr',{style:'height:'+number(row,'ht',15)*4/3+'px'});
   for(let c=1;c<=43;c++){
    if(hidden.has(r+','+c))continue;
    let col='',v=c;while(v){v--;col=String.fromCharCode(65+v%26)+col;v=Math.floor(v/26);}
    const ref=col+r,node=cells.get(ref),span=merged.get(r+','+c),td=el('td',{rowspan:span?.rows||1,colspan:span?.cols||1});
    const text=node?.getAttribute('t')==='inlineStr'?[...node.querySelectorAll('t')].map(n=>n.textContent).join(''):node?.getAttribute('t')==='s'?strings[Number(node.querySelector('v')?.textContent)]||'':node?.querySelector('v')?.textContent||'';
    const xf=xfs[Number(node?.getAttribute('s')||0)],font=fonts[Number(xf?.getAttribute('fontId')||0)],alignment=xf?.querySelector('alignment');
    td.style.fontSize=number(font?.querySelector('sz'),'val',10)*4/3+'px';td.style.fontWeight=font?.querySelector('b')?'600':'400';
    td.style.textAlign=alignment?.getAttribute('horizontal')||'left';td.style.verticalAlign=alignment?.getAttribute('vertical')==='center'?'middle':'top';
    const ink=color(font?.querySelector('color'));if(ink)td.style.color=ink;
    const family=font?.querySelector('name')?.getAttribute('val');if(family)td.style.fontFamily='"'+family.replace(/["\\]/g,'')+'",sans-serif';
    const fill=color(fills[Number(xf?.getAttribute('fillId')||0)]?.querySelector('fgColor'));if(fill)td.style.backgroundColor=fill;
    for(const side of ['left','right','top','bottom']){const edge=borders[Number(xf?.getAttribute('borderId')||0)]?.querySelector(side),kind=edge?.getAttribute('style');if(kind){const width=/thick/.test(kind)?3:/medium|double/.test(kind)?2:1;td.style.setProperty('border-'+side,width+'px '+(kind==='double'?'double':'solid')+' '+(color(edge.querySelector('color'))||'#555'),'important');}}

    td.textContent=text;
    const ids=current.bindings[ref];
    if(ids?.length){td.classList.add('li-source-cell');td.tabIndex=0;td.title=data.closed?'查看來源工作紀錄':'查看或更正來源工作紀錄';const open=()=>{const entry=data.entries.find(e=>e.id===ids[0]);if(entry)edit(entry);};td.onclick=open;td.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();open();}};}
    tr.append(td);
   }rows.append(tr);
  }
  t.append(rows);sheets.replaceChildren(el('div',{class:'li-company-scroll'},t));label.textContent=current.name+' · '+(page+1)+' / '+doc.pages.length;
 }
 const label=el('span'),prev=button('上一頁',()=>{if(page>0){page--;paint();}}),next=button('下一頁',()=>{if(page+1<doc.pages.length){page++;paint();}});
 root.replaceChildren(el('div',{class:'li-toolbar'},el('strong',{},(data.reportName||person.name)+' · '+data.month.slice(0,7)),label,prev,next),el('p',{class:'li-note'},'點選工作內容可查看來源並更正。表格與匯出共用同一份內容。'),sheets);paint();
}
