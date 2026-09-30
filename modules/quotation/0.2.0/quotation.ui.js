const INSPECTOR_ID = 'leavesQuotationInspector';
const FILE_INPUT_ID = 'leavesQuotationFileInput';
const FILE_BUTTON_ID = 'leavesQuotationFileButton';
let inspectorCleanup = null;
let latestDraft = null;

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

function appendAttachmentNotice(context, draft, workbookInfo) {
  const container = context.getChatContainer?.();
  if (!container) return;
  const id = `quotationAttachment_${draft.id}`;
  const root = document.createElement('div');
  root.id = id;
  root.className = 'flex items-start space-x-3 msg-animate quotation-attachment-notice';
  const isCost = draft.kind === 'cost_master_candidate';
  root.innerHTML = `<div class="bg-white text-black w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold text-[10px]">AI</div><div class="quotation-attachment-card"><div class="quotation-attachment-top"><span><i class="fa-regular fa-file-lines"></i>${escapeHtml(draft.file.name)}</span><b>${isCost ? '成本比較草案' : '報價工作草案'}</b></div><p>${isCost ? '目前只建立比較草案，不會覆蓋正式成本。管理員／最高管理員確認後，未來才可發布成新的成本版本。' : '原始 Workbook 保持不變。後續 AI 修改只進入工作草案；確認完成後會輸出新的修正版 Excel／版本。'}</p><div class="quotation-attachment-meta"><span>${escapeHtml(formatBytes(draft.file.size))}</span><span>.${escapeHtml(String(draft.file.extension || '').toUpperCase())}</span><span>${escapeHtml(roleLabel(context.accessRole))}</span><span>${escapeHtml(workbookInfo.futureOfficialExport || '')}</span></div></div>`;
  container.appendChild(root);
  context.ui?.scrollChatToBottom?.();
}

function buildInspectorHtml({ context, draft, workbookInfo }) {
  const isCost = draft.kind === 'cost_master_candidate';
  const canPublish = !!context.capabilities?.canPublishCostMaster;
  return `
    <div class="quotation-inspector-shell">
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
            <p>${isCost ? `PDF／Excel 匯入只建立比較草案。${canPublish ? '你目前有成本版本發布權；正式發布時會建立新版本並保留舊 Snapshot。' : '一般成員不能發布成本版本，需交由管理員／最高管理員確認。'}` : `AI 後續只修改工作副本；確認完成後才輸出新的正式修正版。預計輸出名稱：${escapeHtml(workbookInfo.futureOfficialExport)}`}</p>
          </div>
        </section>

        <section class="quotation-diff-section">
          <div class="quotation-section-head"><div><span>LIVE DRAFT</span><h4>${isCost ? '成本差異草案' : '報價修改草案'}</h4></div><b>等待 Phase 1 / 2 解析</b></div>
          <div class="quotation-table-wrap">
            <table>
              <thead><tr><th>項目</th><th>原始值</th><th>草案值</th><th>狀態</th></tr></thead>
              <tbody><tr><td colspan="4" class="quotation-empty-row">目前已完成「同一聊天窗＋同步工作台」底座；尚未讀取 Excel／PDF 內容，因此不會虛構任何報價或成本資料。</td></tr></tbody>
            </table>
          </div>
        </section>

        <section class="quotation-flow-card">
          <span>後續正式流程</span>
          <div>${isCost ? '<b>匯入</b><i>→</i><b>AI 比對</b><i>→</i><b>Draft</b><i>→</i><b>人工確認</b><i>→</i><b>發布新成本版本</b>' : '<b>原始 Excel</b><i>→</i><b>AI 修改草案</b><i>→</i><b>人工確認</b><i>→</i><b>Patch 工作副本</b><i>→</i><b>匯出新版 Excel</b>'}</div>
        </section>
      </div>
      <footer class="quotation-inspector-footer">
        <div><span class="quotation-safe-dot"></span><span>${isCost ? (canPublish ? '可建立、審核並發布成本新版本' : '可使用報價；成本發布需管理員') : '原檔不可變 · 正式輸出會建立新檔／新版本'}</span></div>
        <button type="button" disabled title="後續 Phase 啟用">${isCost ? '建立比較草案' : '匯出新版 Excel'}</button>
      </footer>
    </div>`;
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

function openInspector({ context, draft, workbookInfo }) {
  latestDraft = draft;
  let root = document.getElementById(INSPECTOR_ID);
  if (!root) {
    root = document.createElement('aside');
    root.id = INSPECTOR_ID;
    root.className = 'quotation-inspector';
    document.body.appendChild(root);
  }
  inspectorCleanup?.(); inspectorCleanup = null;
  root.innerHTML = buildInspectorHtml({ context, draft, workbookInfo });
  root.classList.add('is-open');
  root.dataset.manualPosition = 'false';
  placeInspector(root, context, true);
  inspectorCleanup = enableInspectorDrag(root, context);
  root.querySelector('[data-action="close"]')?.addEventListener('click', () => unmountQuotationInspector());
  return root;
}

function ensureComposerControls({ context, engine, workbook }) {
  const dock = context.getComposerDock?.();
  const row = dock?.querySelector('.glass-mono');
  if (!dock || !row) throw new Error('找不到 LEAVES AI 輸入列，無法掛載報價文件入口。');
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
    if (!meta.ok) { context.ui?.alert?.(`目前只接受 XLSX、XLSM 或 PDF。`, 'AI 報價'); input.value = ''; return; }
    const draft = engine.createDraftEnvelope(meta, context.accessRole);
    const workbookInfo = workbook.createWorkingCopyDescriptor(meta);
    appendAttachmentNotice(context, draft, workbookInfo);
    openInspector({ context, draft, workbookInfo });
    input.value = '';
  };
  return { input, button };
}

export function mountQuotationCapability({ context, engine, workbook }) {
  const ensureMounted = () => ensureComposerControls({ context, engine, workbook });
  ensureMounted();
  context.ui?.markCapabilityReady?.('quote', true);
  return Object.freeze({
    ensureMounted,
    isInspectorOpen: () => document.getElementById(INSPECTOR_ID)?.classList.contains('is-open') || false,
    getLatestDraft: () => latestDraft
  });
}

export function unmountQuotationInspector() {
  const root = document.getElementById(INSPECTOR_ID);
  root?.classList.remove('is-open');
}
