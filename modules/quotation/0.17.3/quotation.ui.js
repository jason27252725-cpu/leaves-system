import {openCostCenter} from './quotation.cost-center.js';
import { attachQuotationWindow } from './quotation.window.js';
const INSPECTOR_ID = 'leavesQuotationInspector';
const FILE_INPUT_ID = 'leavesQuotationFileInput';
const FILE_BUTTON_ID = 'leavesQuotationFileButton';
const ACTIVE_BADGE_ID = 'leavesQuotationActiveDraftBadge';
const COST_CONSOLE_ID = 'leavesCostMasterConsole';
const COST_CONSOLE_BUTTON_ID = 'leavesCostMasterConsoleButton';
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

function renderActiveDraftBadge(context, reopenDraft, workspace=null) {
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
  const current=workspace?.getRecord?.(workspace.getActiveDraftId?.()),parsed=!!current?.model?.structured;
  const pending = Number(draft.pendingChangeCount || 0);
  const statusText = draft.parseStatus==='error'?'解析失敗，請重新匯入':draft.parseStatus==='parsing'?'正在解析…':pending>0?`${parsed?'已解析 · ':''}${pending} 項待確認`:parsed?'已解析 · 工作草稿':current?.model?'文件預覽 · 不支援儲存格編輯':'Draft · 尚未解析';
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
            <p>${isCost ? `PDF／Excel 匯入只建立比較草案。${canPublish ? '你的角色可透過 0.7.1 Cost Master 後台建立 Draft、審核並在 Sandbox Atomic Publish。正式成本仍採 immutable 版本發布。' : '一般成員沒有成本修訂／發布權；0.7.1 維持 Read-Only 查詢。'}` : `AI 後續只修改工作副本；確認完成後才輸出新的正式修正版。預計輸出名稱：${escapeHtml(workbookInfo.futureOfficialExport)}`}</p>
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
        <div><span class="quotation-safe-dot"></span><span>${isCost ? '0.7.1 · Cost Master 後台已接 Revision Gateway；一般成員仍唯讀' : '關閉工作台不會刪除 Draft · 可由聊天卡或底部草案列重新開啟'}</span></div>
        <button type="button" disabled title="使用輸入列旁的資料庫按鈕開啟 Cost Master 後台">${isCost ? '由 Cost Master 後台管理' : '匯出新版 Excel'}</button>
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

// ============================================================
// Cost Master Console — read + revision + atomic publish UI
// ============================================================
function revisionStatusLabel(status = '') {
  const map = {
    draft: '草稿',
    pending_review: '待審核',
    published: '已發布',
    rejected: '已拒絕',
    cancelled: '已取消'
  };
  return map[String(status || '')] || String(status || '--');
}

function reviewStatusLabel(status = '') {
  const map = { pending: '待審核', accepted: '已接受', rejected: '已拒絕' };
  return map[String(status || '')] || String(status || '--');
}

function suggestNextVersionLabel(label = '') {
  const m = String(label || '').trim().toUpperCase().match(/^V(\d+)\.(\d+)$/);
  return m ? `V${Number(m[1])}.${Number(m[2]) + 1}` : '';
}

function revisionErrorMessage(error) {
  const code = String(error?.code || '');
  if (code === 'ACTIVE_CODE_MISSING') return '找不到目前 LEAVES 登入身分，請重新登入。';
  if (code === 'ROLE_FORBIDDEN') return '目前身分沒有成本修訂／發布權限。';
  if (code === 'DRAFT_VERSION_CONFLICT') return 'Draft 已被更新，系統會重新讀取最新狀態。';
  if (code === 'BASE_VERSION_STALE') return '這份 Draft 的基底版本已不是 Current，請建立新的修訂草稿。';
  if (code === 'PREFLIGHT_FINGERPRINT_MISMATCH') return '資料庫狀態已改變，請重新執行發布預檢。';
  if (code === 'PUBLISH_RESULT_UNCERTAIN') return '發布結果不確定：禁止直接重送。請先重新讀取 Current / Draft 狀態。';
  if (code === 'GATEWAY_TIMEOUT' || code === 'GATEWAY_OFFLINE') return 'Cost Revision Gateway 暫時無法連線；一般 LEAVES AI 不受影響。';
  return String(error?.message || '成本修訂操作失敗。');
}

function buildCostConsoleHtml(context) {
  const canManage = !!context.capabilities?.canManageCostMaster;
  return `
    <div class="quotation-cost-console-shell">
      <header class="quotation-cost-console-header">
        <div>
          <span>LEAVES AI · COST MASTER</span>
          <h3>成本主檔後台</h3>
        </div>
        <div class="quotation-cost-console-header-actions">
          <span class="quotation-cost-role">${escapeHtml(roleLabel(context.accessRole))}</span>
          <button type="button" data-action="console-refresh" title="重新整理"><i class="fa-solid fa-rotate"></i></button>
          <button type="button" data-action="console-close" aria-label="關閉成本後台">×</button>
        </div>
      </header>
      <div class="quotation-cost-console-body">
        <section class="quotation-console-current-card">
          <div class="quotation-console-section-head">
            <div><span>CURRENT COST MASTER</span><h4>正式成本版本</h4></div>
            <b data-role="consoleCurrentState">讀取中</b>
          </div>
          <div class="quotation-console-current-grid">
            <div><span>環境</span><strong data-role="consoleEnvironment">${escapeHtml(String(context.environment || '--').toUpperCase())}</strong></div>
            <div><span>Current</span><strong data-role="consoleVersion">--</strong></div>
            <div><span>項目</span><strong data-role="consoleItemCount">--</strong></div>
            <div><span>發布狀態</span><strong data-role="consoleVersionStatus">--</strong></div>
          </div>
          <div class="quotation-console-search-row">
            <input type="search" data-role="consoleSearchInput" maxlength="160" autocomplete="off" placeholder="搜尋 SC-010、衣櫃、透氣孔…">
            <button type="button" data-action="console-search"><i class="fa-solid fa-magnifying-glass"></i>查詢</button>
            <button type="button" data-action="console-load-all"><i class="fa-solid fa-list"></i>全部</button>
          </div>
          <div class="quotation-console-results" data-role="consoleSearchResults"><div class="quotation-cost-empty">可搜尋 Current Cost Master；價格只來自 Gateway。</div></div>
        </section>

        <section class="quotation-console-revision-card ${canManage ? '' : 'is-readonly'}">
          <div class="quotation-console-section-head">
            <div><span>COST REVISION</span><h4>${canManage ? '修訂、審核與發布' : '修訂權限'}</h4></div>
            <b>${canManage ? 'SANDBOX' : 'READ ONLY'}</b>
          </div>
          ${canManage ? `
            <div class="quotation-console-create-row">
              <input type="text" data-role="newDraftTitle" maxlength="160" placeholder="新 Draft 標題（可留空）">
              <button type="button" data-action="console-create-draft"><i class="fa-solid fa-plus"></i>建立修訂草稿</button>
            </div>
            <div class="quotation-console-revision-layout">
              <aside class="quotation-console-draft-list" data-role="revisionDraftList"><div class="quotation-cost-empty">正在讀取 Draft…</div></aside>
              <div class="quotation-console-draft-detail" data-role="revisionDraftDetail"><div class="quotation-cost-empty">選擇或建立一份 Draft 後開始修訂。</div></div>
            </div>
          ` : `
            <div class="quotation-console-readonly-note"><i class="fa-solid fa-lock"></i><div><strong>一般成員只能讀取正式成本</strong><p>建立 Draft、修改成本、審核與 Publish 僅限 admin / owner。</p></div></div>
          `}
        </section>

        <div class="quotation-console-message" data-role="consoleMessage">0.7.1 · Cost Session / Revision Session 只存在記憶體，不寫入 localStorage / sessionStorage。</div>
      </div>
    </div>`;
}

function setConsoleMessage(root, text, tone = '') {
  const el = root?.querySelector('[data-role="consoleMessage"]');
  if (!el) return;
  el.textContent = String(text || '');
  el.dataset.tone = tone;
}

function setConsoleBusy(root, busy, text = '') {
  if (!root) return;
  const active = !!busy;
  root.classList.toggle('is-busy', active);
  root.dataset.consoleBusy = active ? 'true' : 'false';
  root.setAttribute('aria-busy', active ? 'true' : 'false');
  if (text) setConsoleMessage(root, text, 'busy');
}

function renderConsoleCostItems(root, payload = {}, state, context) {
  const host = root?.querySelector('[data-role="consoleSearchResults"]');
  if (!host) return;
  const items = Array.isArray(payload?.items) ? payload.items : payload?.item ? [payload.item] : [];
  if (!items.length) {
    host.innerHTML = '<div class="quotation-cost-empty">找不到可確定的正式成本項目；系統不會自動造價。</div>';
    return;
  }
  const canManage = !!context.capabilities?.canManageCostMaster;
  const selectedEditable = state?.selectedDraft?.draft?.status === 'draft';
  host.innerHTML = items.map(item => `
    <article class="quotation-console-cost-row">
      <div class="quotation-console-cost-copy">
        <div><strong>${escapeHtml(item.itemCode || '--')}</strong><span>${escapeHtml(item.category || '')}</span></div>
        <h5>${escapeHtml(item.itemName || item.normalizedName || '--')}</h5>
        <p>${escapeHtml(item.specDescription || '')}</p>
      </div>
      <div class="quotation-console-cost-price">
        <b>${escapeHtml(formatMoney(item.unitCost, item.currency))}</b><span>/ ${escapeHtml(item.unit || '--')}</span>
        ${canManage ? `<button type="button" data-action="console-use-item" data-item-code="${escapeHtml(item.itemCode || '')}" ${selectedEditable ? '' : 'disabled'} title="${selectedEditable ? '帶入目前 Draft' : '先選擇 status=draft 的修訂草稿'}">加入修訂</button>` : ''}
      </div>
    </article>`).join('');
}

function draftSortWeight(status = '') {
  return ({ draft: 0, pending_review: 1, published: 2, rejected: 3, cancelled: 4 })[status] ?? 9;
}

function renderRevisionDraftList(root, state) {
  const host = root?.querySelector('[data-role="revisionDraftList"]');
  if (!host) return;
  const drafts = [...(state.drafts || [])].sort((a, b) => {
    const byStatus = draftSortWeight(a.status) - draftSortWeight(b.status);
    if (byStatus) return byStatus;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
  if (!drafts.length) {
    host.innerHTML = '<div class="quotation-cost-empty">目前沒有 Cost Revision Draft。</div>';
    return;
  }
  host.innerHTML = drafts.map(draft => `
    <button type="button" class="quotation-console-draft-item ${state.selectedDraftId === draft.id ? 'is-active' : ''}" data-action="console-select-draft" data-draft-id="${escapeHtml(draft.id)}">
      <span><b>${escapeHtml(revisionStatusLabel(draft.status))}</b><small>lock ${escapeHtml(draft.lockVersion)}</small></span>
      <strong>${escapeHtml(draft.title || '未命名修訂')}</strong>
      <em>${escapeHtml(draft.baseVersion?.versionLabel || '--')} → ${escapeHtml(draft.proposedVersionLabel || '未發布')}</em>
    </button>`).join('');
}

function renderChangeRows(changes = [], draft = {}) {
  if (!changes.length) return '<div class="quotation-cost-empty">這份 Draft 還沒有 Change。</div>';
  const editable = draft.status === 'draft';
  const reviewable = draft.status === 'pending_review';
  return changes.map(change => {
    const oldCost = Number(change?.oldItem?.unit_cost);
    const newCost = Number(change?.proposedItem?.unit_cost);
    return `
      <article class="quotation-console-change" data-change-id="${escapeHtml(change.id)}">
        <div class="quotation-console-change-head">
          <div><strong>${escapeHtml(change.itemCode || '--')}</strong><span>${escapeHtml(reviewStatusLabel(change.reviewStatus))}</span></div>
          <small>#${escapeHtml(change.changeOrder || '')}</small>
        </div>
        <div class="quotation-console-change-money">
          <span>${escapeHtml(formatMoney(oldCost, change?.oldItem?.currency))}</span>
          <i>→</i>
          ${editable ? `<input type="number" min="0" step="0.01" data-role="changePriceInput" value="${Number.isFinite(newCost) ? escapeHtml(newCost) : ''}">` : `<b>${escapeHtml(formatMoney(newCost, change?.proposedItem?.currency))}</b>`}
          <em>/ ${escapeHtml(change?.proposedItem?.unit || change?.oldItem?.unit || '--')}</em>
        </div>
        ${change.aiReason ? `<p>${escapeHtml(change.aiReason)}</p>` : ''}
        <div class="quotation-console-change-actions">
          ${editable && change.reviewStatus === 'pending' ? `<button type="button" data-action="console-update-change" data-change-id="${escapeHtml(change.id)}">儲存修改</button><button type="button" data-action="console-remove-change" data-change-id="${escapeHtml(change.id)}" class="is-danger">移除</button>` : ''}
          ${reviewable && change.reviewStatus === 'pending' ? `<button type="button" data-action="console-review-change" data-decision="accepted" data-change-id="${escapeHtml(change.id)}" class="is-accept">接受</button><button type="button" data-action="console-review-change" data-decision="rejected" data-change-id="${escapeHtml(change.id)}" class="is-danger">拒絕</button>` : ''}
          ${change.reviewedBy?.name ? `<span>審核：${escapeHtml(change.reviewedBy.name)}</span>` : ''}
        </div>
      </article>`;
  }).join('');
}

function summarizeReview(changes = []) {
  const pending = changes.filter(x => x.reviewStatus === 'pending').length;
  const accepted = changes.filter(x => x.reviewStatus === 'accepted').length;
  const rejected = changes.filter(x => x.reviewStatus === 'rejected').length;
  return { total: changes.length, pending, accepted, rejected, allReviewed: changes.length > 0 && pending === 0, allAccepted: changes.length > 0 && pending === 0 && rejected === 0 };
}

function renderRevisionDraftDetail(root, state) {
  const host = root?.querySelector('[data-role="revisionDraftDetail"]');
  if (!host) return;
  const payload = state.selectedDraft;
  if (!payload?.draft) {
    host.innerHTML = '<div class="quotation-cost-empty">選擇或建立一份 Draft 後開始修訂。</div>';
    return;
  }
  const draft = payload.draft;
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  const review = summarizeReview(changes);
  const currentLabel = state.current?.version?.label || '';
  const suggestedLabel = suggestNextVersionLabel(currentLabel);
  if (!state.proposedVersionLabel) state.proposedVersionLabel = draft.proposedVersionLabel || suggestedLabel;
  const preflight = state.preflight && state.preflightDraftId === draft.id && state.preflightLockVersion === Number(draft.lockVersion) ? state.preflight : null;
  const fingerprint = String(preflight?.dbPreflightFingerprint || '');

  host.innerHTML = `
    <div class="quotation-console-draft-title">
      <div><span>${escapeHtml(revisionStatusLabel(draft.status))}</span><h4>${escapeHtml(draft.title || '未命名修訂')}</h4></div>
      <div><small>Base</small><b>${escapeHtml(draft.baseVersion?.versionLabel || '--')}</b><small>lock ${escapeHtml(draft.lockVersion)}</small></div>
    </div>
    <div class="quotation-console-review-summary">
      <span>Change <b>${changes.length}</b></span><span>待審 <b>${review.pending}</b></span><span>接受 <b>${review.accepted}</b></span><span>拒絕 <b>${review.rejected}</b></span>
    </div>

    ${draft.status === 'draft' ? `
      <div class="quotation-console-add-change">
        <div><label>Item Code</label><input type="text" data-role="addItemCode" maxlength="80" placeholder="SC-010"></div>
        <div><label>新單價</label><input type="number" min="0" step="0.01" data-role="addUnitCost" placeholder="例如 8500"></div>
        <div class="is-wide"><label>變更原因</label><input type="text" data-role="addReason" maxlength="1000" placeholder="人工修訂原因（可留空）"></div>
        <button type="button" data-action="console-add-change"><i class="fa-solid fa-plus"></i>加入 Change</button>
      </div>` : ''}

    <div class="quotation-console-change-list">${renderChangeRows(changes, draft)}</div>

    <div class="quotation-console-lifecycle-actions">
      ${draft.status === 'draft' ? `<button type="button" data-action="console-submit-draft" ${changes.length ? '' : 'disabled'}><i class="fa-solid fa-paper-plane"></i>提交審核</button><button type="button" data-action="console-cancel-draft" class="is-danger"><i class="fa-solid fa-ban"></i>取消 Draft</button>` : ''}
      ${draft.status === 'pending_review' ? `<button type="button" data-action="console-finalize-review" ${review.allReviewed ? '' : 'disabled'}><i class="fa-solid fa-check-double"></i>完成 Review Gate</button>` : ''}
      ${draft.status === 'published' ? `<span class="quotation-console-published"><i class="fa-solid fa-circle-check"></i>這份 Draft 已發布${draft.proposedVersionLabel ? `為 ${escapeHtml(draft.proposedVersionLabel)}` : ''}</span>` : ''}
      ${draft.status === 'rejected' ? '<span class="quotation-console-rejected"><i class="fa-solid fa-circle-xmark"></i>這份 Draft 已結案為 rejected。</span>' : ''}
      ${draft.status === 'cancelled' ? '<span class="quotation-console-rejected"><i class="fa-solid fa-ban"></i>這份 Draft 已取消。</span>' : ''}
    </div>

    ${draft.status === 'pending_review' && review.allAccepted ? `
      <section class="quotation-console-publish-box">
        <div class="quotation-console-publish-title"><span>ATOMIC PUBLISH</span><strong>發布新成本版本</strong></div>
        <div class="quotation-console-version-row"><label>新版本</label><input type="text" data-role="publishVersionLabel" value="${escapeHtml(state.proposedVersionLabel || suggestedLabel)}" placeholder="${escapeHtml(suggestedLabel || 'V2.2')}"><button type="button" data-action="console-preflight"><i class="fa-solid fa-shield-halved"></i>發布預檢</button></div>
        ${preflight ? `
          <div class="quotation-console-preflight is-pass">
            <strong>✓ DB Authoritative Preflight PASS</strong>
            <span>${escapeHtml(preflight?.baseVersion?.versionLabel || '--')} → ${escapeHtml(preflight?.proposedVersion?.versionLabel || state.proposedVersionLabel || '--')}</span>
            <code title="${escapeHtml(fingerprint)}">${escapeHtml(fingerprint.slice(0, 16))}…${escapeHtml(fingerprint.slice(-10))}</code>
          </div>
          <div class="quotation-console-confirm-row">
            <label>輸入 <code>PUBLISH_COST_MASTER</code> 才能發布</label>
            <input type="text" data-role="publishConfirmText" autocomplete="off" placeholder="PUBLISH_COST_MASTER">
            <button type="button" data-action="console-publish" class="is-publish" disabled><i class="fa-solid fa-rocket"></i>發布 ${escapeHtml(preflight?.proposedVersion?.versionLabel || state.proposedVersionLabel || '')}</button>
          </div>` : '<div class="quotation-console-preflight">發布前一定會重新向 DB 取得 fingerprint；未通過預檢時不顯示正式 Publish 按鈕。</div>'}
      </section>` : ''}
  `;
}

async function openCostMasterConsole(args) {return openCostCenter(args);}

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
  const inspectorWindow = attachQuotationWindow(root, root.querySelector('[data-role="dragHandle"]'), context, { defaultWidth: 680, defaultHeight: 720, offsetFromChat: true, minWidth: 420, minHeight: 380 });
  inspectorCleanup = () => inspectorWindow.cleanup?.();
  root.querySelector('[data-action="close"]')?.addEventListener('click', () => unmountQuotationInspector());
  const costPanel = root.querySelector('[data-role="costMasterPanel"]');
  const costCleanup = bindCostPanel(costPanel, cost);
  const previousCleanup = inspectorCleanup;
  inspectorCleanup = () => { previousCleanup?.(); costCleanup?.(); };
  return root;
}

function ensureComposerControls({ context, engine, workbook, cost, revision, workspace, reopenDraft, openCostConsole }) {
  const dock = context.getComposerDock?.();
  const row = dock?.querySelector('.glass-mono');
  if (!dock || !row) throw new Error('找不到 LEAVES AI 輸入列，無法掛載報價文件入口。');
  ensureActiveDraftBadge(context, reopenDraft);
  let input = document.getElementById(FILE_INPUT_ID);
  if (!input) { input=document.createElement('input'); input.type='file'; input.id=FILE_INPUT_ID; input.accept='.xlsx,.xlsm,.pdf'; input.hidden=true; row.insertBefore(input,row.firstChild); }
  let button=document.getElementById(FILE_BUTTON_ID);
  if(!button){button=document.createElement('button');button.type='button';button.id=FILE_BUTTON_ID;button.className='quotation-composer-btn text-neutral-400 hover:text-white p-2 text-sm transition rounded-xl hover:bg-white/10 mr-1 shrink-0';button.title='上傳或拖入報價 Excel / PDF';button.innerHTML='<i class="fa-solid fa-file-invoice-dollar"></i>';const mic=document.getElementById('micBtn');row.insertBefore(button,mic||row.firstChild?.nextSibling||null);}
  let costConsoleButton=document.getElementById(COST_CONSOLE_BUTTON_ID);
  if(!costConsoleButton){costConsoleButton=document.createElement('button');costConsoleButton.type='button';costConsoleButton.id=COST_CONSOLE_BUTTON_ID;costConsoleButton.className='quotation-composer-btn quotation-cost-console-btn text-neutral-400 hover:text-white p-2 text-sm transition rounded-xl hover:bg-white/10 mr-1 shrink-0';costConsoleButton.innerHTML='<i class="fa-solid fa-database"></i>';row.insertBefore(costConsoleButton,button.nextSibling);}
  costConsoleButton.title=context.capabilities?.canManageCostMaster?'開啟成本管理中心':'標準成本查詢（唯讀）';
  costConsoleButton.setAttribute('aria-label',costConsoleButton.title);
  costConsoleButton.dataset.moduleVersion=String(context.moduleVersion||''); costConsoleButton.onclick=()=>openCostConsole();
  button.dataset.moduleVersion=String(context.moduleVersion||'');input.dataset.moduleVersion=String(context.moduleVersion||'');button.onclick=()=>input.click();

  const ingestFile=async file=>{
    const meta=workbook.inspectFile(file); if(!meta.ok){await context.ui?.alert?.('目前只接受 XLSX、XLSM 或 PDF。','AI 報價');return false;}
    const draft=engine.normalizeDraftEnvelope(engine.createDraftEnvelope(meta,context.accessRole));const workbookInfo=workbook.createWorkingCopyDescriptor(meta);
    draft.parseStatus='parsing';registerDraft({draft,workbookInfo,sourceFile:file});appendAttachmentNotice(context,draft,workbookInfo,reopenDraft);renderActiveDraftBadge(context,reopenDraft,workspace);
    try{await workspace.importFile({file,draft,workbookInfo});draft.parseStatus='ready';renderActiveDraftBadge(context,reopenDraft,workspace);}catch(err){draft.parseStatus='error';renderActiveDraftBadge(context,reopenDraft,workspace);await context.ui?.alert?.(`報價檔解析失敗：${String(err?.message||err)}\n\n原始檔沒有被修改。`,'AI 報價');return false;}
    return true;
  };
  input.onchange=async()=>{const file=input.files?.[0];if(file)await ingestFile(file);input.value='';};

  const drawer=context.getMountRoot?.();
  row._quotationDropCleanup?.();
  if(drawer){
    const over=e=>{const files=[...(e.dataTransfer?.files||[])];if(files.some(f=>workbook.inspectFile(f).ok)){e.preventDefault();e.stopImmediatePropagation();drawer.classList.add('quotation-file-dragover');}};
    const leave=e=>{drawer.classList.remove('quotation-file-dragover');};
    const drop=async e=>{const files=[...(e.dataTransfer?.files||[])];const file=files.find(f=>workbook.inspectFile(f).ok);if(!file)return;e.preventDefault();e.stopImmediatePropagation();drawer.classList.remove('quotation-file-dragover');await ingestFile(file);};
    drawer.addEventListener('dragover',over,true);drawer.addEventListener('dragleave',leave,true);drawer.addEventListener('drop',drop,true);
    row._quotationDropCleanup=()=>{drawer.removeEventListener('dragover',over,true);drawer.removeEventListener('dragleave',leave,true);drawer.removeEventListener('drop',drop,true);drawer.classList.remove('quotation-file-dragover');};
  }
  renderActiveDraftBadge(context,reopenDraft,workspace);return{input,button,costConsoleButton,ingestFile};
}

export function mountQuotationCapability({ context, engine, workbook, cost, revision, workspace }) {
  const reopenDraft=draftId=>{const record=getDraftRecord(draftId);if(!record){context.ui?.alert?.('這份草案目前不在本次瀏覽器工作階段中，請重新上傳來源檔案。','AI 報價');return false;}activeDraftId=String(draftId);if(workspace?.openDraft?.(draftId)){renderActiveDraftBadge(context,reopenDraft,workspace);return true;}renderActiveDraftBadge(context,reopenDraft,workspace);openInspector({context,draft:record.draft,workbookInfo:record.workbookInfo,cost});return true;};
  const openCostConsole=()=>openCostMasterConsole({context,cost,revision});
  const ensureMounted=()=>ensureComposerControls({context,engine,workbook,cost,revision,workspace,reopenDraft,openCostConsole});
  ensureMounted();const disposeState=context.assistant?.subscribeState?.(()=>renderActiveDraftBadge(context,reopenDraft,workspace));context.ui?.markCapabilityReady?.('quote',true);
  return Object.freeze({ensureMounted,reopenDraft,openCostConsole,dispose(){disposeState?.();},handleChatCommand:text=>workspace?.handleChatCommand?.(text)||null,isInspectorOpen:()=>workspace?.getStatus?.().open||document.getElementById(INSPECTOR_ID)?.classList.contains('is-open')||false,isCostConsoleOpen:()=>document.getElementById(COST_CONSOLE_ID)?.classList.contains('is-open')||false,getLatestDraft:()=>getActiveDraftRecord()?.draft||null,getActiveDraftId:()=>workspace?.getActiveDraftId?.()||activeDraftId,getDraftCount:()=>draftRegistry.size,getDraftIds:()=>[...draftRegistry.keys()]});
}

export function unmountQuotationInspector() {
  const root = document.getElementById(INSPECTOR_ID);
  root?.classList.remove('is-open');
}

export function unmountCostMasterConsole() {
  const root = document.getElementById(COST_CONSOLE_ID);
  root?._quotationCostConsoleCleanup?.();
  root?.classList.remove('is-open');
}


export function disposeQuotationCapability({ cost = null, revision = null, context = null } = {}) {
  try { inspectorCleanup?.(); } catch (_) {}
  inspectorCleanup = null;
  const inspector = document.getElementById(INSPECTOR_ID);
  inspector?._quotationWorkspaceCleanup?.();
  inspector?.remove?.();
  const consoleRoot = document.getElementById(COST_CONSOLE_ID);
  try { consoleRoot?._quotationCostConsoleCleanup?.(); } catch (_) {}
  consoleRoot?.remove?.();
  document.getElementById(FILE_INPUT_ID)?.remove?.();
  document.getElementById(FILE_BUTTON_ID)?.remove?.();
  document.getElementById(COST_CONSOLE_BUTTON_ID)?.remove?.();
  document.getElementById(ACTIVE_BADGE_ID)?.remove?.();
  try { context?.getComposerDock?.()?.querySelector('.glass-mono')?._quotationDropCleanup?.(); } catch (_) {}
  draftRegistry.clear();
  activeDraftId = null;
  try { cost?.clearSession?.(); } catch (_) {}
  try { revision?.clearSession?.(); } catch (_) {}
}


export function exportQuotationRegistry(){return {records:new Map(draftRegistry),activeDraftId};}
export function restoreQuotationRegistry(state){draftRegistry.clear();for(const[k,v]of state.records)draftRegistry.set(k,v);activeDraftId=state.activeDraftId;}
