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

// work/assistant-v45/task-executor.js
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
      const out = a.simulate(after.get(key), step.tool, step.args);
      rawCount += (out.changes || []).length;
      assert(rawCount <= 500, "\u672C\u6B21\u5DEE\u7570\u8D85\u904E 500 \u7B46\uFF0C\u8ACB\u7E2E\u5C0F\u7BC4\u570D");
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
    const current = { id: crypto.randomUUID(), session: binding.session, at: binding.at, summary: plan.summary, adapters, before, snapshots, after, changes, changed, results, effects, status: changes.length ? "pending" : "read-only" };
    valid(current);
    if (!changes.length) for (const effect of effects) effect();
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
        onProgress("\u6B63\u5728\u5957\u7528\uFF1A" + key);
        installed.push(key);
        installAndVerify(t, key, t.after.get(key));
      }
      assert(alive(t.session), "\u767B\u5165\u6216\u6B0A\u9650\u5DF2\u6539\u8B8A");
      t.status = "applied";
      undo = { ...t, at: clock(), expected: new Map([...t.changed].map((key) => [key, t.adapters.get(key).stamp()])) };
      for (const effect of t.effects) try {
        effect();
      } catch {
        t.results.push("\u8CC7\u6599\u5DF2\u5957\u7528\uFF0C\u4F463D\u6AA2\u8996\u52D5\u4F5C\u672A\u5B8C\u6210\u3002");
      }
      return t;
    } catch (error) {
      let failed = false;
      for (const key of installed.reverse()) try {
        installAndVerify(t, key, t.snapshots.get(key));
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
        restored.push(key);
        installAndVerify(t, key, t.snapshots.get(key));
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

// work/assistant-v45/planner.js
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

// work/assistant-v45/assistant-ui.js
async function registerLeavesModule(context) {
  let mode = false, disposed = false, planning = false, root = null, toggle = null, serial = 0, thread = null, resultLimit = 100;
  const executor = createExecutor({ session: () => context.assistant.sessionToken(), registry: () => context.assistant.adapters(), onProgress: (text) => status(text) });
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== void 0) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const status = (text) => {
    const node = root?.querySelector("[data-status]");
    if (node) node.textContent = text;
  };
  function setMode(enabled) {
    mode = enabled;
    toggle.setAttribute("aria-pressed", String(mode));
    toggle.classList.toggle("la-on", mode);
    root.hidden = !mode;
    if (!mode) {
      serial++;
      thread = null;
      executor.cancel();
    }
  }
  function mount() {
    if (disposed) throw Error("\u52A9\u624B\u5DE5\u4F5C\u968E\u6BB5\u5DF2\u7D50\u675F");
    if (root) return;
    toggle = el("button", "AI \u64CD\u4F5C", "leaves-composer-tool");
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "false");
    toggle.title = "\u958B\u555F\u5F8C\uFF0C\u5728\u804A\u5929\u6846\u63CF\u8FF0\u64CD\u4F5C\uFF0C\u6AA2\u67E5\u5DEE\u7570\u5F8C\u518D\u540C\u610F";
    toggle.onclick = () => {
      if (!planning) {
        setMode(!mode);
        render();
      }
    };
    context.getComposerToolsHost().append(toggle);
    root = el("section", void 0, "leaves-assistant");
    root.hidden = true;
    root.setAttribute("aria-label", "AI \u4EFB\u52D9\u9810\u89BD\u8207\u78BA\u8A8D");
    const head = el("div", void 0, "la-head");
    head.append(el("strong", "LEAVES \u64CD\u4F5C\u52A9\u624B"), el("span", "\u5148\u6BD4\u8F03\u30FB\u518D\u540C\u610F\u30FB\u53EF\u5FA9\u539F"));
    root.append(head);
    root.append(el("p", "AI \u53EA\u6536\u5230\u4F60\u8F38\u5165\u7684\u64CD\u4F5C\u6307\u4EE4\u8207\u6F84\u6E05\u5C0D\u8A71\u3002\u6A94\u6848\u5167\u5BB9\u3001\u6A21\u578B\u8207\u67E5\u8A62\u7D50\u679C\u4FDD\u7559\u672C\u6A5F\u3002", "la-privacy"));
    const state = el("p", "\u5148\u958B\u555F\u5831\u50F9\u62163D\u5DE5\u4F5C\u53F0\uFF0C\u518D\u5728\u804A\u5929\u6846\u63CF\u8FF0\u64CD\u4F5C\u3002");
    state.dataset.status = "";
    state.setAttribute("role", "status");
    state.setAttribute("aria-live", "polite");
    root.append(state);
    const body = el("div", void 0, "la-body");
    body.dataset.body = "";
    root.append(body);
    const actions = el("div", void 0, "la-actions");
    for (const [id, title] of [["apply", "\u540C\u610F\u4FEE\u6539"], ["cancel", "\u53D6\u6D88\u4EFB\u52D9"], ["undo", "\u5FA9\u539F\u4E0A\u6B21\u4EFB\u52D9"]]) {
      const button = el("button", title);
      button.type = "button";
      button.dataset.action = id;
      actions.append(button);
    }
    root.append(actions);
    root.querySelector("[data-action=apply]").onclick = () => {
      try {
        if (!context.assistant.guardMutation()) return;
        executor.apply();
        thread = null;
        status("\u5DF2\u5957\u7528\u4E26\u6838\u5C0D\u8CC7\u6599\u3002\u8ACB\u67E5\u770B\u5DE5\u4F5C\u53F0\uFF0C\u5B8C\u6210\u5F8C\u532F\u51FA\u8349\u7A3F\u3002");
      } catch (error) {
        status("\u672A\u5B8C\u6210\uFF1A" + error.message);
        executor.cancel();
      }
      render();
    };
    root.querySelector("[data-action=cancel]").onclick = () => {
      serial++;
      thread = null;
      context.assistant.cancelPlanning();
      executor.cancel();
      status("\u5DF2\u53D6\u6D88\u5F85\u57F7\u884C\u4EFB\u52D9\uFF1B\u6C92\u6709\u5957\u7528\u9019\u6B21\u4FEE\u6539\u3002");
      render();
    };
    root.querySelector("[data-action=undo]").onclick = () => {
      try {
        if (!context.assistant.guardMutation()) return;
        executor.revert();
        thread = null;
        status("\u5DF2\u5FA9\u539F\u4E0A\u4E00\u500B\u4EFB\u52D9\uFF0C\u4E26\u6838\u5C0D\u8CC7\u6599\u3002");
      } catch (error) {
        status("\u4E0D\u80FD\u5FA9\u539F\uFF1A" + error.message);
      }
      render();
    };
    context.getComposerDock().before(root);
    render();
  }
  function render() {
    if (!root) return;
    const task = executor.task, body = root.querySelector("[data-body]");
    body.replaceChildren();
    if (task) {
      body.append(el("p", task.summary, "la-summary"));
      if (task.changes.length) {
        const table = el("table"), thead = el("thead"), tr = el("tr");
        for (const title of ["\u4F4D\u7F6E\uFF0F\u6B04\u4F4D", "\u4FEE\u6539\u524D", "\u4FEE\u6539\u5F8C"]) tr.append(el("th", title));
        thead.append(tr);
        table.append(thead);
        const tbody = el("tbody");
        for (const change of task.changes) {
          const row = el("tr");
          row.append(el("td", String(change.target)), el("td", String(change.before ?? "")), el("td", String(change.after ?? "")));
          tbody.append(row);
        }
        table.append(tbody);
        body.append(table);
      }
      for (const text of task.results.slice(0, resultLimit)) body.append(el("p", text, "la-result"));
      if (task.results.length > resultLimit) {
        const more = el("button", `\u986F\u793A\u66F4\u591A\uFF08\u76EE\u524D ${resultLimit}\uFF0F${task.results.length}\uFF09`);
        more.type = "button";
        more.onclick = () => {
          resultLimit += 100;
          render();
        };
        body.append(more);
      }
    }
    root.querySelector("[data-action=apply]").disabled = planning || task?.status !== "pending" || executor.recoveryRequired;
    root.querySelector("[data-action=undo]").disabled = planning || !executor.canUndo;
    root.querySelector("[data-action=cancel]").disabled = executor.recoveryRequired || !planning && task?.status !== "pending" && !thread;
    toggle.disabled = planning;
  }
  function bindingsCurrent(binding) {
    if (binding.session !== context.assistant.sessionToken() || Date.now() - binding.at >= 6e5) return false;
    const adapters = context.assistant.adapters();
    return [...binding.bindings].every(([key, value]) => adapters.get(key) === value.adapter && value.adapter.stamp() === value.stamp);
  }
  async function handleTask(text, images = []) {
    mount();
    if (!mode) return null;
    if (images.length) return { handled: true, message: "AI \u64CD\u4F5C\u6A21\u5F0F\u53EA\u63A5\u53D7\u6587\u5B57\u6307\u4EE4\u3002\u8ACB\u79FB\u9664\u9644\u5716\uFF0C\u6216\u95DC\u9589\u300CAI \u64CD\u4F5C\u300D\u4F7F\u7528\u4E00\u822C\u804A\u5929\u3002", keepInput: true };
    if (planning) return { handled: true, message: "AI \u4ECD\u5728\u898F\u5283\u4E0A\u4E00\u500B\u4EFB\u52D9\u3002", keepInput: true };
    if (executor.recoveryRequired) return { handled: true, message: "\u672C\u6B21\u56DE\u5FA9\u9700\u8981\u4EBA\u5DE5\u8655\u7406\u3002\u8ACB\u5148\u4FDD\u7559\u539F\u59CB\u6A94\uFF0C\u91CD\u65B0\u6574\u7406\u4E26\u91CD\u65B0\u532F\u5165\u5F8C\u518D\u64CD\u4F5C\u3002", keepInput: true };
    const token = context.assistant.sessionToken();
    if (!token) return { handled: true, message: "\u8ACB\u91CD\u65B0\u767B\u5165\u3002", keepInput: true };
    if (thread && !bindingsCurrent(thread.binding)) {
      thread = null;
      executor.cancel();
      status("\u6F84\u6E05\u671F\u9593\u5DE5\u4F5C\u8868\u3001\u6A21\u578B\u6216\u8CC7\u6599\u5DF2\u6539\u8B8A\u3002\u8ACB\u91DD\u5C0D\u76EE\u524D\u8CC7\u6599\u91CD\u65B0\u8F38\u5165\u5B8C\u6574\u6307\u4EE4\u3002");
      render();
      return { handled: true, message: "\u8CC7\u6599\u5DF2\u6539\u8B8A\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u5B8C\u6574\u64CD\u4F5C\u6307\u4EE4\u3002", keepInput: true };
    }
    const n = ++serial;
    executor.cancel();
    planning = true;
    resultLimit = 100;
    status("\u6B63\u5728\u7406\u89E3\u6307\u4EE4\uFF1B\u5C1A\u672A\u4FEE\u6539\u8CC7\u6599\u2026");
    render();
    try {
      const binding = thread?.binding || executor.begin(), tools = [...context.assistant.adapters().values()].filter((a) => a.stamp() !== "unavailable").flatMap((a) => a.tools);
      if (!tools.length) throw Error("\u8ACB\u5148\u66F4\u65B0\u4E26\u958B\u555F\u5831\u50F9\u62163D\u6A21\u7D44\uFF0C\u532F\u5165\u8981\u64CD\u4F5C\u7684\u6A94\u6848");
      const previous = thread?.turns || [], messages = plannerMessages(text, tools, previous);
      if (messages[1].content.length > 6e3) throw Error("\u672C\u6B21\u6307\u4EE4\u8207\u6F84\u6E05\u5167\u5BB9\u904E\u9577\uFF0C\u8ACB\u6309\u53D6\u6D88\u5F8C\u7528\u8F03\u77ED\u7684\u5B8C\u6574\u6307\u4EE4\u91CD\u8A66");
      const raw = await context.assistant.plan(messages);
      if (disposed || n !== serial || token !== context.assistant.sessionToken()) return { handled: true, message: "\u4EFB\u52D9\u5DF2\u53D6\u6D88\u6216\u767B\u5165\u5DF2\u8B8A\u66F4\uFF0C\u672A\u5957\u7528\u4FEE\u6539\u3002" };
      const plan = parsePlan(raw, new Set(tools.map((tool) => tool.name)));
      if (plan.question) {
        if (previous.length >= 3) {
          thread = null;
          throw Error("\u5C1A\u7121\u6CD5\u78BA\u8A8D\u64CD\u4F5C\u76EE\u6A19\uFF0C\u8ACB\u63D0\u4F9B\u5DE5\u4F5C\u8868\u3001\u9805\u76EE\u540D\u7A31\u8207\u8981\u6539\u6210\u7684\u5167\u5BB9\u5F8C\u91CD\u8A66");
        }
        thread = { binding, turns: [...previous, { instruction: text, question: plan.question }] };
        status(plan.question);
        return { handled: true, message: plan.question };
      }
      const task = executor.prepare(plan, binding);
      thread = null;
      status(task.changes.length ? `\u5DF2\u6E96\u5099 ${task.changes.length} \u7B46\u6700\u7D42\u5DEE\u7570\u3002\u8ACB\u6838\u5C0D\u4E0B\u8868\uFF0C\u518D\u6309\u300C\u540C\u610F\u4FEE\u6539\u300D\u3002` : "\u672C\u6A5F\u8655\u7406\u5B8C\u6210\uFF1B\u6C92\u6709\u8CC7\u6599\u5DEE\u7570\u9700\u8981\u5957\u7528\u3002");
      render();
      return { handled: true, message: task.changes.length ? "\u5DF2\u7522\u751F\u5F85\u78BA\u8A8D\u5DEE\u7570\uFF0C\u8ACB\u898B\u8F38\u5165\u6846\u4E0A\u65B9\u7684 AI \u64CD\u4F5C\u9762\u677F\u3002" : "\u672C\u6A5F\u8655\u7406\u7D50\u679C\u5DF2\u986F\u793A\u5728 AI \u64CD\u4F5C\u9762\u677F\u3002" };
    } catch (error) {
      if (!disposed && n === serial) status("\u672A\u57F7\u884C\uFF1A" + error.message);
      return { handled: true, message: "\u64CD\u4F5C\u672A\u5957\u7528\u3002\u8ACB\u67E5\u770B AI \u64CD\u4F5C\u9762\u677F\u7684\u8AAA\u660E\u3002", keepInput: true };
    } finally {
      planning = false;
      if (!disposed) render();
    }
  }
  return { async open() {
    mount();
    setMode(true);
    context.ui.openChat();
    return { ok: true };
  }, handleTask, get enabled() {
    return mode;
  }, async close() {
    if (planning) {
      serial++;
      context.assistant.cancelPlanning();
    }
    thread = null;
    executor.cancel();
    setMode(false);
  }, async onSessionEnd() {
    disposed = true;
    mode = false;
    serial++;
    thread = null;
    context.assistant.cancelPlanning();
    executor.dispose();
    root?.remove();
    toggle?.remove();
    root = null;
    toggle = null;
  }, getStatus() {
    return { version: "0.1.1", enabled: mode, planning, transactionState: executor.task?.status || "idle", localDataOnly: true };
  } };
}
export {
  readPlannerResponse,
  registerLeavesModule
};
