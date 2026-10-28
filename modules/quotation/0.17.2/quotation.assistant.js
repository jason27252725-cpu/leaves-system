import {isReviewIgnored} from './quotation.review-state.js';
import {quotationSequence} from './quotation.sequence.js';
import {customerSheets} from './quotation.visibility.js';
import {createQuotationOperations} from './quotation.operations.js';
import {createQuotationCalculation} from './quotation.calculation.js';
import {createQuotationAgent} from './quotation.agent.js';
import {parseExplicitCellCommand} from './quotation.commands.js';
// work/assistant-v45/shared.js
function assert(ok, message) {
  if (!ok) throw Error(message);
}
function clone(value, seen = /* @__PURE__ */ new Map()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || typeof Blob !== "undefined" && value instanceof Blob) return value;
  const out = value instanceof Map ? /* @__PURE__ */ new Map() : value instanceof Set ? /* @__PURE__ */ new Set() : Array.isArray(value) ? [] : {};
  seen.set(value, out);
  if (value instanceof Map) {
    for (const [k, v] of value) out.set(k, clone(v, seen));
  } else if (value instanceof Set) {
    for (const v of value) out.add(clone(v, seen));
  } else for (const [k, v] of Object.entries(value)) out[k] = ["XLSX", "original", "buffer", "sourceFile", "presentation"].includes(k) ? v : clone(v, seen);
  return out;
}
function plain(value) {
  if (value instanceof Map) return [...value].map(([k, v]) => [k, plain(v)]);
  if (value instanceof Set) return [...value];
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !["XLSX", "buffer", "sourceFile", "original", "presentation"].includes(k)).map(([k, v]) => [k, plain(v)]));
  return value;
}
var fingerprint = (value) => JSON.stringify(plain(value));
function keys(value, allowed) {
  assert(value && typeof value === "object" && !Array.isArray(value), "\u53C3\u6578\u5FC5\u9808\u662F\u7269\u4EF6");
  assert(Object.keys(value).every((k) => allowed.includes(k)), "\u6709\u4E0D\u652F\u63F4\u7684\u53C3\u6578");
}
function string(value, label, { optional = false, max = 120 } = {}) {
  if (optional && value == null) return "";
  assert(typeof value === "string" && value.trim().length > 0 && value.length <= max, label + "\u683C\u5F0F\u4E0D\u660E\u78BA");
  return value.trim();
}
function number(value, label, min = 0, max = 1e9) {
  assert(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max, label + "\u8D85\u51FA\u7BC4\u570D");
  return value;
}
function literal(value) {
  assert(typeof value === "string" || typeof value === "number", "\u53EA\u80FD\u586B\u5165\u6587\u5B57\u6216\u6578\u5B57");
  if (typeof value === "number") number(value, "\u6578\u503C", -1e9);
  else {
    assert(value.length <= 1e3, "\u6587\u5B57\u904E\u9577");
    assert(!/^\s*[=+@]/.test(value), "\u4E0D\u5141\u8A31\u8F38\u5165\u516C\u5F0F\u6216\u516C\u5F0F\u578B\u6587\u5B57");
  }
  return value;
}

// work/assistant-v45/quotation-tools.js
var itemTypes = ["QUOTE_ITEM", "BUNDLED_ITEM", "UNPRICED_ITEM", "CANCELLED_ITEM"];
function createQuotationTools({ context, workspace, workbook }) {
  const active = () => {
    assert(context.getSessionSnapshot?.().authenticated, "\u8ACB\u5148\u767B\u5165");
    const id = workspace.getActiveDraftId(), state = workspace.getRecord(id);
    assert(state?.model?.structured, "\u8ACB\u5148\u532F\u5165\u4E26\u958B\u555F\u53EF\u7DE8\u8F2F Excel \u5831\u50F9\u8349\u7A3F");
    if(!['owner','admin'].includes(context.accessRole)&&state.model.visibilityJournal?.size)workbook.restoreCustomerVisibility(state.model,'owner');
    return state;
  };
  const contentOf = (s) => fingerprint({ id: s.id, activeSheet: s.model.activeSheet, workbook: s.model.workbook, sheets: s.model.sheets, journal: s.model.editJournal, structural: s.model.structuralChanges, suggestions: s.suggestions });
  const current = () => {
    const s = active();
    return { id: workspace.getActiveDraftId(), model: s.model, suggestions: s.suggestions, updatedAt: s.draft.updatedAt };
  };
  const capture = () => clone(current());
  const visibleSheets = customerSheets;
  const sheet = (model, name) => {
    const target = name == null || name === "" ? model.activeSheet : string(name, "\u5DE5\u4F5C\u8868");
    const matches = visibleSheets(model).filter((s) => s.name === target || s.displayName === target);
    assert(matches.length === 1, "\u627E\u4E0D\u5230\u552F\u4E00\u7684\u53EF\u64CD\u4F5C\u5BA2\u6236\u5DE5\u4F5C\u8868\uFF08\u5167\u90E8\u6210\u672C\u8207\u96B1\u85CF\u5DE5\u4F5C\u8868\u4E0D\u958B\u653E\u52A9\u624B\u4FEE\u6539\uFF09");
    return matches[0];
  };
  function editable(model, sh, address) {
    const cell = workbook.getCell(model, sh.name, address), pos = model.XLSX.utils.decode_cell(address), r = sh.customerRange || sh.range;
    assert(pos.r >= r.s.r && pos.r <= r.e.r && pos.c >= r.s.c && pos.c <= r.e.c && !sh.hiddenRows.has(pos.r) && !sh.hiddenCols.has(pos.c), "\u53EA\u5141\u8A31\u4FEE\u6539\u53EF\u898B\u5BA2\u6236\u5831\u50F9\u7BC4\u570D");
    assert(cell, "\u76EE\u6A19\u5132\u5B58\u683C\u4E0D\u5B58\u5728");
    assert(!cell.formula, "\u516C\u5F0F\u53D7\u4FDD\u8B77\uFF0C\u8ACB\u4FEE\u6539\u4F86\u6E90\u6B04\u4F4D");
    for (const m of sh.merges || []) if (pos.r >= m.s.r && pos.r <= m.e.r && pos.c >= m.s.c && pos.c <= m.e.c) assert(pos.r === m.s.r && pos.c === m.s.c, "\u5408\u4F75\u5132\u5B58\u683C\u53EA\u80FD\u4FEE\u6539\u4E3B\u683C");
    return cell;
  }
  let edits = [];
  function change(s, sh, address, value, label, changes) {
    const cell = editable(s.model, sh, address);
    literal(value);
    if (Object.is(cell.value, value)) return;
    const old = cell.value;
    edits.push({ sheet: sh.name, address, value });
    changes.push({ key: sh.name + "!" + address, target: `${sh.displayName || sh.name}!${address} ${label}`, before: old, after: value });
  }
  function resolve(model, selector) {
    keys(selector, ["sheet", "section", "name", "itemNo", "all"]);
    if (selector.all !== void 0) assert(typeof selector.all === "boolean", "all \u5FC5\u9808\u662F\u5E03\u6797\u503C");
    assert(selector.all === true || selector.name || selector.itemNo !== void 0, "\u8ACB\u6307\u5B9A\u9805\u76EE\u540D\u7A31\u3001\u9805\u6B21\u6216\u660E\u78BA\u5168\u90E8");
    const sh = sheet(model, selector.sheet);
    if (selector.section !== void 0) string(selector.section, "\u7AE0\u7BC0");
    if (selector.name !== void 0) string(selector.name, "\u9805\u76EE\u540D\u7A31");
    if (selector.itemNo !== void 0) assert(typeof selector.itemNo === "number" && Number.isSafeInteger(selector.itemNo) && selector.itemNo > 0 || typeof selector.itemNo === "string" && selector.itemNo.length <= 20, "\u9805\u6B21\u683C\u5F0F\u932F\u8AA4");
    const rows = workbook.classifyRows(model, sh.name, "customer").filter((r) => itemTypes.includes(r.type) && (!selector.section || r.section === selector.section) && (!selector.name || String(r.itemName).toLowerCase().includes(selector.name.toLowerCase())) && (selector.itemNo === void 0 || String(r.itemNo).trim() === String(selector.itemNo)));
    assert(rows.length, "\u6C92\u6709\u7B26\u5408\u7684\u53EF\u7DE8\u8F2F\u5831\u50F9\u9805\u76EE");
    if (selector.all !== true) assert(rows.length === 1, "\u7B26\u5408\u591A\u500B\u9805\u76EE\uFF0C\u8ACB\u6307\u5B9A\u5DE5\u4F5C\u8868\uFF0F\u7AE0\u7BC0\uFF0C\u6216\u660E\u78BA\u8981\u6C42\u5168\u90E8\u7B26\u5408\u9805\u76EE");
    return { sh, rows };
  }
  const calculation=createQuotationCalculation({workbook,visibleSheets});
  const operations=createQuotationOperations({workbook,visibleSheets,sheet,editable,change,itemTypes,calculation,isIgnored:issue=>isReviewIgnored(active(),issue,workbook)});
  const agent=createQuotationAgent({workbook,visibleSheets,sheet,calculation,diagnose:operations.diagnose});
  function targetsFor(text){
    const s=active(),raw=String(text||''),qualified=[...raw.matchAll(/(?:'((?:[^']|'')+)'|([^\s!：，。；;「」【】（）()<>]{1,80}))!\s*(\$?[A-Z]{1,3}\$?[1-9]\d{0,5})/gi)];
    if(qualified.length)return[...new Map(qualified.map(m=>{let name=(m[1]||m[2]).replace(/''/g,"'");if(!m[1]&&!visibleSheets(s.model).some(sh=>sh.name===name||sh.displayName===name))name=name.replace(/^(?:(?:請|先|再|你|妳|我想要|我想|我要|希望|想要|麻煩|可以|能不能|能否|協助|幫我|替我|幫我們|把|將|針對|檢查|診斷|重算|重新計算|修正|修改|修好|看一下|處理|一下))+/,'');const sh=sheet(s.model,name),address=m[3].replace(/\$/g,'').toUpperCase();return[sh.name+'!'+address,{sheet:sh.name,address}];})).values()];
    const addresses=[...new Set([...raw.matchAll(/(?<![A-Z0-9])\$?([A-Z]{1,3})\$?([1-9]\d{0,5})(?![A-Z0-9])/gi)].map(m=>(m[1]+m[2]).toUpperCase()))];
    return addresses.length===1?[{sheet:sheet(s.model).name,address:addresses[0]}]:[];
  }
  function focus(){try{const a=active(),t=a.highlight;if(workspace.getStatus&& !workspace.getStatus().open)return null;if(!t||t.sheet!==a.model.activeSheet)return null;const sh=sheet(a.model,t.sheet);calculation.accessible(a.model,sh.name,t.address);return{module:'quotation',targets:[{sheet:sh.name,address:t.address}]};}catch{return null;}}
  const tools = [
    { name: "quotation.update", description: "\u4FEE\u6539\u76EE\u524D\u5831\u50F9\u8349\u7A3F\u9805\u76EE\u3002selector:{sheet?:\u5DE5\u4F5C\u8868\u7CBE\u78BA\u540D\u7A31,section?:\u7AE0\u7BC0\u7CBE\u78BA\u540D\u7A31,name?:\u540D\u7A31\u5305\u542B\u6587\u5B57,itemNo?:\u9805\u6B21,all?:\u660E\u78BA\u5168\u90E8\u7B26\u5408\u9805\u76EE}\uFF1Bchanges:{itemName?:\u6587\u5B57,qty?:\u975E\u8CA0\u6578,unitPrice?:\u975E\u8CA0\u6578,unit?:\u6587\u5B57,note?:\u6587\u5B57}\u3002\u4E0D\u652F\u63F4\u516C\u5F0F\u6216\u5167\u90E8\u6210\u672C\u3002" },
    { name: "quotation.cell", description: "\u4F7F\u7528\u8005\u660E\u78BA\u6307\u5B9A\u5132\u5B58\u683C\u6642\u4FEE\u6539\u65E2\u6709\u975E\u516C\u5F0F\u5BA2\u6236\u53EF\u898B\u683C\u3002args:{sheet?:\u5DE5\u4F5C\u8868\u7CBE\u78BA\u540D\u7A31,address:\u4F8B\u5982B12,value:\u6587\u5B57\u6216\u6578\u5B57}\u3002\u4E0D\u80FD\u731Caddress\u3002" },
    ...operations.tools
  ];
  let inspection=null,inspectionSerial=0;const issueRefs=new Map();
  const adapter={ tools, agent, focus, targetsFor,
    issueRef(index){const s=active(),issue=s.audit?.issues?.[index];assert(issue,'問題已不存在，請重新檢查');const target={sheet:issue.sheet,address:issue.address};calculation.accessible(s.model,target.sheet,target.address);const ref='leaves-issue-'+(crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''));issueRefs.set(ref,{target,stamp:adapter.stamp(),session:context.assistant.sessionToken(),at:Date.now(),message:issue.message});while(issueRefs.size>100)issueRefs.delete(issueRefs.keys().next().value);return ref;},
    resolveIssue(ref){const i=issueRefs.get(ref);assert(i&&Date.now()-i.at<600000&&i.session===context.assistant.sessionToken()&&i.stamp===adapter.stamp(),'問題附件已失效；請從目前報價重新拖入');calculation.accessible(active().model,i.target.sheet,i.target.address);return clone(i);},
    sequence:quotationSequence({workbook,calculation,clone,fingerprint,assert}),
    lockExecution(value){workspace.lockExecution?.(value);},
    focusStep(target){workspace.focusStep?.(target);},
    explicitPlan(text){return parseExplicitCellCommand(text,{targetsFor,readCell:target=>{const s=active(),sh=sheet(s.model,target.sheet);calculation.accessible(s.model,sh.name,target.address);return editable(s.model,sh,target.address);}});},
    inspectLocal(){
      const snapshot=capture(),issues=operations.diagnose(snapshot,'all');
      inspection={id:'inspection-'+(++inspectionSerial)+'-'+Date.now(),at:Date.now(),session:context.assistant?.sessionToken?.()||'',stamp:adapter.stamp(),scope:'all',diagnostic:{module:'quotation',issues}};
      const groups=new Map();for(const i of issues){const key=i.repairKind?'可預覽修正':'待決定／資訊';groups.set(key,(groups.get(key)||0)+1);}
      const limit=100,message=`報價唯讀檢查｜Quotation ${context.moduleVersion||'0.17.2'}\n本機規則發現 ${issues.length} 項提醒；${groups.get('可預覽修正')||0} 項可預覽修正，${groups.get('待決定／資訊')||0} 項需補充或判斷。未修改資料，沒有送出AI分析。\n`+issues.slice(0,limit).map(i=>`${i.sheet}!${i.address} ${i.message} ${i.repairKind?'可預覽修正。':i.reason}`).join('\n')+(issues.length>limit?`\n此處顯示前${limit}項；已保存完整${issues.length}項檢查範圍。`:'')+'\n可接著說「好，你列出來的都幫我修改」，先預覽可確定的部分；缺價及尚未具備依據的項目仍需決定。這不是完整工程驗收。';
      return{id:inspection.id,message};
    },lastInspection:()=>inspection,clearInspection(){inspection=null;},
    inspect(){return {module:'quotation',issues:operations.diagnose(capture(),'all')};}, describe(){try{const s=active(),visible=visibleSheets(s.model);return{ready:visible.length>0,message:visible.length?'報價草稿已就緒（0.17.2，支援AI查詢與確認修改）':'沒有可操作的客戶工作表'};}catch(error){return{ready:false,message:error.message};}}, capture, contentOf, content() {
    return contentOf(current());
  }, stamp() {
    try {
      return context.getSessionSnapshot().accessRole + "|" + contentOf(current());
    } catch {
      return "unavailable";
    }
  }, install(s) {
    const a = active();
    assert(workspace.getActiveDraftId() === s.id, "\u76EE\u524D\u8349\u7A3F\u5DF2\u5207\u63DB");
    a.model = s.model;
    a.suggestions = s.suggestions;
    a.draft.updatedAt = s.updatedAt;
    workspace.refreshAssistant();
  }, finalize(s, changes) {
    if (!changes.length) return [];
    s.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    let count = 0;
    for (const suggestion of s.suggestions.values()) if (suggestion.status === "pending") {
      suggestion.status = "rejected";
      suggestion.reason = "AI\u4EFB\u52D9\u4FEE\u6539\u5F8C\uFF0C\u820A\u5EFA\u8B70\u5DF2\u5931\u6548";
      count++;
    }
    return count ? [`\u5957\u7528\u6642\u6703\u53D6\u6D88 ${count} \u7B46\u820A\u5F85\u78BA\u8A8D\u5EFA\u8B70\uFF0C\u4EE5\u514D\u5F8C\u7E8C\u8AA4\u8986\u84CB\uFF1B\u5FA9\u539F\u53EF\u4E00\u4F75\u9084\u539F\u3002`] : [];
  }, simulate(s, tool, args) {
    const changes = [], results = [], diagnostics=[];let outcome,formulaTargets=[];
    edits = [];
    if (tool === "quotation.update") {
      keys(args, ["selector", "changes"]);
      keys(args.changes, ["itemName", "qty", "unitPrice", "unit", "note"]);
      assert(Object.keys(args.changes).length, "\u672A\u6307\u5B9A\u4FEE\u6539\u5167\u5BB9");
      for (const [k, v] of Object.entries(args.changes)) {
        if (["qty", "unitPrice"].includes(k)) number(v, k);
        else {
          assert(typeof v === "string", "\u6587\u5B57\u6B04\u4F4D\u53EA\u80FD\u586B\u6587\u5B57");
          literal(v);
        }
      }
      const { sh, rows } = resolve(s.model, args.selector), schema = workbook.inferTableSchema(s.model, sh.name, "customer");
      assert(schema.confidence >= 3, "\u6B04\u4F4D\u5224\u8B80\u53EF\u4FE1\u5EA6\u4E0D\u8DB3\uFF0C\u8ACB\u6307\u5B9A\u5132\u5B58\u683C");
      for (const row of rows) for (const [k, v] of Object.entries(args.changes)) {
        const col = schema.columns[k];
        assert(col != null, "\u7F3A\u5C11\u6B04\u4F4D\uFF1A" + k);
        change(s, sh, workbook.columnAddress(s.model, col, row.row), v, row.itemName + "\uFF0F" + k, changes);
      }
    } else if (tool === "quotation.cell") {
      keys(args, ["sheet", "address", "value"]);
      assert(typeof args.address === "string" && /^[A-Z]{1,3}[1-9]\d{0,5}$/.test(args.address), "\u8ACB\u6307\u5B9A\u660E\u78BA\u7684\u5132\u5B58\u683C\u4F4D\u7F6E");
      change(s, sheet(s.model, args.sheet), args.address, args.value, "", changes);
    } else if (['quotation.renumber','quotation.audit','quotation.repair','quotation.recalculate','quotation.decisions'].includes(tool)) {
      const out=operations.run(s,tool,args,changes);results.push(...out.results);diagnostics.push(...out.diagnostics);outcome=out.outcome;formulaTargets=out.formulaTargets||[];
    } else throw Error('不支援的報價工具');
    if (edits.length) workbook.applyCellBatch(s.model, edits);
    if(edits.length||formulaTargets.length){
      const out=calculation.apply(s.model,{targets:formulaTargets,changed:edits.map(e=>e.sheet+'!'+e.address)});changes.push(...out.changes);
      if(out.changes.length)results.push(`已將 ${out.changes.length} 筆既有公式重算／連動差異列入比較；尚未修改實際草稿。`);
      if(out.blocked.length){outcome='needs-input';results.push(...out.blocked.map(b=>`待決定：${b.sheet}!${b.address} ${b.reason}`));}
      else if(!changes.length&&tool==='quotation.recalculate')outcome='no-change';
    }
    return { changes, results, diagnostics, outcome };
  } };return adapter;
}
export {
  createQuotationTools
};
