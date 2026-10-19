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
  } else for (const [k, v] of Object.entries(value)) out[k] = ["XLSX", "original", "buffer", "sourceFile"].includes(k) ? v : clone(v, seen);
  return out;
}
function plain(value) {
  if (value instanceof Map) return [...value].map(([k, v]) => [k, plain(v)]);
  if (value instanceof Set) return [...value];
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !["XLSX", "buffer", "sourceFile", "original"].includes(k)).map(([k, v]) => [k, plain(v)]));
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
    return state;
  };
  const contentOf = (s) => fingerprint({ id: s.id, activeSheet: s.model.activeSheet, workbook: s.model.workbook, sheets: s.model.sheets, journal: s.model.editJournal, structural: s.model.structuralChanges, suggestions: s.suggestions });
  const current = () => {
    const s = active();
    return { id: workspace.getActiveDraftId(), model: s.model, suggestions: s.suggestions, updatedAt: s.draft.updatedAt };
  };
  const capture = () => clone(current());
  const visibleSheets = (model) => model.sheets.filter((s) => !model.workbook.Workbook?.Sheets?.find((x) => x.name === s.name)?.Hidden && !/(成本|內部|廠商|毛利|利潤|cost)/i.test(s.displayName || s.name));
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
  const tools = [
    { name: "quotation.update", description: "\u4FEE\u6539\u76EE\u524D\u5831\u50F9\u8349\u7A3F\u9805\u76EE\u3002selector:{sheet?:\u5DE5\u4F5C\u8868\u7CBE\u78BA\u540D\u7A31,section?:\u7AE0\u7BC0\u7CBE\u78BA\u540D\u7A31,name?:\u540D\u7A31\u5305\u542B\u6587\u5B57,itemNo?:\u9805\u6B21,all?:\u660E\u78BA\u5168\u90E8\u7B26\u5408\u9805\u76EE}\uFF1Bchanges:{itemName?:\u6587\u5B57,qty?:\u975E\u8CA0\u6578,unitPrice?:\u975E\u8CA0\u6578,unit?:\u6587\u5B57,note?:\u6587\u5B57}\u3002\u4E0D\u652F\u63F4\u516C\u5F0F\u6216\u5167\u90E8\u6210\u672C\u3002" },
    { name: "quotation.cell", description: "\u4F7F\u7528\u8005\u660E\u78BA\u6307\u5B9A\u5132\u5B58\u683C\u6642\u4FEE\u6539\u65E2\u6709\u975E\u516C\u5F0F\u5BA2\u6236\u53EF\u898B\u683C\u3002args:{sheet?:\u5DE5\u4F5C\u8868\u7CBE\u78BA\u540D\u7A31,address:\u4F8B\u5982B12,value:\u6587\u5B57\u6216\u6578\u5B57}\u3002\u4E0D\u80FD\u731Caddress\u3002" },
    { name: "quotation.renumber", description: '\u4F9D\u76EE\u524D\u5217\u7684\u9806\u5E8F\u6821\u6B63\u963F\u62C9\u4F2F\u6578\u5B57\u9805\u6B21\uFF0C\u6BCF\u500B\u7AE0\u7BC0\uFF0F\u5340\u57DF\u5F9E1\u958B\u59CB\u3002\u4E0D\u79FB\u52D5\u5217\uFF0C\u4E0D\u8655\u7406\u96B1\u85CF\u5217\uFF1Bargs:{scope:"active"\u6216"all"}\uFF0C\u672A\u660E\u8AAA\u5168\u90E8\u5DE5\u4F5C\u8868\u7528active\u3002' },
    { name: "quotation.audit", description: "\u672C\u6A5F\u898F\u5247\u8A3A\u65B7\u76EE\u524D\u5831\u50F9\u8349\u7A3F\uFF0C\u4E0D\u628A\u5167\u5BB9\u50B3\u7D66\u6A21\u578B\u3001\u4E0D\u81EA\u52D5\u4FEE\u6B63\uFF1Bargs:{}\u3002\u7D50\u679C\u542B\u4F4D\u7F6E\u8207\u554F\u984C\u3002" }
  ];
  return { tools, capture, contentOf, content() {
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
    const changes = [], results = [];
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
    } else if (tool === "quotation.renumber") {
      keys(args, ["scope"]);
      assert(["active", "all"].includes(args.scope), "\u8ACB\u6307\u5B9A active \u6216 all");
      for (const sh of args.scope === "all" ? visibleSheets(s.model) : [sheet(s.model)]) {
        const range = sh.customerRange || sh.range, schema = workbook.inferTableSchema(s.model, sh.name, "customer");
        if (schema.columns.itemNo == null || schema.confidence < 3) {
          results.push(`${sh.displayName}\uFF1A\u672A\u8FA8\u8B58\u5230\u9805\u6B21\u8868\u683C\uFF0C\u7565\u904E\u3002`);
          continue;
        }
        assert(![...sh.hiddenRows].some((r) => r > schema.headerRow && r <= range.e.r), "\u5DE5\u4F5C\u8868\u542B\u96B1\u85CF\u5217\uFF0C\u4E0D\u80FD\u81EA\u52D5\u6C7A\u5B9A\u662F\u5426\u7D0D\u5165\u7DE8\u865F\uFF1A" + sh.displayName);
        let n = 0;
        for (const row of workbook.classifyRows(s.model, sh.name, "customer")) {
          if (["SECTION", "AREA_HEADER", "SUBTOTAL", "SUMMARY"].includes(row.type)) {
            n = 0;
            continue;
          }
          if (!itemTypes.includes(row.type)) continue;
          assert(/^\d+$/.test(String(row.itemNo).trim()), "\u542B\u7A7A\u767D\u6216\u975E\u963F\u62C9\u4F2F\u6578\u5B57\u9805\u6B21\uFF0C\u8ACB\u5148\u6307\u5B9A\u7DE8\u865F\u898F\u5247\uFF1A" + sh.displayName + " \u7B2C" + (row.row + 1) + "\u5217");
          n++;
          change(s, sh, workbook.columnAddress(s.model, schema.columns.itemNo, row.row), n, row.itemName + "\uFF0F\u9805\u6B21", changes);
        }
      }
      results.push("\u9805\u6B21\u6309\u539F\u5217\u9806\u5E8F\u3001\u6BCF\u500B\u7AE0\u7BC0\uFF0F\u5340\u57DF\u5F9E 1 \u958B\u59CB\uFF1B\u6C92\u6709\u79FB\u52D5\u4EFB\u4F55\u5217\u3002");
    } else if (tool === "quotation.audit") {
      keys(args, []);
      const audit = workbook.audit({ ...s.model, sheets: visibleSheets(s.model) }, { viewMode: "customer" });
      results.push(`\u672C\u6A5F\u898F\u5247\u6AA2\u67E5\uFF1A${audit.issues?.length || 0} \u9805\u63D0\u9192\u3002\u9019\u4E0D\u662F\u5DE5\u7A0B\u6216\u5831\u50F9\u6B63\u78BA\u6027\u7684\u5168\u9762\u4FDD\u8B49\u3002`);
      for (const issue of audit.issues || []) results.push(`${issue.sheet}!${issue.address || "R" + (issue.row + 1)} [${issue.code}] ${issue.message}`);
    } else throw Error("\u4E0D\u652F\u63F4\u7684\u5831\u50F9\u5DE5\u5177");
    if (edits.length) workbook.applyCellBatch(s.model, edits);
    return { changes, results };
  } };
}
export {
  createQuotationTools
};
