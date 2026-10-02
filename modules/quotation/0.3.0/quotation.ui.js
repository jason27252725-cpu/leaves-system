const INSPECTOR_ID = 'leavesQuotationInspector';
const FILE_INPUT_ID = 'leavesQuotationFileInput';
const FILE_BUTTON_ID = 'leavesQuotationFileButton';
const ACTIVE_BADGE_ID = 'leavesQuotationActiveDraftBadge';
const draftRegistry = new Map();
let inspectorCleanup = null;
let activeDraftId = null;

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function roleLabel(role) {
  return role === 'owner' ? '最高管理員' : role === 'admin' ? '管理員／主管' : '一般成員';
}

function documentKindLabel(kind) {
  return kind === 'cost_master_candidate' ? '成本主檔候選' : '客戶報價候選';
}

function draftTypeLabel(draft) {
  return draft?.kind === 'cost_master_candidate' ? '成本比較草案' : '報價工作草案';
}

function normalizeDraftId(draft) {
  return String(draft?.draftId || draft?.id || '');
}

function formatMoney(value, currency = 'TWD') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '--';
  try {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: String(currency || 'TWD'),
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2
    }).format(amount);
  } catch (_) {
    return `NT$ ${amount.toLocaleString('zh-TW')}`;
  }
}

function costMatchLabel(matchType = '') {
  const value = String(matchType || '');
  if (value === 'exact_code') return '精準代碼';
  if (value === 'exact_name') return '精準名稱';
  if (value === 'contains') return '內容吻合';
  if (value === 'all_tokens') return '全部關鍵字';
  if (value === 'partial_tokens') return '部分關鍵字';
  return value || 'Gateway 比對';
}

function costErrorMessage(error) {
  const code = String(error?.code || '');
  if (code === 'SUPABASE_URL_MISSING') return '尚未設定 Supabase URL，成本資料暫時無法讀取。';
  if (code === 'ACTIVE_CODE_MISSING') return '找不到目前 LEAVES 登入身分，請重新登入後再試。';
  if (code === 'ORIGIN_DENIED') return '目前網站來源未被 Cost Gateway 授權。';
  if (code === 'GATEWAY_TIMEOUT') return 'Cost Gateway 回應逾時，稍後可再試；一般 LEAVES AI 不受影響。';
  if (code === 'GATEWAY_OFFLINE' || Number(error?.status) >= 500) return 'Cost Gateway 暫時無法使用；一般 LEAVES AI / SOP 仍可正常使用。';
  return String(error?.message || 'Cost Master 暫時無法讀取。');
}

function registerDraft({ draft, workbookInfo, sourceFile = null }) {
  const draftId = normalizeDraftId(draft);
  if (!draftId) throw new Error('Draft 缺少 draftId，無法加入報價草案登錄。');
  draft.id = draftId;
  draft.draftId = draftId;
  draftRegistry.set(draftId, {
    draft,
    workbookInfo,
    sourceFile,
    registeredAt: new Date().toISOString()
  });
  activeDraftId = draftId;
  return draftRegistry.get(draftId);
}

function getDraftRecord(draftId) {
  return draftRegistry.get(String(draftId || '')) || null;
}

function getActiveDraftRecord() {
  return activeDraftId ? getDraftRecord(activeDraftId) : null;
}

function appendAttachmentNotice(context, draft, workbookInfo, reopenDraft) {
  const container = context.getChatContainer?.();
  if (!container) return;
  const draftId = normalizeDraftId(draft);
  const id = `quotationAttachment_${draftId}`;
  const root = document.createElement('div');
  root.id = id;
  root.dataset.quotationDraftId = draftId;
  root.className = 'flex items-start space-x-3 msg-animate quotation-attachment-notice';
  const isCost = draft.kind === 'cost_master_candidate';
  root.innerHTML = `<div class="bg-white text-black w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold text-[10px]">AI</div><div class="quotation-attachment-card"><div class="quotation-attachment-top"><span><i class="fa-regular fa-file-lines"></i>${escapeHtml(draft.file.name)}</span><b>${escapeHtml(draftTypeLabel(draft))}</b></div><p>${isCost ? '目前只建立比較草案，不會覆蓋正式成本。管理員／最高管理員確認後，未來才可發布成新的成本版本。' : '原始 Workbook 保持不變。後續 AI 修改只進入工作草案；確認完成後會輸出新的修正版 Excel／版本。'}</p><div class="quotation-attachment-meta"><span>${escapeHtml(formatBytes(draft.file.size))}</span><span>.${escapeHtml(String(draft.file.extension || '').toUpperCase())}</span><span>${escapeHtml(roleLabel(context.accessRole))}</span><span>${escapeHtml(workbookInfo.futureOfficialExport || '')}</span></div><div class="quotation-attachment-actions"><button type="button" data-action="reopen-draft"><i class="fa-solid fa-up-right-from-square"></i><span>${isCost ? '開啟成本比較工作台' : '開啟報價工作台'}</span></button><span class="quotation-draft-id">${escapeHtml(draftId)}</span></div></div>`;
  root.querySelector('[data-action="reopen-draft"]')?.addEventListener('click', () => reopenDraft(draftId));
  container.appendChild(root);
  context.ui?.scrollChatToBottom?.();
}

function ensureActiveDraftBadge(context, reopenDraft) {
  const dock = context.getComposerDock?.();
  if (!dock) return null;
  let root = document.getElementById(ACTIVE_BADGE_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ACTIVE_BADGE_ID;
    root.className = 'quotation-active-draft-badge hidden';
    const preview = dock.querySelector('#multiImagePreviewBar');
    dock.insertBefore(root, preview || dock.firstChild);
  }
  root.onclick = event => {
    if (event.target.closest('[data-action="open-active-draft"]')) reopenDraft(activeDraftId);
  };
  return root;
}

function renderActiveDraftBadge(context, reopenDraft) {
  const root = ensureActiveDraftBadge(context, reopenDraft);
  if (!root) return;
  const record = getActiveDraftRecord();
  if (!record) {
    root.classList.add('hidden');
    root.innerHTML = '';
    return;
  }
  const { draft } = record;
  const draftCount = draftRegistry.size;
  const pending = Number(draft.pendingChangeCount || 0);
  const statusText = pending > 0 ? `${pending} 項待確認` : 'Draft · 尚未解析';
  root.innerHTML = `<button type="button" data-action="open-active-draft" title="重新開啟目前報價工作台"><span class="quotation-active-icon"><i class="fa-solid fa-file-invoice-dollar"></i></span><span class="quotation-active-copy"><strong>${escapeHtml(draft.file?.name || '報價草案')}</strong><small>${escapeHtml(statusText)}${draftCount > 1 ? ` · 共 ${draftCount} 份草案` : ''}</small></span><span class="quotation-active-open">開啟工作台 <i class="fa-solid fa-arrow-up-right-from-square"></i></span></button>`;
  root.classList.remove('hidden');
}

function buildInspectorHtml({ context, draft, workbookInfo }) {
  const isCost = draft.kind === 'cost_master_candidate';
  const canPublish = !!context.capabilities?.canPublishCostMaster;
  const draftId = normalizeDraftId(draft);
  return `
    <div class="quotation-inspector-shell" data-draft-id="${escapeHtml(draftId)}">
      <header class="quotation-inspector-header" data-role="dragHandle">
        <div>
          <span class="quotation-inspector-kicker">LEAVES AI · QUOTATION INSPECTOR</span>
          <h3>${isCost ? '成本主檔比較工作台' : '報價工作台'}</h3>
        </div>
        <div class="quotation-inspector-actions">
          <span class="quotation-sync-pill"><i></i>與 LEAVES AI 同步</span>
          <button type="button" data-action="close" aria-label="關閉工作台">×</button>
        </div>
      </header>
      <div class="quotation-inspector-body">
        <section class="quotation-context-card">
          <div><span>目前文件</span><strong>${escapeHtml(draft.file.name)}</strong></div>
          <div><span>文件預判</span><strong>${escapeHtml(documentKindLabel(draft.kind))}</strong></div>
          <div><span>狀態</span><strong>Draft · 尚未解析內容</strong></div>
          <div><span>權限</span><strong>${escapeHtml(roleLabel(context.accessRole))}</strong></div>
        </section>

        <section class="quotation-policy-card ${isCost ? 'is-cost' : 'is-quote'}">
          <div class="quotation-policy-icon"><i class="fa-solid ${isCost ? 'fa-database' : 'fa-file-excel'}"></i></div>
          <div>
            <strong>${isCost ? 'Cost Master 採版本發布，不原地覆蓋' : '原始報價檔保持不變'}</strong>
            <p>${isCost ? `PDF／Excel 匯入只建立比較草案。${canPublish ? '你的角色具備未來成本版本發布政策權限，但 0.3.0 仍是 Read-Only，不提供發布操作。' : '一般成員沒有成本發布權；0.3.0 僅提供 Read-Only 查詢。'}` : `AI 後續只修改工作副本；確認完成後才輸出新的正式修正版。預計輸出名稱：${escapeHtml(workbookInfo.futureOfficialExport)}`}</p>
          </div>
        </section>

        <section class="quotation-cost-master-section" data-role="costMasterPanel">
          <div class="quotation-section-head quotation-cost-head">
            <div><span>COST MASTER · READ ONLY</span><h4>正式成本資料</h4></div>
            <b data-role="costStatus">準備連線</b>
          </div>
          <div class="quotation-cost-meta">
            <div><span>環境</span><strong data-role="costEnvironment">${escapeHtml(String(context.environment || '--').toUpperCase())}</strong></div>
            <div><span>版本</span><strong data-role="costVersion">--</strong></div>
            <div><span>項目</span><strong data-role="costItemCount">--</strong></div>
            <div><span>狀態</span><strong data-role="costCurrent">--</strong></div>
          </div>
          <div class="quotation-cost-search">
            <input type="search" data-role="costSearchInput" maxlength="160" autocomplete="off" placeholder="搜尋成本，例如 D60 H240 衣櫃、透氣孔、SC-010">
            <button type="button" data-action="cost-search"><i class="fa-solid fa-magnifying-glass"></i><span>查成本</span></button>
          </div>
          <div class="quotation-cost-message" data-role="costMessage">只讀取 Current Cost Master；查不到的項目不會自動造價。</div>
          <div class="quotation-cost-results" data-role="costResults"><div class="quotation-cost-empty">尚未搜尋成本項目。</div></div>
          <div class="quotation-cost-source" data-role="costSource"></div>
        </section>

        <section class="quotation-diff-section">
          <div class="quotation-section-head"><div><span>LIVE DRAFT</span><h4>${isCost ? '成本差異草案' : '報價修改草案'}</h4></div><b>${escapeHtml(draftId)}</b></div>
          <div class="quotation-table-wrap">
            <table>
              <thead><tr><th>項目</th><th>原始值</th><th>草案值</th><th>狀態</th></tr></thead>
              <tbody><tr><td colspan="4" class="quotation-empty-row">目前已完成 Draft Registry／重新開啟工作台底座；尚未讀取 Excel／PDF 內容，因此不會虛構任何報價或成本資料。</td></tr></tbody>
            </table>
          </div>
        </section>

        <section class="quotation-flow-card">
          <span>後續正式流程</span>
          <div>${isCost ? '<b>匯入</b><i>→</i><b>AI 比對</b><i>→</i><b>Draft</b><i>→</i><b>人工確認</b><i>→</i><b>發布新成本版本</b>' : '<b>原始 Excel</b><i>→</i><b>AI 修改草案</b><i>→</i><b>人工確認</b><i>→</i><b>Patch 工作副本</b><i>→</i><b>匯出新版 Excel</b>'}</div>
        </section>
      </div>
      <footer class="quotation-inspector-footer">
        <div><span class="quotation-safe-dot"></span><span>${isCost ? '0.3.0 Read-Only · 不修改、不發布正式成本' : '關閉工作台不會刪除 Draft · 可由聊天卡或底部草案列重新開啟'}</span></div>
        <button type="button" disabled title="後續 Phase 啟用">${isCost ? '建立比較草案' : '匯出新版 Excel'}</button>
      </footer>
    </div>`;
}


function renderCostItems(panel, payload = {}) {
  const results = panel?.querySelector('[data-role="costResults"]');
  if (!results) return;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) {
    results.innerHTML = '<div class="quotation-cost-empty">目前 Cost Master 找不到可確定的成本項目；不會自動產生價格。</div>';
    return;
  }
  results.innerHTML = items.map(item => `
    <article class="quotation-cost-result" data-item-code="${escapeHtml(item.itemCode || '')}">
      <div class="quotation-cost-result-top"><strong>${escapeHtml(item.itemCode || '--')}</strong><span>${escapeHtml(costMatchLabel(item.matchType))}</span></div>
      <h5>${escapeHtml(item.itemName || item.normalizedName || '未命名成本項目')}</h5>
      <div class="quotation-cost-price"><b>${escapeHtml(formatMoney(item.unitCost, item.currency))}</b><span>/ ${escapeHtml(item.unit || '--')}</span></div>
      <p>${escapeHtml(item.specDescription || item.category || '')}</p>
    </article>`).join('');
}

function setCostPanelBusy(panel, busy, text = '') {
  const button = panel?.querySelector('[data-action="cost-search"]');
  const input = panel?.querySelector('[data-role="costSearchInput"]');
  const status = panel?.querySelector('[data-role="costStatus"]');
  if (button) button.disabled = !!busy;
  if (input) input.disabled = !!busy;
  if (status && text) status.textContent = text;
  panel?.classList.toggle('is-loading', !!busy);
}

async function hydrateCostPanel(panel, cost) {
  if (!panel || !cost) return;
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  panel.dataset.requestMarker = marker;
  const message = panel.querySelector('[data-role="costMessage"]');
  const source = panel.querySelector('[data-role="costSource"]');
  setCostPanelBusy(panel, true, '連線中');
  try {
    const payload = await cost.current();
    if (!panel.isConnected || panel.dataset.requestMarker !== marker) return;
    const version = payload?.version || {};
    const set = (role, value) => { const el = panel.querySelector(`[data-role="${role}"]`); if (el) el.textContent = String(value ?? '--'); };
    set('costEnvironment', String(payload?.environment || '--').toUpperCase());
    set('costVersion', version.label || '--');
    set('costItemCount', Number.isFinite(Number(version.itemCount)) ? `${Number(version.itemCount)} 項` : '--');
    set('costCurrent', version.current ? '✓ Current' : String(version.status || '--'));
    set('costStatus', '可讀取');
    panel.classList.remove('is-error');
    if (message) message.textContent = 'Cost Gateway 已連線。價格以目前 Current Cost Master 為唯一依據。';
    if (source) source.textContent = `來源版本：${version.label || '--'}${version.sourceDocumentName ? ` · ${version.sourceDocumentName}` : ''}`;
  } catch (error) {
    if (!panel.isConnected || panel.dataset.requestMarker !== marker) return;
    panel.classList.add('is-error');
    const status = panel.querySelector('[data-role="costStatus"]');
    if (status) status.textContent = 'Unavailable';
    if (message) message.textContent = costErrorMessage(error);
    if (source) source.textContent = '成本資料層失敗已隔離；不影響一般 LEAVES AI / SOP。';
  } finally {
    if (panel.isConnected && panel.dataset.requestMarker === marker) setCostPanelBusy(panel, false);
  }
}

function bindCostPanel(panel, cost) {
  if (!panel || !cost) return () => {};
  const input = panel.querySelector('[data-role="costSearchInput"]');
  const button = panel.querySelector('[data-action="cost-search"]');
  const message = panel.querySelector('[data-role="costMessage"]');
  let searchController = null;
  let searchSequence = 0;

  const runSearch = async () => {
    const query = String(input?.value || '').trim();
    if (!query) {
      if (message) message.textContent = '請輸入成本名稱、尺寸關鍵字或 SC 項目代碼。';
      input?.focus?.();
      return;
    }
    searchController?.abort?.();
    const controller = new AbortController();
    searchController = controller;
    const sequence = ++searchSequence;
    setCostPanelBusy(panel, true, '查詢中');
    if (message) message.textContent = `正在 Current Cost Master 搜尋「${query}」…`;
    try {
      let payload;
      if (/^SC-\d{3,6}$/i.test(query)) {
        try {
          const exact = await cost.item(query, { signal: controller.signal });
          payload = { items: exact?.item ? [exact.item] : [], versionLabel: exact?.versionLabel, environment: exact?.environment, count: exact?.item ? 1 : 0 };
        } catch (error) {
          if (String(error?.code || '') !== 'ITEM_NOT_FOUND') throw error;
          payload = { items: [], count: 0 };
        }
      } else {
        payload = await cost.search(query, { limit: 8, signal: controller.signal });
      }
      if (!panel.isConnected || sequence !== searchSequence) return;
      renderCostItems(panel, payload);
      const count = Array.isArray(payload?.items) ? payload.items.length : 0;
      const version = payload?.versionLabel || panel.querySelector('[data-role="costVersion"]')?.textContent || '--';
      if (message) message.textContent = count ? `找到 ${count} 個 Gateway 比對結果。請以項目代碼、尺寸、單位與版本一起確認。` : '目前 Cost Master 找不到可確定的成本項目；不會自動造價。';
      const source = panel.querySelector('[data-role="costSource"]');
      if (source && version) source.textContent = `查詢來源：Cost Master ${version} · Read-Only Gateway`;
      panel.classList.remove('is-error');
      const status = panel.querySelector('[data-role="costStatus"]');
      if (status) status.textContent = '可讀取';
    } catch (error) {
      if (!panel.isConnected || sequence !== searchSequence) return;
      if (controller.signal.aborted || String(error?.code || '') === 'REQUEST_ABORTED') return;
      panel.classList.add('is-error');
      if (message) message.textContent = costErrorMessage(error);
      const status = panel.querySelector('[data-role="costStatus"]');
      if (status) status.textContent = 'Unavailable';
      renderCostItems(panel, { items: [] });
    } finally {
      if (panel.isConnected && sequence === searchSequence) setCostPanelBusy(panel, false);
    }
  };

  button?.addEventListener('click', runSearch);
  const onKeydown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    }
  };
  input?.addEventListener('keydown', onKeydown);
  hydrateCostPanel(panel, cost);
  return () => {
    searchController?.abort?.();
    button?.removeEventListener('click', runSearch);
    input?.removeEventListener('keydown', onKeydown);
  };
}

function placeInspector(root, context, force = false) {
  if (!root || (root.dataset.manualPosition === 'true' && !force)) return;
  const drawer = context.getMountRoot?.();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw <= 820) {
    root.style.left = '10px'; root.style.right = '10px'; root.style.top = 'auto'; root.style.bottom = '10px';
    root.style.width = 'auto'; root.style.height = 'min(62vh, 620px)';
    return;
  }
  const rect = drawer?.getBoundingClientRect?.();
  const drawerLeft = rect?.left ?? Math.round(vw * .52);
  const available = drawerLeft - 28;
  const width = Math.min(620, Math.max(380, available - 20));
  const top = Math.max(76, Math.min((rect?.top ?? 92) + 8, vh - 360));
  if (available >= 390) {
    root.style.left = `${Math.max(12, drawerLeft - width - 14)}px`;
    root.style.right = 'auto';
  } else {
    root.style.left = '16px'; root.style.right = 'auto';
  }
  root.style.top = `${top}px`; root.style.bottom = 'auto'; root.style.width = `${Math.min(width, vw - 32)}px`;
  root.style.height = `${Math.min(720, Math.max(420, vh - top - 22))}px`;
}

function enableInspectorDrag(root, context) {
  const handle = root.querySelector('[data-role="dragHandle"]');
  if (!handle) return () => {};
  let active = false, sx = 0, sy = 0, sl = 0, st = 0;
  const move = e => {
    if (!active) return;
    const maxLeft = Math.max(8, window.innerWidth - root.offsetWidth - 8);
    const maxTop = Math.max(64, window.innerHeight - 120);
    root.style.left = `${Math.max(8, Math.min(maxLeft, sl + e.clientX - sx))}px`;
    root.style.top = `${Math.max(64, Math.min(maxTop, st + e.clientY - sy))}px`;
    root.style.right = 'auto'; root.style.bottom = 'auto'; root.dataset.manualPosition = 'true';
  };
  const up = () => { active = false; document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
  const down = e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    if (window.innerWidth <= 820) return;
    const rect = root.getBoundingClientRect(); active = true; sx = e.clientX; sy = e.clientY; sl = rect.left; st = rect.top;
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); e.preventDefault();
  };
  handle.addEventListener('pointerdown', down);
  const resize = () => { if (window.innerWidth <= 820) root.dataset.manualPosition = 'false'; placeInspector(root, context, true); };
  window.addEventListener('resize', resize);
  let observer = null;
  const drawer = context.getMountRoot?.();
  if (drawer && 'ResizeObserver' in window) { observer = new ResizeObserver(() => placeInspector(root, context, false)); observer.observe(drawer); }
  return () => { handle.removeEventListener('pointerdown', down); window.removeEventListener('resize', resize); observer?.disconnect?.(); };
}

function openInspector({ context, draft, workbookInfo, cost }) {
  activeDraftId = normalizeDraftId(draft);
  let root = document.getElementById(INSPECTOR_ID);
  if (!root) {
    root = document.createElement('aside');
    root.id = INSPECTOR_ID;
    root.className = 'quotation-inspector';
    document.body.appendChild(root);
  }
  inspectorCleanup?.(); inspectorCleanup = null;
  root.innerHTML = buildInspectorHtml({ context, draft, workbookInfo });
  root.dataset.activeDraftId = activeDraftId;
  root.classList.add('is-open');
  root.dataset.manualPosition = 'false';
  placeInspector(root, context, true);
  inspectorCleanup = enableInspectorDrag(root, context);
  root.querySelector('[data-action="close"]')?.addEventListener('click', () => unmountQuotationInspector());
  const costPanel = root.querySelector('[data-role="costMasterPanel"]');
  const costCleanup = bindCostPanel(costPanel, cost);
  const previousCleanup = inspectorCleanup;
  inspectorCleanup = () => { previousCleanup?.(); costCleanup?.(); };
  return root;
}

function ensureComposerControls({ context, engine, workbook, cost, reopenDraft }) {
  const dock = context.getComposerDock?.();
  const row = dock?.querySelector('.glass-mono');
  if (!dock || !row) throw new Error('找不到 LEAVES AI 輸入列，無法掛載報價文件入口。');
  ensureActiveDraftBadge(context, reopenDraft);
  let input = document.getElementById(FILE_INPUT_ID);
  if (!input) {
    input = document.createElement('input'); input.type = 'file'; input.id = FILE_INPUT_ID; input.accept = '.xlsx,.xlsm,.pdf'; input.hidden = true; row.insertBefore(input, row.firstChild);
  }
  let button = document.getElementById(FILE_BUTTON_ID);
  if (!button) {
    button = document.createElement('button'); button.type = 'button'; button.id = FILE_BUTTON_ID; button.className = 'quotation-composer-btn text-neutral-400 hover:text-white p-2 text-sm transition rounded-xl hover:bg-white/10 mr-1 shrink-0'; button.title = '上傳報價／成本 Excel 或 PDF'; button.innerHTML = '<i class="fa-solid fa-file-invoice-dollar"></i>';
    const mic = document.getElementById('micBtn'); row.insertBefore(button, mic || row.firstChild?.nextSibling || null);
  }
  button.dataset.moduleVersion = String(context.moduleVersion || '');
  input.dataset.moduleVersion = String(context.moduleVersion || '');
  button.onclick = () => input.click();
  input.onchange = () => {
    const file = input.files?.[0]; const meta = workbook.inspectFile(file);
    if (!meta.ok) { context.ui?.alert?.('目前只接受 XLSX、XLSM 或 PDF。', 'AI 報價'); input.value = ''; return; }
    const draft = engine.normalizeDraftEnvelope(engine.createDraftEnvelope(meta, context.accessRole));
    const workbookInfo = workbook.createWorkingCopyDescriptor(meta);
    registerDraft({ draft, workbookInfo, sourceFile: file });
    appendAttachmentNotice(context, draft, workbookInfo, reopenDraft);
    renderActiveDraftBadge(context, reopenDraft);
    openInspector({ context, draft, workbookInfo, cost });
    input.value = '';
  };
  renderActiveDraftBadge(context, reopenDraft);
  return { input, button };
}

export function mountQuotationCapability({ context, engine, workbook, cost }) {
  const reopenDraft = draftId => {
    const record = getDraftRecord(draftId);
    if (!record) {
      context.ui?.alert?.('這份草案目前不在本次瀏覽器工作階段中，請重新上傳來源檔案。', 'AI 報價');
      return false;
    }
    activeDraftId = String(draftId);
    renderActiveDraftBadge(context, reopenDraft);
    openInspector({ context, draft: record.draft, workbookInfo: record.workbookInfo, cost });
    return true;
  };
  const ensureMounted = () => ensureComposerControls({ context, engine, workbook, cost, reopenDraft });
  ensureMounted();
  context.ui?.markCapabilityReady?.('quote', true);
  return Object.freeze({
    ensureMounted,
    reopenDraft,
    isInspectorOpen: () => document.getElementById(INSPECTOR_ID)?.classList.contains('is-open') || false,
    getLatestDraft: () => getActiveDraftRecord()?.draft || null,
    getActiveDraftId: () => activeDraftId,
    getDraftCount: () => draftRegistry.size,
    getDraftIds: () => [...draftRegistry.keys()]
  });
}

export function unmountQuotationInspector() {
  const root = document.getElementById(INSPECTOR_ID);
  root?.classList.remove('is-open');
}
