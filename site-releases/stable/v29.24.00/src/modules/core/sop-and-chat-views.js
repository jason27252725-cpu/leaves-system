function renderMarkdownPure(text) {
if (!text) return '';
const clean = String(text)
.replace(/User Safety:\s*safe/gi, '')
.replace(/Response Safety:\s*safe/gi, '')
.trim();

if (typeof marked === 'undefined') return escapeHtml(clean);

return sanitizeRenderedHtml(marked.parse(clean));
}

function sopRagNormalize(value='') {
return String(value || '').toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}_]+/gu,'');
}

function sopRagHeading(line='') {
const t=String(line).trim();
if (!t) return null;
let m=t.match(/^#{1,6}\s+(.+)$/); if (m) return m[1].trim();
m=t.match(/^\*\*(.{2,100}?)\*\*\s*[:：]?\s*$/); if (m) return m[1].trim();
m=t.match(/^__(.{2,100}?)__\s*[:：]?\s*$/); if (m) return m[1].trim();
m=t.match(/^【([^】]{2,100})】\s*$/); if (m) return m[1].trim();
m=t.match(/^(?:第?[一二三四五六七八九十百0-9]+[、\.．章節項]|[0-9]+(?:\.[0-9]+){0,3}[、.．]?)\s*(.{2,100})$/); if (m) return (m[1]||t).replace(/^\*\*|\*\*$/g,'').trim();
if (t.length <= 48 && /(?:工程|流程|規範|標準|驗收|注意事項|施工|丈量|開工|保護|水電|泥作|防水|木作|油漆|完工|路權|人員|成員|組織|團隊|行政|會計|門禁|密碼|網路設定|網路連線|Wi-?Fi|公用帳號|共用帳號)$/i.test(t.replace(/^\*\*|\*\*$/g,''))) return t.replace(/^\*\*|\*\*$/g,'').trim();
return null;
}

function sopRagTokenSet(text='') {
const raw=String(text||'').normalize('NFKC');
const set=new Set();
(raw.match(/[A-Za-z0-9]+|[\u3400-\u9fff]{2,8}/g)||[]).forEach(x=>{ const n=sopRagNormalize(x); if(n.length>=2) set.add(n); });
const clean=sopRagNormalize(raw);
for(let i=0;i<clean.length-1;i++){ const g=clean.slice(i,i+2); if(/^[\u3400-\u9fff]{2}$/.test(g)) set.add(g); }
return set;
}

function sopRagEstimateTokens(text='') { return Math.max(1, Math.round(String(text||'').length * 1.05)); }

function sopRagBuildIndex(sopContent='', meta={}) {
const content=String(sopContent||'').replace(/\r\n/g,'\n').trim();
const hash=String(meta?.contentHash||'') || `len:${content.length}:${content.slice(0,80)}`;
const revision=meta?.revision ?? null;
if (sopRagRuntime.hash===hash && sopRagRuntime.revision===revision && sopRagRuntime.chunks.length) return sopRagRuntime;
const lines=content.split('\n');
const chunks=[]; let section='未分類'; let buffer=[]; let startLine=1; let chunkSeq=0;
const flush=()=>{
const body=buffer.join('\n').trim(); if(!body){buffer=[];return;}
const parts=[];
if(body.length<=SOP_RAG_CONFIG.hardChunkChars) parts.push(body);
else {
const paras=body.split(/\n{2,}/); let temp='';
for(const p of paras){
if(temp && (temp.length+p.length+2)>SOP_RAG_CONFIG.hardChunkChars){parts.push(temp.trim());temp='';}
temp += (temp?'\n\n':'')+p;
}
if(temp.trim()) parts.push(temp.trim());
}
parts.forEach((part,pi)=>{
const id=`sop_${String(++chunkSeq).padStart(4,'0')}`;
chunks.push({id,section,content:part,startLine,endLine:startLine+body.split('\n').length-1,tokens:sopRagTokenSet(`${section}\n${part}`),index:chunks.length,part:pi});
});
buffer=[];
};
lines.forEach((line,i)=>{
const h=sopRagHeading(line);
if(h){ flush(); section=h; startLine=i+1; }
else { if(!buffer.length) startLine=i+1; buffer.push(line); }
});
flush();
const df=new Map();
chunks.forEach(c=>{ c.tokens.forEach(t=>df.set(t,(df.get(t)||0)+1)); });
sopRagRuntime.hash=hash; sopRagRuntime.revision=revision; sopRagRuntime.chunks=chunks; sopRagRuntime.df=df; sopRagRuntime.builtAt=Date.now();
return sopRagRuntime;
}

function sopRagIsContinuation(q='') { return /^(那|這|它|這個|那個|這樣|那這樣|那要|那如果|那之後|那完成面|然後呢|接下來|所以呢|那還有|還有呢)/.test(String(q).trim()); }

function sopRagBuildQuery(question='', history=[], extraTerms=[]) {
let q=String(question||'').trim();
if (sopRagIsContinuation(q) && Array.isArray(history)) {
const prev=[...history].reverse().find(h=>h?.role==='user' && String(h.text||'').trim());
if(prev) q=`${String(prev.text).slice(-SOP_RAG_CONFIG.questionHistoryChars)}\n${q}`;
}
const expanded=new Set(sopRagTokenSet(q));
const nq=sopRagNormalize(q);
SOP_RAG_DOMAIN_GROUPS.forEach(group=>{ if(group.some(t=>nq.includes(sopRagNormalize(t)))) group.forEach(t=>expanded.add(sopRagNormalize(t))); });
(extraTerms||[]).forEach(t=>{const n=sopRagNormalize(t); if(n.length>=2) expanded.add(n);});
return { raw:q, normalized:nq, terms:expanded };
}

function sopRagScoreChunk(query, chunk, index) {
const sectionN=sopRagNormalize(chunk.section); const contentN=sopRagNormalize(chunk.content); let score=0, coreHits=0, rareHits=0;
for(const term of query.terms){
if(!term || term.length<2) continue;
const df=index.df.get(term)||1; const idf=Math.log(1+(index.chunks.length/df));
let hit=0;
if(sectionN.includes(term)) hit += 4.6;
if(contentN.includes(term)) hit += term.length>=4 ? 2.7 : 1.15;
if(hit){ score += hit*idf; if(!SOP_RAG_GENERIC_TERMS.has(term)){coreHits++; if(df<=Math.max(3,index.chunks.length*.08)) rareHits++;} }
}
if(query.normalized.length>=4 && contentN.includes(query.normalized)) score+=20;
if(query.normalized.length>=4 && sectionN.includes(query.normalized)) score+=28;
const nums=String(query.raw).match(/\d+(?:\.\d+)?\s*(?:mm|cm|m|%|小時|天|hr|h)?/gi)||[];
nums.forEach(n=>{ if(`${chunk.section}\n${chunk.content}`.includes(n.trim())) score+=7; });
return { score:Number(score.toFixed(2)), coreHits, rareHits };
}

function sopRagRank(index, query) {
return index.chunks.map(chunk=>({chunk,...sopRagScoreChunk(query,chunk,index)}))
.filter(x=>x.score>=6 && x.coreHits>=1)
.sort((a,b)=>b.score-a.score || b.coreHits-a.coreHits || a.chunk.index-b.chunk.index)
.slice(0,SOP_RAG_CONFIG.candidateLimit);
}

function sopRagConflictHints(selected=[]) {
const hints=[];
for(let i=0;i<selected.length;i++) for(let j=i+1;j<selected.length;j++) {
const a=selected[i]?.chunk, b=selected[j]?.chunk; if(!a||!b) continue;
const aTerms=[...a.tokens].filter(t=>!SOP_RAG_GENERIC_TERMS.has(t) && t.length>=2);
const bSet=new Set([...b.tokens].filter(t=>!SOP_RAG_GENERIC_TERMS.has(t) && t.length>=2));
const shared=aTerms.filter(t=>bSet.has(t));
const related=a.section===b.section || shared.length>=2;
if(!related) continue;
const va=String(a.content).match(/\d+(?:\.\d+)?\s*(?:mm|cm|m|%|小時|天)/g)||[];
const vb=String(b.content).match(/\d+(?:\.\d+)?\s*(?:mm|cm|m|%|小時|天)/g)||[];
for(const x of va) for(const y of vb) {
const ux=(x.match(/mm|cm|m|%|小時|天/)||[''])[0], uy=(y.match(/mm|cm|m|%|小時|天/)||[''])[0];
const nx=x.replace(/\s+/g,''), ny=y.replace(/\s+/g,'');
if(ux && ux===uy && nx!==ny) hints.push({unit:ux,values:[nx,ny],chunks:[a.id,b.id]});
}
}
const seen=new Set();
return hints.filter(h=>{ const k=`${h.unit}:${[...h.values].sort().join('|')}:${[...h.chunks].sort().join('|')}`; if(seen.has(k))return false; seen.add(k); return true; }).slice(0,6);
}

function sopRagShouldExpandNeighbor(base, neighbor, query, intent='FACT') {
if(!base||!neighbor) return false;
if(base.section===neighbor.section) return true;
const nSection=sopRagNormalize(neighbor.section), nContent=sopRagNormalize(neighbor.content);
let queryHits=0;
for(const term of query.terms){ if(term.length>=2 && (nSection.includes(term)||nContent.includes(term))) queryHits++; }
if(/(依前述|上述|前項|下一工序|接續|完成後|之後)/.test(base.content) && (queryHits>=1 || ['PROCEDURE','CROSS_DOMAIN'].includes(intent))) return true;
if(['PROCEDURE','CROSS_DOMAIN','ENUMERATION','ORGANIZATION'].includes(intent)) {
const a=sopRagNormalize(base.section), b=sopRagNormalize(neighbor.section);
if(SOP_RAG_FLOW_STAGES.some(stage=>a.includes(sopRagNormalize(stage)) && b.includes(sopRagNormalize(stage)))) return true;
}
return queryHits>=2;
}

function sopRagMatchConfidence(ranked=[], query=null) {
const top=ranked[0], second=ranked[1];
if(!top) return 'LOW';
if(top.score>=24 && top.coreHits>=2 && (!second || top.score-second.score>=2.5 || top.rareHits>=1)) return 'HIGH';
if(top.score>=10 && top.coreHits>=1) return 'MEDIUM';
return 'LOW';
}

function sopRagCoverageConfidence(intentInfo, selected=[], index=null, staffCount=0) {
const intent=intentInfo.intent;
if(intent==='FULL_ANALYSIS') return 'FULL';
if(intent==='ORGANIZATION' && staffCount>0) return 'HIGH';
if(!selected.length) return 'LOW';
const sections=new Set(selected.map(x=>sopRagNormalize(x.chunk.section)));
const combined=sopRagNormalize(selected.map(x=>`${x.chunk.section}${x.chunk.content}`).join('\n'));
if(intent==='FACT'||intent==='RESOURCE') return selected.length>=1?'HIGH':'LOW';
if(intent==='COMPARE') return sections.size>=2?'HIGH':selected.length>=2?'MEDIUM':'LOW';
if(intent==='ENUMERATION') return selected.length>=5||sections.size>=3?'HIGH':selected.length>=2?'MEDIUM':'LOW';
if(intent==='CROSS_DOMAIN') {
const groups=SOP_RAG_DOMAIN_GROUPS.slice(0,10).filter(g=>g.some(t=>combined.includes(sopRagNormalize(t)))).length;
return groups>=2?'HIGH':groups===1?'MEDIUM':'LOW';
}
if(intent==='PROCEDURE') {
const stageHits=SOP_RAG_FLOW_STAGES.filter(s=>combined.includes(sopRagNormalize(s))).length;
if(stageHits>=5 || sections.size>=5) return 'HIGH';
if(stageHits>=2 || sections.size>=3) return 'MEDIUM';
return 'LOW';
}
return selected.length>=2?'HIGH':'MEDIUM';
}

function sopRagSelectPass(ranked, index, query, intentInfo, pass, selected, seen, maxChars) {
const top=ranked[0];
if(!top) return;
const intent=intentInfo.intent;
let relative=0.22, limit=7, neighborBudget=2;
if(pass===2){ relative=0.10; limit=14; neighborBudget=5; }
if(pass===3){ relative=0.045; limit=22; neighborBudget=10; }
if(['PROCEDURE','ENUMERATION','CROSS_DOMAIN','ORGANIZATION','COMPARE'].includes(intent)) { limit+=4; relative*=0.72; neighborBudget+=2; }
const cutoff=Math.max(pass===1?6:pass===2?3:1.5, top.score*relative);
const candidates=ranked.filter(r=>r.score>=Math.max(6,cutoff) && r.coreHits>=1).slice(0,limit);
const currentChars=()=>selected.reduce((n,x)=>n+x.chunk.content.length+x.chunk.section.length+80,0);
const add=(c,score,reason)=>{
if(!c||seen.has(c.id)||isHighRiskSecretLine(c.section+'\n'+c.content))return;
if(currentChars()+c.content.length>maxChars && selected.length>=3)return;
seen.add(c.id); selected.push({chunk:c,score,reason});
};
candidates.forEach((r,i)=>{
add(r.chunk,r.score,`pass${pass}`);
if(i<neighborBudget){
const prev=index.chunks[r.chunk.index-1], next=index.chunks[r.chunk.index+1];
if(sopRagShouldExpandNeighbor(r.chunk,prev,query,intent)) add(prev,Math.max(0,r.score-2.5),`neighbor-p${pass}`);
if(sopRagShouldExpandNeighbor(r.chunk,next,query,intent)) add(next,Math.max(0,r.score-2.5),`neighbor-p${pass}`);
}
});
if(pass===3 && ['PROCEDURE','ENUMERATION','ORGANIZATION'].includes(intent)) {
const selectedSections=new Set(selected.map(x=>x.chunk.section));
index.chunks.forEach(c=>{
if(selectedSections.has(c.section) && currentChars()+c.content.length<=maxChars) add(c,0,'section-expand');
});
}
}

function sopRagRetrieveInternalAccess(question, sopContent, meta={}, history=[], kind=detectInternalAccessKind(question)) {
const safeSop=filterSensitiveSop(sopContent); const fullTokens=sopRagEstimateTokens(safeSop);
const allFacts=accessExtractStructuredFacts(safeSop).filter(f=>f.kind===kind);
const knownSites=accessKnownSites(allFacts,kind); const site=accessResolveSite(question,history,knownSites); const requestedFields=accessRequestedFields(kind,question);
let candidateFacts=site.status==='NOT_FOUND'?[]:allFacts;
if(['EXACT','INHERITED'].includes(site.status)) candidateFacts=candidateFacts.filter(f=>sopRagNormalize(f.site)===sopRagNormalize(site.site));
let allowedFacts=candidateFacts;
if(requestedFields.length) allowedFacts=candidateFacts.filter(f=>requestedFields.some(r=>r.key===f.fieldKey || (kind==='WIFI' && r.key==='WIFI_PASSWORD' && f.fieldKey.startsWith('WIFI_PASSWORD')) || (kind==='WIFI' && r.key==='WIFI_SSID' && f.fieldKey.startsWith('WIFI_SSID'))));
const precisionBlocks=accessBuildPrecisionBlocks(question,safeSop,kind,history);
let fieldMatch='UNSPECIFIED';
if(requestedFields.length){ const hitKeys=new Set(allowedFacts.map(f=>f.fieldKey)); const hits=requestedFields.filter(r=>hitKeys.has(r.key) || (kind==='WIFI'&&r.key==='WIFI_PASSWORD'&&[...hitKeys].some(k=>k.startsWith('WIFI_PASSWORD'))) || (kind==='WIFI'&&r.key==='WIFI_SSID'&&[...hitKeys].some(k=>k.startsWith('WIFI_SSID')))).length; fieldMatch=hits===requestedFields.length?'EXACT':hits>0?'PARTIAL':'NONE'; }
const siteMatch=site.status; const topicMatch=(allowedFacts.length||precisionBlocks.length)?'HIGH':'LOW';
let answerability='NO';
if(site.status==='NOT_FOUND') answerability='NO';
else if(allowedFacts.length) answerability=fieldMatch==='PARTIAL'?'PARTIAL':'YES';
else if(precisionBlocks.length && !requestedFields.length) answerability='SOFT';
else if(precisionBlocks.length && site.status!=='NOT_FOUND') answerability='SOFT';
const exactFieldQuery=requestedFields.length>0 && fieldMatch!=='NONE';
let context='';
if(site.status==='NOT_FOUND') {
context=`【Access Grounding】\n- 查詢類型：${kind}\n- 使用者指定據點：${site.requested}\n- 據點匹配：NOT_FOUND\n- 可回答性：NO\n- 規則：SOP 的存取資料中沒有找到這個據點。不可把其他據點推定成「${site.requested}」，不可提供其他據點的密碼或門禁值；只可說目前無法從 SOP 確認，或請使用者確認據點名稱。`;
} else if(allowedFacts.length) {
const factsText=allowedFacts.slice(0,12).map(f=>`- ${accessFactDisplay(f)}`).join('\n');
context=`【Access Structured Grounding｜由現行 SOP 動態抽取】\n- 查詢類型：${kind}\n- 據點匹配：${site.status}${site.site?`（${site.site}）`:''}\n- 欄位匹配：${fieldMatch}\n- 可回答性：${answerability}\n- 可確認 facts：\n${factsText}\n\n回答時以 facts 的欄位邊界為準；若只問單一欄位，不要把相鄰欄位名稱或值黏進答案。`;
if(!exactFieldQuery && precisionBlocks.length){ context+=`\n\n【原始 SOP 精準片段｜保留自然語意彈性】\n${precisionBlocks.slice(0,2).map((x,i)=>`[access_raw_${i+1}] [${x.section}]\n${x.text}`).join('\n\n---\n\n')}`; }
} else if(precisionBlocks.length) {
context=`【Access Grounding｜SOFT】\n- 查詢類型：${kind}\n- 據點匹配：${site.status}${site.site?`（${site.site}）`:''}\n- 欄位匹配：${fieldMatch}\n- 可回答性：SOFT\n- Structured Facts 未能可靠拆欄位，因此保留精準 SOP 原文讓 AI 判讀；只能依原文回答，不得推測不存在的據點或數值。\n\n${precisionBlocks.slice(0,3).map((x,i)=>`[access_raw_${i+1}] [${x.section}]\n${x.text}`).join('\n\n---\n\n')}`;
} else {
context='本題沒有找到可確認的一般公司存取資訊。';
}
const selectedFacts=site.status==='NOT_FOUND'?[]:allowedFacts.slice(0,10).map((f,idx)=>({id:`access_fact_${idx+1}`,section:`${f.site?f.site+' · ':''}${f.fieldLabel}`,score:100,reason:'structured-fact'}));
const selectedRaw=site.status==='NOT_FOUND'?[]:(!allowedFacts.length?precisionBlocks.slice(0,3):(!exactFieldQuery?precisionBlocks.slice(0,2):[])).map((x,idx)=>({id:`access_raw_${idx+1}`,section:x.section,score:Number(x.score.toFixed(1)),reason:'precision-raw'}));
const selected=[...selectedFacts,...selectedRaw];
const matchConfidence=site.status==='NOT_FOUND'?'LOW':(topicMatch==='HIGH'?'HIGH':'LOW');
const coverageConfidence=answerability==='YES'?'HIGH':answerability==='PARTIAL'||answerability==='SOFT'?'MEDIUM':'LOW';
const contextTokens=context?sopRagEstimateTokens(context):0;
return {
context, staffContext:'',
grounding:{kind,site,requestedFields,allowedFacts,allFacts,knownSites,answerability,fieldMatch,siteMatch},
diagnostics:{
mode:site.status==='NOT_FOUND'?'ACCESS_ENTITY_MISS':(answerability==='NO'?'ACCESS_NO_DATA':'ACCESS_GROUNDED_RAG'), intent:'INTERNAL_ACCESS', answerDepth:'CONCISE',
sourceLabel:site.status==='NOT_FOUND'?'公司 SOP · 據點未命中':'公司 SOP · Access Grounding', sourcePlan:'ACCESS_GROUNDED_RAG',
confidence:coverageConfidence==='LOW'?'LOW':(coverageConfidence==='MEDIUM'?'MEDIUM':'HIGH'), matchConfidence,coverageConfidence,passes:1,score:selected[0]?.score||0,
topicMatch,siteMatch,fieldMatch,answerability,
fullTokens,contextTokens,savingsPct:fullTokens?Math.max(0,Math.round((1-contextTokens/fullTokens)*1000)/10):0,
selected,revision:meta?.revision||null,hash:meta?.contentHash||sopContentHash(safeSop),conflicts:[],staffCount:0,accessKind:kind,sopEvidenceActive:answerability!=='NO'
}
};
}

function sopRagRetrieve(question, sopContent, meta={}, history=[]) {
sopContent = filterSensitiveSop(sopContent);
meta = {...meta, contentHash: sopContentHash(sopContent)};
const accessKind=detectInternalAccessKind(question);
if(accessKind) return sopRagRetrieveInternalAccess(question,sopContent,meta,history,accessKind);
const index=sopRagBuildIndex(sopContent,meta);
const intentInfo=analyzeKnowledgeIntent(question,history);
const staff=intentInfo.intent==='ORGANIZATION'?buildSafeStaffDirectoryContext():{count:0,text:''};
if(intentInfo.intent==='FULL_ANALYSIS'){
const fullTokens=sopRagEstimateTokens(sopContent);
return { context:String(sopContent||''), staffContext:staff.text, diagnostics:{ mode:'FULL',intent:intentInfo.intent,answerDepth:intentInfo.depth,confidence:'FULL',matchConfidence:'FULL',coverageConfidence:'FULL',passes:1,score:100,savingsPct:0,fullTokens,contextTokens:fullTokens,selected:index.chunks.map(c=>({id:c.id,section:c.section,score:100,reason:'full'})).slice(0,80),revision:meta?.revision||null,hash:meta?.contentHash||'',conflicts:[],staffCount:staff.count } };
}
const retrievalExtraTerms = intentInfo.intent==='ORGANIZATION'
? ['同事','成員','人員','團隊','設計師','主任','主管','行政','會計','攝影師','總監']
: (intentInfo.intent==='PROCEDURE' && intentInfo.broad ? SOP_RAG_FLOW_STAGES : []);
const query=sopRagBuildQuery(question,history,retrievalExtraTerms);
const ranked=sopRagRank(index,query);
let matchConfidence=sopRagMatchConfidence(ranked,query);
const maxChars=SOP_RAG_CONFIG.budgets[intentInfo.intent]||SOP_RAG_CONFIG.budgets.GENERAL;
const selected=[]; const seen=new Set(); let passes=0;
for(let pass=1;pass<=SOP_RAG_CONFIG.maxPasses;pass++){
passes=pass;
sopRagSelectPass(ranked,index,query,intentInfo,pass,selected,seen,maxChars);
const coverage=sopRagCoverageConfidence(intentInfo,selected,index,staff.count);
if(coverage==='HIGH' || coverage==='FULL') break;
if(intentInfo.intent==='FACT' && matchConfidence!=='LOW') break;
}
selected.sort((a,b)=>a.chunk.index-b.chunk.index);
const coverageConfidence=sopRagCoverageConfidence(intentInfo,selected,index,staff.count);
const context=selected.map(x=>`[${x.chunk.id}] [${x.chunk.section}] [Lines ${x.chunk.startLine}-${x.chunk.endLine}]\n${x.chunk.content}`).join('\n\n---\n\n');
const fullTokens=sopRagEstimateTokens(sopContent), contextTokens=sopRagEstimateTokens(context);
const conflicts=sopRagConflictHints(selected);
const overall=(matchConfidence==='LOW'||coverageConfidence==='LOW')?'LOW':(matchConfidence==='MEDIUM'||coverageConfidence==='MEDIUM')?'MEDIUM':'HIGH';
return { context: context || '本題沒有找到足夠高相關度的 SOP 內容。', staffContext:staff.text, diagnostics:{ mode:'SMART_V2',intent:intentInfo.intent,answerDepth:intentInfo.depth,confidence:overall,matchConfidence,coverageConfidence,passes,score:ranked[0]?.score||0,fullTokens,contextTokens,savingsPct:fullTokens?Math.max(0,Math.round((1-contextTokens/fullTokens)*1000)/10):0,selected:selected.map(x=>({id:x.chunk.id,section:x.chunk.section,score:Number(x.score.toFixed(1)),reason:x.reason})),revision:meta?.revision||null,hash:meta?.contentHash||'',conflicts,staffCount:staff.count } };
}

function renderAnswerResourcePanel(plan, answerText = '') {
if (!plan) return '';
const photos = (plan.photos || []).filter(({ item }) => item?.name && !answerAlreadyEmbedsResource(answerText, 'images', item.name));
const documents = (plan.documents || []).filter(({ item }) => item?.name && !answerAlreadyEmbedsResource(answerText, 'documents', item.name));
if (!photos.length && !documents.length) return '';

const photosHtml = photos.length ? `
                <div class="answer-resource-photo-grid">
                    ${photos.map(({ item }) => {
                        const src = getInternalResourceUrl('images', item.name);
                        const title = escapeHtml(item.desc || item.name);
                        return `<span class="img-thumb-wrapper answer-photo-card" role="button" tabindex="0" data-src="${escapeHtml(src)}" data-caption="${title}" title="點擊展開放大檢視"><span class="answer-photo-media"><img src="${escapeHtml(src)}" alt="${title}" loading="lazy" decoding="async"><span class="img-thumb-badge"><i class="fa-solid fa-magnifying-glass-plus text-[9px]"></i><span>放大</span></span></span><span class="answer-photo-caption"><i class="fa-regular fa-image"></i><span>${title}</span></span></span>`;
                    }).join('')}
</div>` : '';

const docsHtml = documents.length ? `
                <div class="answer-resource-doc-list">
                    ${documents.map(({ item }) => {
                        const href = getInternalResourceUrl('documents', item.name);
                        const name = escapeHtml(item.name);
                        const desc = escapeHtml(item.desc || '內部文件');
                        return `<a class="answer-resource-doc" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" download><span class="answer-resource-doc-icon"><i class="fa-solid ${getResourceFileIcon(item.name)}"></i></span><span class="min-w-0"><span class="answer-resource-doc-name">${name}</span><span class="answer-resource-doc-desc">${desc}</span></span><i class="fa-solid fa-arrow-down text-[10px] text-neutral-500"></i></a>`;
                    }).join('')}
</div>` : '';

return `<div class="answer-resource-panel"><div class="answer-resource-title"><i class="fa-solid fa-folder-open text-violet-300"></i><span>內部參考資料</span><span class="answer-resource-subtitle">僅顯示高相關內部資料</span></div>${photosHtml}${docsHtml}</div>`;
}

function computeResponsiveChatDrawerGeometry() {
const vp = getResponsiveViewportMetrics();
const top = getChatSafeTop(vp.height);
const right = Math.round(clampUiNumber(vp.width * 0.007, 12, 24));
const bottom = Math.round(clampUiNumber(vp.height * 0.012, 14, 22));
const preferred = Number(currentUiSettings?.pc?.pcDrawerW) || 880;
const hardMax = Math.max(360, Math.min(1180, vp.width - right - 14, vp.width * 0.55));
const softMin = Math.min(hardMax, vp.width >= 1600 ? 760 : 620);
const ideal = Math.max(preferred, vp.width * 0.335);
const width = Math.round(clampUiNumber(ideal, softMin, hardMax));
const height = Math.round(Math.max(360, vp.height - top - bottom));
return { ...vp, top, right, bottom, width, height };
}

function clampCustomChatDrawerToViewport(drawer, geo = computeResponsiveChatDrawerGeometry()) {
if (!drawer || !drawer.classList.contains('custom-resized') || window.innerWidth < 768) return;
const rect = drawer.getBoundingClientRect();
if (!rect.width || !rect.height) return;
const vp = getResponsiveViewportMetrics();
const margin = 12;
const safeTop = window.innerWidth >= 1024 ? geo.top : margin;
const viewMaxW = Math.max(320, vp.width - margin * 2);
const viewMaxH = Math.max(300, vp.height - safeTop - geo.bottom);
const width = Math.min(rect.width, viewMaxW);
const height = Math.min(rect.height, viewMaxH);
const maxLeft = Math.max(margin, vp.width - margin - width);
const maxTop = Math.max(safeTop, vp.height - geo.bottom - height);
const left = clampUiNumber(rect.left, margin, maxLeft);
const top = clampUiNumber(rect.top, safeTop, maxTop);
drawer.style.width = `${Math.round(width)}px`;
drawer.style.height = `${Math.round(height)}px`;
drawer.style.left = `${Math.round(left)}px`;
drawer.style.top = `${Math.round(top)}px`;
drawer.style.right = 'auto';
drawer.style.bottom = 'auto';
drawer.style.transform = 'none';
}

function renderThumbnails() {
const bar = document.getElementById('multiImagePreviewBar');
const container = document.getElementById('thumbnailsContainer');
const badge = document.getElementById('multiImageCountBadge');

if (pendingImages.length === 0) {
bar.classList.add('hidden-view');
container.innerHTML = '';
return;
}

bar.classList.remove('hidden-view');
badge.textContent = `共 ${pendingImages.length} / 5 張照片`;
container.innerHTML = pendingImages.map(img => `
                <div class="relative group shrink-0">
                    <img src="${img.base64}" class="w-12 h-12 object-cover rounded-xl border border-white/20 shadow-md">
                    <button onclick="removePendingImage('${img.id}')" class="absolute -top-1.5 -right-1.5 bg-red-600 hover:bg-red-500 text-white w-4 h-4 rounded-full flex items-center justify-center text-[9px] shadow" title="移除">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            `).join('');
}

function renderPopularQuestions(state=loadPopularQuestionLocalState(),label='近期常問 · 自動更新') {
const grid=document.getElementById('popularQuestionsGrid'); if(!grid)return;
const questions=getPopularQuestionTop(state,4);
grid.innerHTML=questions.map((q,i)=>`<button type="button" class="leaves-ai-welcome-card" data-quick-rank="${String(i+1).padStart(2,'0')}" data-question="${escapeHtml(q)}" onclick="runQuickQuestion(this.dataset.question)"><strong>${escapeHtml(q)}</strong><span>${i===0?'團隊近期最常詢問':'點擊後直接送出給 LEAVES AI'}</span></button>`).join('');
const sync=document.getElementById('popularQuestionsSyncLabel'); if(sync)sync.textContent=label;
}
