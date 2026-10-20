// work/assistant-v46/shared.js
function assert(ok, message) {
  if (!ok) throw Error(message);
}
function taskId(cryptoApi = crypto) {
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const b = cryptoApi.getRandomValues(new Uint8Array(16));
  b[6] = b[6] & 15 | 64;
  b[8] = b[8] & 63 | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
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

// work/assistant-v46/task-executor.js
function parsePlan(raw, available) {
  assert(typeof raw === "string" && raw.length <= 24e3, "AI \u898F\u5283\u56DE\u61C9\u904E\u9577");
  let text = raw.trim();
  if (/^```(?:json)?\s*\n/i.test(text) && /\n```$/.test(text)) text = text.replace(/^```(?:json)?\s*\n/i, "").replace(/\n```$/, "");
  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    throw Error("AI \u672A\u56DE\u50B3\u6709\u6548\u64CD\u4F5C\u8A08\u756B\uFF0C\u672A\u57F7\u884C\u4EFB\u4F55\u4FEE\u6539\u3002\u8ACB\u8AAA\u660E\u76EE\u6A19\u5F8C\u91CD\u8A66\u3002");
  }
  keys(plan, ["version", "summary", "question", "steps"]);
  assert(plan.version === 1, "\u64CD\u4F5C\u8A08\u756B\u7248\u672C\u4E0D\u76F8\u5BB9");
  string(plan.summary, "\u4EFB\u52D9\u6458\u8981", { max: 300 });
  assert(typeof plan.question === "string" && plan.question.length <= 500, "\u6F84\u6E05\u5167\u5BB9\u683C\u5F0F\u932F\u8AA4");
  assert(Array.isArray(plan.steps) && plan.steps.length <= 12, "\u4E00\u6B21\u6700\u591A 12 \u500B\u64CD\u4F5C\u6B65\u9A5F");
  assert(!(plan.question && plan.steps.length), "\u9700\u8981\u6F84\u6E05\u6642\u4E0D\u80FD\u540C\u6642\u57F7\u884C\u64CD\u4F5C");
  for (const step of plan.steps) {
    keys(step, ["tool", "args"]);
    assert(available.has(step.tool), "AI \u8981\u6C42\u4E86\u672A\u63D0\u4F9B\u7684\u5DE5\u5177\uFF1A" + String(step.tool));
    assert(step.args && typeof step.args === "object" && !Array.isArray(step.args), "\u5DE5\u5177\u53C3\u6578\u683C\u5F0F\u932F\u8AA4");
  }
  assert(plan.steps.length || plan.question, "AI \u6C92\u6709\u63D0\u4F9B\u53EF\u57F7\u884C\u64CD\u4F5C\u6216\u6F84\u6E05\u554F\u984C");
  return plan;
}
function createExecutor({ session, registry, clock = Date.now, onProgress = () => {
} }) {
  let task = null, undo = null, busy = false, recovery = false;
  const report = (text, event) => {
    try {
      onProgress(text, event);
    } catch {
    }
  };
  const label = (key) => key === "quantity" ? "3D\u6750\u6599\u8349\u7A3F" : key === "quotation" ? "\u5831\u50F9\u8349\u7A3F" : key;
  const toolLabel = (name) => ({ "quantity.update": "\u8ABF\u6574\u6750\u6599\u78BA\u8A8D\u8868", "quantity.find": "\u67E5\u627E\u6A21\u578B\u6750\u8CEA", "quantity.view": "\u8ABF\u65743D\u6AA2\u8996", "quotation.update": "\u4FEE\u6539\u5831\u50F9\u9805\u76EE", "quotation.cell": "\u4FEE\u6539\u5831\u50F9\u6B04\u4F4D", "quotation.renumber": "\u6821\u6B63\u5831\u50F9\u9805\u6B21", "quotation.audit": "\u8A3A\u65B7\u5831\u50F9\u8349\u7A3F" })[name] || "\u6AA2\u67E5\u64CD\u4F5C";
  const alive = (token) => !!token && session() === token;
  const begin = () => {
    assert(!busy && !recovery, "\u4ECD\u5728\u57F7\u884C\u6216\u9700\u8981\u4EBA\u5DE5\u8655\u7406\u56DE\u5FA9");
    return { session: session(), at: clock(), bindings: new Map([...registry()].map(([key, a]) => [key, { adapter: a, stamp: a.stamp() }])) };
  };
  function valid(t, expected = t.before) {
    assert(alive(t.session), "\u767B\u5165\u6216\u6B0A\u9650\u5DF2\u6539\u8B8A\uFF0C\u8ACB\u91CD\u65B0\u5EFA\u7ACB\u4EFB\u52D9");
    assert(clock() - t.at < 6e5, "\u4EFB\u52D9\u5DF2\u8D85\u904E 10 \u5206\u9418\uFF0C\u8ACB\u91CD\u65B0\u5EFA\u7ACB");
    for (const [key, stamp] of expected) {
      assert(registry().get(key) === t.adapters.get(key), "\u5DE5\u5177\u7248\u672C\u5DF2\u6539\u8B8A");
      assert(t.adapters.get(key).stamp() === stamp, "\u8CC7\u6599\u3001\u5DE5\u4F5C\u8868\u3001\u8349\u7A3F\u6216\u6A21\u578B\u5DF2\u8B8A\u66F4\uFF0C\u8ACB\u91CD\u65B0\u7522\u751F\u5DEE\u7570");
    }
  }
  function prepare(plan, binding = begin()) {
    assert(!busy && !recovery, "\u4ECD\u5728\u57F7\u884C\u6216\u9700\u8981\u4EBA\u5DE5\u8655\u7406\u56DE\u5FA9");
    assert(alive(binding.session), "\u767B\u5165\u5DF2\u6539\u8B8A");
    task = null;
    const adapters = /* @__PURE__ */ new Map(), before = /* @__PURE__ */ new Map(), snapshots = /* @__PURE__ */ new Map(), after = /* @__PURE__ */ new Map(), rawChanges = /* @__PURE__ */ new Map(), results = [], effects = [], tools = /* @__PURE__ */ new Map();
    for (const [key, a] of registry()) for (const spec of a.tools) {
      assert(!tools.has(spec.name), "\u5DE5\u5177\u540D\u7A31\u91CD\u8907");
      tools.set(spec.name, { key, a });
    }
    let rawCount = 0;
    for (const step of plan.steps) {
      const entry = tools.get(step.tool);
      assert(entry, "\u5DE5\u5177\u4E0D\u53EF\u7528");
      const { key, a } = entry;
      if (!adapters.has(key)) {
        const bound = binding.bindings.get(key);
        assert(bound?.adapter === a && bound.stamp === a.stamp(), "AI \u898F\u5283\u671F\u9593\u8CC7\u6599\u5DF2\u8B8A\u66F4\uFF0C\u8ACB\u91CD\u65B0\u9001\u51FA");
        adapters.set(key, a);
        before.set(key, bound.stamp);
        const snapshot = a.capture();
        snapshots.set(key, snapshot);
        after.set(key, clone(snapshot));
        rawChanges.set(key, []);
      }
      report("\u6B63\u5728\u672C\u6A5F\u9810\u89BD\uFF1A" + toolLabel(step.tool), { phase: "preview", tool: step.tool });
      const out = a.simulate(after.get(key), step.tool, step.args);
      rawCount += (out.changes || []).length;
      assert(rawCount <= 500, "\u672C\u6B21\u5DEE\u7570\u8D85\u904E 500 \u7B46\uFF0C\u8ACB\u7E2E\u5C0F\u7BC4\u570D");
      report("\u5DF2\u5B8C\u6210\u9810\u89BD\uFF1A" + toolLabel(step.tool), { phase: "previewed", tool: step.tool });
      rawChanges.get(key).push(...out.changes || []);
      results.push(...out.results || []);
      effects.push(...out.effects || []);
    }
    const changes = [], changed = /* @__PURE__ */ new Set();
    for (const [key, a] of adapters) {
      const net = /* @__PURE__ */ new Map();
      for (const change of rawChanges.get(key)) {
        const id = change.key || change.target, prior = net.get(id);
        net.set(id, prior ? { ...change, before: prior.before } : change);
      }
      const final = [...net.values()].filter((change) => fingerprint(change.before) !== fingerprint(change.after));
      if (final.length) {
        changed.add(key);
        changes.push(...final);
      }
      results.push(...a.finalize?.(after.get(key), final) || []);
    }
    const current = { id: taskId(), session: binding.session, at: binding.at, summary: plan.summary, adapters, before, snapshots, after, changes, changed, results, effects, status: changes.length ? "pending" : "read-only" };
    valid(current);
    if (!changes.length) for (const effect of effects) {
      effect();
      report("\u5DF2\u5B8C\u6210\u672C\u6A5F\u6AA2\u8996\u52D5\u4F5C\u3002", { phase: "view-complete" });
    }
    task = current;
    return current;
  }
  function installAndVerify(t, key, snapshot) {
    const adapter = t.adapters.get(key);
    adapter.install(clone(snapshot));
    assert(adapter.content() === adapter.contentOf(snapshot), "\u5957\u7528\u5F8C\u8CC7\u6599\u9A57\u8B49\u5931\u6557\uFF1A" + key);
  }
  function apply() {
    const t = task;
    assert(t?.status === "pending", "\u6C92\u6709\u5F85\u540C\u610F\u7684\u4EFB\u52D9");
    assert(!busy && !recovery, "\u4ECD\u5728\u57F7\u884C\u6216\u9700\u8981\u4EBA\u5DE5\u8655\u7406\u56DE\u5FA9");
    valid(t);
    busy = true;
    t.status = "running";
    const installed = [];
    try {
      for (const key of t.changed) {
        report("\u6B63\u5728\u5957\u7528\uFF1A" + label(key), { phase: "applying", module: key });
        installed.push(key);
        installAndVerify(t, key, t.after.get(key));
        report("\u5DF2\u5957\u7528\u4E26\u6838\u5C0D\uFF1A" + label(key), { phase: "verified", module: key });
      }
      assert(alive(t.session), "\u767B\u5165\u6216\u6B0A\u9650\u5DF2\u6539\u8B8A");
      t.status = "applied";
      undo = { ...t, at: clock(), expected: new Map([...t.changed].map((key) => [key, t.adapters.get(key).stamp()])) };
      for (const effect of t.effects) try {
        effect();
        report("\u5DF2\u5B8C\u6210\u672C\u6A5F\u6AA2\u8996\u52D5\u4F5C\u3002", { phase: "view-complete" });
      } catch {
        t.results.push("\u8CC7\u6599\u5DF2\u5957\u7528\uFF0C\u4F463D\u6AA2\u8996\u52D5\u4F5C\u672A\u5B8C\u6210\u3002");
        report("\u8CC7\u6599\u5DF2\u5957\u7528\uFF0C\u4F463D\u6AA2\u8996\u52D5\u4F5C\u672A\u5B8C\u6210\u3002", { phase: "view-failed" });
      }
      return t;
    } catch (error) {
      let failed = false;
      for (const key of installed.reverse()) try {
        report("\u6B63\u5728\u56DE\u5FA9\uFF1A" + label(key), { phase: "rollback" });
        installAndVerify(t, key, t.snapshots.get(key));
        report("\u5DF2\u56DE\u5FA9\u4E26\u6838\u5C0D\uFF1A" + label(key), { phase: "rollback-verified" });
      } catch {
        failed = true;
      }
      recovery = failed;
      t.status = failed ? "recovery-required" : "failed";
      undo = null;
      throw Error(failed ? "\u56DE\u5FA9\u6838\u5C0D\u5931\u6557\uFF0C\u8ACB\u505C\u6B62\u7DE8\u8F2F\uFF0C\u4FDD\u7559\u539F\u59CB\u6A94\u8207\u76EE\u524D\u756B\u9762\u5F8C\u91CD\u65B0\u532F\u5165\u539F\u59CB\u6A94\u3002" : error.message + "\uFF1B\u5DF2\u6838\u5C0D\u4E26\u9084\u539F\u672C\u6B21\u5957\u7528\u3002");
    } finally {
      busy = false;
    }
  }
  function revert() {
    assert(undo && !busy && !recovery, "\u6C92\u6709\u53EF\u5FA9\u539F\u7684\u4EFB\u52D9");
    const t = undo;
    valid(t, t.expected);
    busy = true;
    const restored = [];
    try {
      for (const key of t.changed) {
        report("\u6B63\u5728\u5FA9\u539F\uFF1A" + label(key), { phase: "undoing" });
        restored.push(key);
        installAndVerify(t, key, t.snapshots.get(key));
        report("\u5DF2\u5FA9\u539F\u4E26\u6838\u5C0D\uFF1A" + label(key), { phase: "undo-verified" });
      }
      undo = null;
      task = null;
      return true;
    } catch (error) {
      let failed = false;
      for (const key of restored.reverse()) try {
        installAndVerify(t, key, t.after.get(key));
      } catch {
        failed = true;
      }
      undo = null;
      recovery = failed;
      if (failed) {
        task = t;
        t.status = "recovery-required";
      }
      throw Error(failed ? "\u5FA9\u539F\u53CA\u56DE\u5FA9\u6838\u5C0D\u5931\u6557\uFF0C\u8ACB\u505C\u6B62\u7DE8\u8F2F\u4E26\u4FDD\u7559\u539F\u59CB\u6A94\u3002" : error.message + "\uFF1B\u5DF2\u6838\u5C0D\u4E26\u4FDD\u7559\u539F\u5957\u7528\u5167\u5BB9\u3002");
    } finally {
      busy = false;
    }
  }
  return { begin, prepare, apply, revert, cancel() {
    assert(!busy, "\u4EFB\u52D9\u57F7\u884C\u4E2D");
    if (recovery) return;
    if (task) task.status = "cancelled";
    task = null;
  }, dispose() {
    task = null;
    undo = null;
    recovery = false;
  }, get task() {
    return task;
  }, get canUndo() {
    return !!undo && !recovery;
  }, get recoveryRequired() {
    return recovery;
  } };
}

// work/assistant-v46/planner.js
function plannerMessages(text, tools, clarifications = []) {
  return [{ role: "system", content: `\u4F60\u662F LEAVES \u7DB2\u7AD9\u64CD\u4F5C\u898F\u5283\u5668\uFF0C\u53EA\u56DE\u50B3\u4E00\u500B JSON\uFF0C\u4E0D\u8981 Markdown\uFF0C\u4E0D\u8981\u7A0B\u5F0F\u78BC\uFF0C\u4E0D\u8981\u8072\u7A31\u5B8C\u6210\u3002\u683C\u5F0F\uFF1A{"version":1,"summary":"\u7E41\u9AD4\u4E2D\u6587\u4EFB\u52D9\u6458\u8981","question":"\u7F3A\u5C11\u5FC5\u8981\u8CC7\u8A0A\u6642\u7684\u554F\u984C\uFF0C\u5426\u5247\u7A7A\u5B57\u4E32","steps":[{"tool":"\u5DE5\u5177\u540D\u7A31","args":{}}]}\u3002\u6700\u591A12\u6B65\u3002\u4E0D\u660E\u78BA\u5C31 question \u4E26 steps:[]\u3002\u53EA\u7528\u4E0B\u5217\u5DE5\u5177\uFF0C\u6309\u4F7F\u7528\u8005\u660E\u78BA\u6307\u793A\u7D44\u5408\uFF0C\u4E0D\u984D\u5916\u6539\u52D5\u3002\u7DB2\u7AD9\u6703\u5728\u672C\u6A5F\u89E3\u6790 selector \u4E26\u9A57\u8B49\u3001\u986F\u793A\u5DEE\u7570\u548C\u8981\u6C42\u78BA\u8A8D\u3002\u4F60\u6C92\u6709\u770B\u5230\u6A21\u578B\u6216\u5831\u50F9\u5167\u5BB9\uFF0C\u4E0D\u80FD\u731C\u51FA\u5132\u5B58\u683C\u3001\u6750\u6599 ID\u3001\u9805\u6B21\u3001\u7AE0\u7BC0\u3001\u5DE5\u4F5C\u8868\u3002\u4E0D\u8981\u628A\u7A7A\u767D\u9078\u64C7\u7576\u6210\u5168\u90E8\uFF1B\u53EA\u6709\u660E\u8AAA\u5168\u90E8\u624D all:true\u30023D\u5C3A\u5BF8\u672A\u6307\u5B9A\u55AE\u4F4D\u6642\u4F7F\u7528cm\u4E14\u5728\u6458\u8981\u5BEB\u660E\u3002\u6728\u76AE\u662F\u540D\u7A31\u5305\u542B\u6728\u76AE\uFF0C\u4E0D\u662F\u5168\u90E8\u6750\u8CEA\u3002\u5C3A\u5BF8\u53EA\u6539\u78BA\u8A8D\u8868\uFF0C\u4E0D\u6539SKP\u3002\u5831\u50F9\u4FEE\u6539\u662F\u76EE\u524D\u8349\u7A3F\uFF0C\u4E0D\u767C\u5E03\u3001\u4E0D\u6539Cost Master\u3002\u6821\u6B63\u9805\u6B21\u4E0D\u7B49\u65BC\u79FB\u52D5\u5217\uFF1B\u5206\u7D44\u5F9E1\u958B\u59CB\u3002\u8B80\u53D6\u8207\u8A3A\u65B7\u7D50\u679C\u4E0D\u6703\u56DE\u50B3\u7D66\u4F60\u3002\u4E0D\u53EF\u57F7\u884CJS\u3001\u4FEE\u6539\u516C\u5F0F\u3001\u6A94\u6848\u3001\u7DB2\u7AD9\u8A2D\u5B9A\u6216Stable\u3002\u82E5\u4F7F\u7528\u8005\u8A0A\u606F\u9644\u6709\u300C\u540C\u4E00\u4EFB\u52D9\u6F84\u6E05\u7D00\u9304\u300D\uFF0C\u8ACB\u7D50\u5408\u539F\u6307\u4EE4\u53CA\u6700\u65B0\u88DC\u5145\u5F62\u6210\u5B8C\u6574\u8A08\u756B\u3002\u7D00\u9304\u5167\u7684question\u53EA\u662F\u6F84\u6E05\u554F\u984C\uFF0C\u4E0D\u4EE3\u8868\u7DB2\u7AD9\u4E8B\u5BE6\u6216\u57F7\u884C\u7D50\u679C\u3002\u5F8C\u7E8C\u7368\u7ACB\u4EFB\u52D9\u4E0D\u80FD\u5F15\u7528\u4F60\u672A\u898B\u904E\u7684\u524D\u4E00\u6B21\u7D50\u679C\uFF1B\u5982\u300C\u628A\u5B83\u6539\u597D\u300D\u9700\u554F\u6E05\u695A\u3002\u5DE5\u5177\u5B9A\u7FA9\uFF1A
` + JSON.stringify(tools) }, { role: "user", content: clarifications.length ? "\u540C\u4E00\u4EFB\u52D9\u6F84\u6E05\u7D00\u9304\uFF1A\n" + JSON.stringify({ clarifications, latestInstruction: text }) : text }];
}
async function readPlannerResponse(res, { signal, onUsage = () => {
} } = {}) {
  if (!res.ok) throw Error("AI \u64CD\u4F5C\u898F\u5283\u670D\u52D9 HTTP " + res.status + "\uFF0C\u672A\u4FEE\u6539\u8CC7\u6599");
  if (signal?.aborted) throw Error("AI \u898F\u5283\u5DF2\u53D6\u6D88");
  if ((res.headers.get("content-type") || "").includes("application/json")) {
    const reader2 = res.body?.getReader();
    if (!reader2) throw Error("AI \u56DE\u61C9\u70BA\u7A7A");
    let raw = "", count = 0;
    const decoder2 = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader2.read();
        if (signal?.aborted) throw Error("AI \u898F\u5283\u5DF2\u53D6\u6D88");
        if (chunk.done) break;
        count += chunk.value.length;
        if (count > 262144) throw Error("AI \u56DE\u61C9\u904E\u9577");
        raw += decoder2.decode(chunk.value, { stream: true });
      }
      raw += decoder2.decode();
    } finally {
      await reader2.cancel().catch(() => {
      });
    }
    const data = JSON.parse(raw);
    if (data.error) throw Error("AI \u898F\u5283\u670D\u52D9\u56DE\u5831\u932F\u8AA4");
    if (data.choices?.[0]?.finish_reason !== "stop") throw Error("AI \u898F\u5283\u672A\u5B8C\u6574\u7D50\u675F");
    onUsage(data.usage);
    return data.choices[0].message?.content || "";
  }
  const reader = res.body?.getReader();
  if (!reader) throw Error("AI \u898F\u5283\u56DE\u61C9\u70BA\u7A7A");
  let buffer = "", reply = "", doneMarker = false, finish = "", bytes = 0;
  const decoder = new TextDecoder();
  function line(raw) {
    if (!raw.startsWith("data:")) return;
    const v = raw.slice(5).trim();
    if (v === "[DONE]") {
      doneMarker = true;
      return;
    }
    if (!v) return;
    let data;
    try {
      data = JSON.parse(v);
    } catch {
      throw Error("AI \u4E32\u6D41\u683C\u5F0F\u932F\u8AA4");
    }
    if (data.error) throw Error("AI \u898F\u5283\u670D\u52D9\u56DE\u5831\u932F\u8AA4");
    onUsage(data.usage);
    const c = data.choices?.[0];
    if (c?.finish_reason) finish = c.finish_reason;
    reply += c?.delta?.content || "";
    if (reply.length > 24e3) throw Error("AI \u8A08\u756B\u904E\u9577");
  }
  try {
    while (true) {
      if (signal?.aborted) throw Error("AI \u898F\u5283\u5DF2\u53D6\u6D88");
      const chunk = await reader.read();
      if (signal?.aborted) throw Error("AI \u898F\u5283\u5DF2\u53D6\u6D88");
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 524288) throw Error("AI \u4E32\u6D41\u904E\u9577");
      buffer += decoder.decode(chunk.value, { stream: true });
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, at).replace(/\r$/, ""));
        buffer = buffer.slice(at + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) line(buffer.trim());
    if (!doneMarker || finish !== "stop") throw Error("AI \u898F\u5283\u672A\u5B8C\u6574\u7D50\u675F\uFF0C\u672A\u57F7\u884C");
    return reply;
  } finally {
    await reader.cancel().catch(() => {
    });
  }
}

// work/assistant-v46/task-router.js
function isTaskCandidate(raw, { clarifying = false } = {}) {
  const text = String(raw || "").trim();
  if (!text || /^\//.test(text)) return false;
  if (/^[@＠](?:助手|assistant)\s*[:：]?/i.test(text)) return true;
  if (/(?:SOP|知識庫|通行碼|金鑰|登入|網站設定|Stable)/i.test(text)) return false;
  if (/^(?:你好|嗨|哈囉|謝謝|早安|午安|晚安|再見)[！!。\s]*$/.test(text)) return false;
  if (clarifying) return true;
  if (/(?:怎麼|如何|教我|操作方式|意思|原理)/.test(text) && !/(?:直接幫我|替我|幫我直接|現在幫我)/.test(text)) return false;
  const target = /(?:報價|估價|工作表|儲存格|[A-Z]{1,3}\d+|項次|向次|編號|序號|列項|工程|單價|數量|金額|複價|備註|材質|材料|木皮|板材|尺寸|損耗|確認表|3\s*D|SKP|模型)/i.test(text);
  const operation = /(?:改|調整|設成|設定|校正|修正|排好|排正確|重排|排序|重編|重新編|更新|統一|替換|取代|清空|刪除|新增|移動|檢查|診斷|偵錯|健檢|查詢|搜尋|尋找|找出|找一下|選取|選中|定位|置中|縮放|放大|顯示|開啟|打開|檢視|撤銷|復原|還原|匯出|儲存|保存|發布|套用|執行)/.test(text);
  const problem = /(?:哪[裡些]|有沒有|是否|找出|看看|看一下|幫我看).*(?:問題|錯誤|異常|不對)|(?:問題|錯誤|異常).*(?:哪|檢查|診斷)/.test(text);
  const dimensions = /(?:改|變|調|換).*(?:\d+(?:\.\d+)?\s*[x×*＊]\s*\d+|\d+\s*(?:cm|公分|%|％))/i.test(text);
  return target && (operation || problem || dimensions);
}

// work/assistant-v46/chat-ui.js
async function registerLeavesModule(context) {
  let disposed = false, planning = false, applying = false, serial = 0, thread = null, active = null, undoRecord = null, operationRecord = null, badge = null, observer = null;
  const records = [];
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== void 0) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  };
  const executor = createExecutor({ session: () => context.assistant.sessionToken(), registry: () => context.assistant.adapters(), onProgress: (text, event) => log(operationRecord || active, text, event?.phase || "operation") });
  const scroll = () => context.ui.scrollChatToBottom?.();
  const host = () => {
    const node = context.getChatContainer?.();
    if (!node) throw Error("\u804A\u5929\u8A0A\u606F\u5340\u5C1A\u672A\u5C31\u7DD2\uFF0C\u8ACB\u91CD\u65B0\u958B\u555F\u804A\u5929");
    return node;
  };
  function log(record, text, phase = "status") {
    if (!record || disposed) return;
    const item = el("li", void 0, "la-event"), time = el("time", (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    item.dataset.phase = phase;
    item.append(time, el("span", text));
    record.log.append(item);
    record.state.textContent = text;
    scroll();
  }
  function mount() {
    if (disposed) throw Error("\u52A9\u624B\u5DE5\u4F5C\u968E\u6BB5\u5DF2\u7D50\u675F");
    if (badge) return;
    badge = el("button", "\u64CD\u4F5C\u52A9\u624B\u5DF2\u555F\u52D5", "leaves-composer-tool la-ready");
    badge.type = "button";
    badge.dataset.assistantReady = "";
    badge.title = "\u76F4\u63A5\u63CF\u8FF0\u5831\u50F9\u62163D\u64CD\u4F5C\uFF1B\u5148\u6BD4\u8F03\u3001\u78BA\u8A8D\u5F8C\u57F7\u884C\u3002\u9EDE\u6B64\u67E5\u770B\u8AAA\u660E\u3002";
    badge.onclick = () => {
      const r = message("\u64CD\u4F5C\u52A9\u624B\u8AAA\u660E");
      r.state.textContent = "\u76F4\u63A5\u5728\u804A\u5929\u6846\u8AAA\u660E\u5831\u50F9\u62163D\u9700\u6C42\uFF0C\u4F8B\u5982\u300C\u8ACB\u5E6B\u6211\u628A\u6240\u6709\u6728\u76AE\u5C3A\u5BF8\u6539\u6210120\xD7240\u516C\u5206\u300D\u6216\u300C\u6AA2\u67E5\u5831\u50F9\u55AE\u7684\u9805\u6B21\u300D\u3002\u9700\u8981\u4FEE\u6539\u6642\uFF0C\u6703\u5148\u986F\u793A\u5DEE\u7570\uFF0C\u6309\u78BA\u8A8D\u624D\u5957\u7528\u3002\u4E00\u822C\u554F\u7B54\u7167\u5E38\u4F7F\u7528\uFF1B\u4E5F\u53EF\u4EE5\u7528\u300C@\u52A9\u624B\u300D\u660E\u78BA\u6307\u5B9A\u64CD\u4F5C\u3002";
      r.body.append(el("p", "\u6A21\u578B\u3001\u5831\u50F9\u5167\u5BB9\u8207\u672C\u6A5F\u8A3A\u65B7\u7D50\u679C\u4E0D\u6703\u81EA\u52D5\u9001\u7D66AI\u3002\u4FEE\u6539\u7684\u662F\u672C\u6A5F\u8349\u7A3F\uFF0C\u5B8C\u6210\u5F8C\u4ECD\u9700\u532F\u51FA\u4FDD\u5B58\u3002", "la-note"));
      scroll();
    };
    context.getComposerToolsHost().append(badge);
    const launcher = document.getElementById("leavesAssistantLauncher");
    if (launcher) launcher.hidden = true;
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => {
        if (active && !active.root.isConnected && (planning || thread || active.task?.status === "pending")) cancelActive("\u5C0D\u8A71\u5DF2\u6E05\u9664\uFF0C\u5F85\u57F7\u884C\u4EFB\u52D9\u5DF2\u53D6\u6D88\u3002");
      });
      observer.observe(host(), { childList: true });
    }
  }
  function message(instruction) {
    const root = el("section", void 0, "leaves-assistant la-message");
    root.dataset.localOnly = "true";
    root.setAttribute("aria-label", "\u64CD\u4F5C\u52A9\u624B\u4EFB\u52D9");
    if (instruction) root.append(el("div", instruction, "la-question"));
    const panel = el("div", void 0, "la-panel"), head = el("div", void 0, "la-head");
    head.append(el("strong", "LEAVES AI"), el("span", "\u672C\u6A5F\u4EFB\u52D9"));
    const state = el("p", "", "la-state");
    state.setAttribute("role", "status");
    state.setAttribute("aria-live", "polite");
    const logNode = el("ol", void 0, "la-log"), details = el("details", void 0, "la-events");
    details.open = true;
    details.append(el("summary", "\u64CD\u4F5C\u7D00\u9304"), logNode);
    const body = el("div", void 0, "la-body"), actions = el("div", void 0, "la-actions");
    panel.append(head, state, details, body, actions);
    root.append(panel);
    host().append(root);
    const r = { root, state, log: logNode, body, actions, task: null, buttons: {}, resultLimit: 100 };
    records.push(r);
    while (records.length > 30) {
      const i = records.findIndex((x) => x !== active && x !== undoRecord);
      if (i < 0) break;
      records.splice(i, 1)[0].root.remove();
    }
    scroll();
    return r;
  }
  function button(r, key, title, handler) {
    const b = el("button", title);
    b.type = "button";
    b.dataset.action = key;
    b.onclick = handler;
    r.buttons[key] = b;
    r.actions.append(b);
    return b;
  }
  function taskMessage(text) {
    const r = message(text);
    button(r, "apply", "\u78BA\u8A8D\u4FEE\u6539", () => apply(r));
    button(r, "cancel", "\u53D6\u6D88\u4EFB\u52D9", () => {
      if (active === r) cancelActive("\u5DF2\u53D6\u6D88\u4EFB\u52D9\uFF1B\u672A\u5957\u7528\u9019\u6B21\u4FEE\u6539\u3002");
    });
    button(r, "undo", "\u5FA9\u539F\u9019\u6B21\u4FEE\u6539", () => undo(r));
    return r;
  }
  function controls() {
    for (const r of records) {
      const pending = r === active && executor.task === r.task && r.task?.status === "pending";
      if (!r.buttons.apply) continue;
      r.buttons.apply.hidden = !pending;
      r.buttons.apply.disabled = planning || applying || executor.recoveryRequired || !pending;
      r.buttons.cancel.hidden = !(r === active && (planning || thread || pending));
      r.buttons.cancel.disabled = applying || executor.recoveryRequired;
      r.buttons.undo.hidden = r !== undoRecord || !executor.canUndo;
      r.buttons.undo.disabled = planning || applying || executor.task?.status === "pending" || executor.recoveryRequired;
    }
    if (badge) {
      badge.textContent = executor.recoveryRequired ? "\u64CD\u4F5C\u52A9\u624B\u9700\u8981\u8655\u7406" : applying ? "\u64CD\u4F5C\u52A9\u624B\u57F7\u884C\u4E2D" : planning ? "\u64CD\u4F5C\u52A9\u624B\u898F\u5283\u4E2D" : "\u64CD\u4F5C\u52A9\u624B\u5DF2\u555F\u52D5";
      badge.dataset.busy = String(planning || applying);
    }
  }
  function renderTask(r) {
    r.body.replaceChildren();
    const t = r.task;
    if (!t) {
      controls();
      return;
    }
    r.body.append(el("p", t.summary, "la-summary"));
    if (t.changes.length) {
      r.body.append(el("p", `\u5171 ${t.changes.length} \u7B46\u6B04\u4F4D\u5DEE\u7570\uFF1B\u4E0B\u5217\u5167\u5BB9\u662F\u672C\u6A5F\u8349\u7A3F\u7684\u5BE6\u969B\u6BD4\u8F03\u3002`, "la-note"));
      const wrap = el("div", void 0, "la-table-wrap");
      wrap.tabIndex = 0;
      wrap.setAttribute("aria-label", "\u4FEE\u6539\u524D\u5F8C\u6BD4\u8F03\uFF0C\u53EF\u5DE6\u53F3\u6372\u52D5");
      const table = el("table"), thead = el("thead"), tr = el("tr");
      for (const title of ["\u4F4D\u7F6E\uFF0F\u6B04\u4F4D", "\u4FEE\u6539\u524D", "\u4FEE\u6539\u5F8C"]) {
        const th = el("th", title);
        th.scope = "col";
        tr.append(th);
      }
      thead.append(tr);
      table.append(thead);
      const tbody = el("tbody");
      for (const c of t.changes) {
        const row = el("tr"), target = String(c.target).replace(/／(width|height|loss|note)$/, (m, k) => "\uFF0F" + { width: "\u5BEC\u5EA6\uFF08cm\uFF09", height: "\u9577\u5EA6\uFF08cm\uFF09", loss: "\u640D\u8017\uFF08%\uFF09", note: "\u5099\u8A3B" }[k]);
        row.append(el("td", target), el("td", c.before ?? ""), el("td", c.after ?? ""));
        tbody.append(row);
      }
      table.append(tbody);
      wrap.append(table);
      r.body.append(wrap);
    }
    for (const text of t.results.slice(0, r.resultLimit)) r.body.append(el("p", text, "la-result"));
    if (t.results.length > r.resultLimit) {
      const more = el("button", `\u986F\u793A\u66F4\u591A\uFF08\u76EE\u524D ${r.resultLimit}\uFF0F${t.results.length}\uFF09`, "la-more");
      more.type = "button";
      more.onclick = () => {
        r.resultLimit += 100;
        renderTask(r);
      };
      r.body.append(more);
    }
    controls();
  }
  function cancelActive(reason) {
    if (applying) return;
    serial++;
    thread = null;
    context.assistant.cancelPlanning();
    executor.cancel();
    planning = false;
    if (active) log(active, reason, "cancelled");
    controls();
  }
  const yieldToView = () => new Promise((resolve) => {
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 100);
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(finish, 0));
    else setTimeout(finish, 0);
  });
  async function apply(r) {
    if (disposed || applying || planning || r !== active || executor.task !== r.task || r.task?.status !== "pending") return;
    if (!context.assistant.guardMutation()) {
      log(r, "\u76EE\u524D\u7121\u6CD5\u4FEE\u6539\uFF1B\u672C\u6B21\u5167\u5BB9\u5C1A\u672A\u5957\u7528\u3002", "blocked");
      return;
    }
    applying = true;
    operationRecord = r;
    log(r, "\u5DF2\u6536\u5230\u78BA\u8A8D\uFF1B\u6E96\u5099\u5957\u7528\u4E26\u6838\u5C0D\u8CC7\u6599\u3002", "approved");
    controls();
    try {
      await yieldToView();
      if (disposed || r !== active || executor.task !== r.task) return;
      if (!r.root.isConnected) throw Error("\u5C0D\u8A71\u5DF2\u6E05\u9664\uFF0C\u78BA\u8A8D\u5DF2\u5931\u6548");
      if (!context.assistant.guardMutation()) throw Error("\u76EE\u524D\u6B0A\u9650\u4E0D\u5141\u8A31\u5957\u7528");
      executor.apply();
      undoRecord = r;
      thread = null;
      log(r, "\u4FEE\u6539\u5DF2\u5B8C\u6210\u4E26\u901A\u904E\u8CC7\u6599\u6838\u5C0D\u3002\u8ACB\u67E5\u770B\u5DE5\u4F5C\u53F0\uFF0C\u4E26\u532F\u51FA\u4FDD\u5B58\u8349\u7A3F\u3002", "complete");
    } catch (error) {
      if (!disposed) {
        log(r, "\u4FEE\u6539\u672A\u5B8C\u6210\uFF1A" + error.message, executor.recoveryRequired ? "recovery-required" : "failed");
        executor.cancel();
      }
    } finally {
      applying = false;
      operationRecord = null;
      if (!disposed) controls();
    }
  }
  async function undo(r) {
    if (disposed || planning || applying || !r.root.isConnected || r !== undoRecord || !executor.canUndo || executor.task?.status === "pending") return;
    if (!context.assistant.guardMutation()) {
      log(r, "\u76EE\u524D\u7121\u6CD5\u5FA9\u539F\uFF1B\u8CC7\u6599\u672A\u8B8A\u66F4\u3002", "blocked");
      return;
    }
    applying = true;
    operationRecord = r;
    log(r, "\u6E96\u5099\u5FA9\u539F\u9019\u6B21\u4FEE\u6539\uFF0C\u4E26\u6838\u5C0D\u8CC7\u6599\u3002", "undo-start");
    controls();
    try {
      await yieldToView();
      if (disposed) return;
      if (!r.root.isConnected) throw Error("\u5C0D\u8A71\u5DF2\u6E05\u9664\uFF0C\u8ACB\u5728\u5DE5\u4F5C\u53F0\u6838\u5C0D\u76EE\u524D\u8CC7\u6599");
      if (!context.assistant.guardMutation()) throw Error("\u76EE\u524D\u6B0A\u9650\u4E0D\u5141\u8A31\u5FA9\u539F");
      executor.revert();
      undoRecord = null;
      thread = null;
      log(r, "\u5DF2\u5FA9\u539F\u9019\u6B21\u4FEE\u6539\uFF0C\u4E26\u901A\u904E\u8CC7\u6599\u6838\u5C0D\u3002", "undone");
    } catch (error) {
      if (!disposed) log(r, "\u5FA9\u539F\u672A\u5B8C\u6210\uFF1A" + error.message, executor.recoveryRequired ? "recovery-required" : "failed");
    } finally {
      applying = false;
      operationRecord = null;
      if (!disposed) controls();
    }
  }
  function bindingsCurrent(binding) {
    if (binding.session !== context.assistant.sessionToken() || Date.now() - binding.at >= 6e5) return false;
    const adapters = context.assistant.adapters();
    return [...binding.bindings].every(([key, value]) => adapters.get(key) === value.adapter && value.adapter.stamp() === value.stamp);
  }
  async function handleTask(text, images = []) {
    mount();
    if (!images.length && executor.task?.status === "pending" && /^(?:好|好的|同意|確認|執行)[！!。\s]*$/.test(text)) return { handled: true, message: "\u8ACB\u5728\u9019\u6B21\u6BD4\u8F03\u4E0B\u65B9\u6309\u300C\u78BA\u8A8D\u4FEE\u6539\u300D\uFF0C\u78BA\u8A8D\u524D\u4E0D\u6703\u5957\u7528\u3002", keepInput: true };
    if (!images.length && (thread || executor.task?.status === "pending") && /^(?:請)?(?:取消|停止)(?:這個|這次|目前的)?(?:任務|操作|修改)?[！!。\s]*$/.test(text)) {
      cancelActive("\u5DF2\u53D6\u6D88\u4EFB\u52D9\uFF1B\u672A\u5957\u7528\u9019\u6B21\u4FEE\u6539\u3002");
      return { handled: true, rendered: true };
    }
    if (!isTaskCandidate(text, { clarifying: !!thread })) return null;
    if (applying || planning) return { handled: true, message: "\u4E0A\u4E00\u500B\u4EFB\u52D9\u4ECD\u5728\u8655\u7406\uFF0C\u8ACB\u7A0D\u5019\u3002", keepInput: true };
    if (executor.recoveryRequired) return { handled: true, message: "\u56DE\u5FA9\u6838\u5C0D\u9700\u8981\u4EBA\u5DE5\u8655\u7406\u3002\u8ACB\u4FDD\u7559\u539F\u59CB\u6A94\u8207\u76EE\u524D\u756B\u9762\uFF0C\u91CD\u65B0\u6574\u7406\u4E26\u532F\u5165\u539F\u59CB\u6A94\u5F8C\u518D\u64CD\u4F5C\u3002", keepInput: true };
    const token = context.assistant.sessionToken();
    if (!token) return { handled: true, message: "\u8ACB\u91CD\u65B0\u767B\u5165\u3002", keepInput: true };
    if (active && !active.root.isConnected) cancelActive("\u5C0D\u8A71\u5DF2\u6E05\u9664\uFF0C\u5F85\u57F7\u884C\u4EFB\u52D9\u5DF2\u53D6\u6D88\u3002");
    if (thread && !bindingsCurrent(thread.binding)) {
      cancelActive("\u6F84\u6E05\u671F\u9593\u8CC7\u6599\u6216\u5DE5\u4F5C\u8868\u5DF2\u6539\u8B8A\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u5B8C\u6574\u6307\u4EE4\u3002");
      return { handled: true, message: "\u8CC7\u6599\u5DF2\u6539\u8B8A\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u5B8C\u6574\u64CD\u4F5C\u6307\u4EE4\u3002", keepInput: true };
    }
    if (images.length) return { handled: true, message: "\u64CD\u4F5C\u6307\u4EE4\u76EE\u524D\u53EA\u63A5\u53D7\u6587\u5B57\u3002\u8ACB\u79FB\u9664\u9644\u5716\u5F8C\u91CD\u8A66\uFF1B\u9644\u5716\u5C1A\u672A\u9001\u51FA\u3002", keepInput: true };
    const previous = thread?.turns || [], binding = thread?.binding;
    if (active && (thread || executor.task?.status === "pending")) log(active, thread ? "\u5DF2\u6536\u5230\u88DC\u5145\uFF0C\u91CD\u65B0\u5EFA\u7ACB\u6BD4\u8F03\u3002" : "\u5DF2\u6539\u7528\u65B0\u7684\u6307\u4EE4\uFF1B\u4E0A\u4E00\u4EFD\u5F85\u78BA\u8A8D\u6BD4\u8F03\u5DF2\u5931\u6548\u3002", "superseded");
    executor.cancel();
    thread = null;
    const r = taskMessage(text);
    active = r;
    planning = true;
    const n = ++serial;
    log(r, "\u6B63\u5728\u7406\u89E3\u64CD\u4F5C\u6307\u4EE4\uFF1B\u5C1A\u672A\u4FEE\u6539\u8CC7\u6599\u3002", "planning");
    controls();
    try {
      const bound = binding || executor.begin(), tools = [...context.assistant.adapters().values()].filter((a) => a.stamp() !== "unavailable").flatMap((a) => a.tools);
      if (!tools.length) throw Error("\u8ACB\u5148\u958B\u555F\u5831\u50F9\u62163D\u6A21\u7D44\uFF0C\u532F\u5165\u8981\u64CD\u4F5C\u7684\u6A94\u6848\uFF1B\u5C1A\u672A\u6D3E\u9001AI\u898F\u5283");
      const messages = plannerMessages(text.replace(/^[@＠](?:助手|assistant)\s*[:：]?/i, ""), tools, previous);
      if (messages[1].content.length > 6e3) throw Error("\u6307\u4EE4\u8207\u6F84\u6E05\u5167\u5BB9\u904E\u9577\uFF0C\u8ACB\u53D6\u6D88\u5F8C\u7528\u8F03\u77ED\u7684\u5B8C\u6574\u6307\u4EE4\u91CD\u8A66");
      const raw = await context.assistant.plan(messages);
      if (disposed || n !== serial || token !== context.assistant.sessionToken() || !r.root.isConnected) {
        if (!disposed && n === serial) cancelActive("\u5DE5\u4F5C\u968E\u6BB5\u6216\u5C0D\u8A71\u5DF2\u8B8A\u66F4\uFF0C\u672A\u5957\u7528\u4FEE\u6539\u3002");
        return { handled: true, rendered: true };
      }
      const plan = parsePlan(raw, new Set(tools.map((tool) => tool.name)));
      log(r, "\u5DF2\u53D6\u5F97\u64CD\u4F5C\u8A08\u756B\uFF0C\u6B63\u5728\u672C\u6A5F\u6AA2\u67E5\u76EE\u6A19\u8207\u8CC7\u6599\u3002", "planned");
      if (plan.question) {
        if (previous.length >= 3) throw Error("\u5C1A\u7121\u6CD5\u78BA\u8A8D\u76EE\u6A19\uFF0C\u8ACB\u63D0\u4F9B\u9805\u76EE\u540D\u7A31\u8207\u8981\u6539\u6210\u7684\u5167\u5BB9\u5F8C\u91CD\u8A66");
        thread = { binding: bound, turns: [...previous, { instruction: text, question: plan.question }] };
        log(r, plan.question, "clarification");
        return { handled: true, rendered: true };
      }
      await yieldToView();
      if (disposed || n !== serial || token !== context.assistant.sessionToken() || !r.root.isConnected) return { handled: true, rendered: true };
      const t = executor.prepare(plan, bound);
      r.task = t;
      log(r, t.changes.length ? `\u5DF2\u7522\u751F ${t.changes.length} \u7B46\u5BE6\u969B\u5DEE\u7570\u3002\u8ACB\u6838\u5C0D\u5F8C\u6309\u300C\u78BA\u8A8D\u4FEE\u6539\u300D\u3002` : "\u672C\u6A5F\u64CD\u4F5C\u5DF2\u5B8C\u6210\uFF0C\u6C92\u6709\u8CC7\u6599\u5DEE\u7570\u9700\u8981\u78BA\u8A8D\u3002", t.changes.length ? "awaiting-approval" : "complete");
      renderTask(r);
      return { handled: true, rendered: true };
    } catch (error) {
      if (!disposed && n === serial) {
        log(r, "\u672A\u5957\u7528\u4FEE\u6539\uFF1A" + error.message, "failed");
        executor.cancel();
      }
      return { handled: true, rendered: true, keepInput: true };
    } finally {
      if (n === serial) planning = false;
      if (!disposed) controls();
    }
  }
  mount();
  return { async open() {
    mount();
    context.ui.openChat();
    return { ok: true };
  }, handleTask, get enabled() {
    return !disposed;
  }, async close() {
    if (!applying) cancelActive("\u5DF2\u53D6\u6D88\u5F85\u57F7\u884C\u4EFB\u52D9\u3002");
  }, async onSessionEnd() {
    disposed = true;
    serial++;
    thread = null;
    context.assistant.cancelPlanning();
    executor.dispose();
    observer?.disconnect();
    badge?.remove();
    for (const r of records) r.root.remove();
    badge = null;
    active = null;
    undoRecord = null;
  }, getStatus() {
    return { version: "0.2.0", enabled: !disposed, planning, applying, transactionState: executor.task?.status || "idle", localDataOnly: true, chatIntegrated: true };
  } };
}
export {
  readPlannerResponse,
  registerLeavesModule
};
