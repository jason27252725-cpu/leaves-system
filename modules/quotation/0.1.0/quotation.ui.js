const ROOT_ID = 'leavesQuotationWorkspace';

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function roleLabel(role) {
  return role === 'owner' ? '最高管理員' : role === 'admin' ? '管理員' : '一般成員';
}

function phaseCard(index, title, description, status = '規劃中') {
  return `<article class="quote-foundation-card"><div class="quote-foundation-index">${index}</div><div><div class="quote-foundation-card-top"><strong>${title}</strong><span>${status}</span></div><p>${description}</p></div></article>`;
}

export function mountQuotationWorkspace({ context, workbook, onClose, onSelfTest }) {
  const host = context.getMountRoot?.();
  if (!host) throw new Error('找不到 LEAVES AI 工作區，無法掛載 AI 報價中心。');
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('section');
    root.id = ROOT_ID;
    root.className = 'leaves-quotation-workspace';
    host.appendChild(root);
  }

  root.innerHTML = `
    <div class="quotation-shell">
      <header class="quotation-header">
        <div class="quotation-heading">
          <span class="quotation-kicker">LEAVES MODULE · QUOTATION 0.1.0</span>
          <h2>AI 報價中心</h2>
          <p>Phase 0｜模組平台底座。這一版只驗證 Lazy Load、權限、版本相容與獨立工作區，不會計算成本或修改 Excel。</p>
        </div>
        <button type="button" class="quotation-close" data-action="close" aria-label="返回 LEAVES AI">×</button>
      </header>

      <div class="quotation-status-row">
        <span><b>Core</b>${context.coreVersion}</span>
        <span><b>Module</b>${context.moduleVersion}</span>
        <span><b>Channel</b>${String(context.channel).toUpperCase()}</span>
        <span><b>Role</b>${roleLabel(context.accessRole)}</span>
      </div>

      <div class="quotation-grid">
        <section class="quotation-panel quotation-intake-panel">
          <div class="quotation-panel-title"><div><span>01</span><h3>報價文件入口</h3></div><em>FOUNDATION</em></div>
          <p>未來會在這裡讀取公司原始 Excel／PDF，建立 Quotation Project，並保留原 Workbook 的格式、公式與版本關係。</p>
          <label class="quotation-dropzone">
            <input type="file" data-role="file" accept=".xlsx,.xlsm,.pdf" hidden>
            <i class="fa-regular fa-file-lines"></i>
            <strong>選擇一份測試報價檔</strong>
            <span>Phase 0 只讀取檔名／容量，不上傳、不解析、不修改。</span>
          </label>
          <div class="quotation-file-result" data-role="fileResult">尚未選擇檔案。</div>
        </section>

        <section class="quotation-panel">
          <div class="quotation-panel-title"><div><span>02</span><h3>成本主檔</h3></div><em>PLANNED</em></div>
          <p>系統櫃 Cost Master、成本版本、生效日期與來源文件將放在 Supabase，不放進 GitHub 公開靜態檔案。</p>
          <div class="quotation-mini-list"><span>Cost Master Schema</span><b>待 Phase 1</b><span>成本版本管理</span><b>待 Phase 1</b><span>成本 Snapshot</span><b>待 Phase 2</b></div>
        </section>

        <section class="quotation-panel">
          <div class="quotation-panel-title"><div><span>03</span><h3>AI 檢查與 BOM</h3></div><em>PLANNED</em></div>
          <p>AI 將理解設計項目、找疑似漏項與成本匹配；數量換算與金額計算交給 deterministic Quote Engine，不讓模型自由心算。</p>
          <div class="quotation-confidence"><span class="exact">精確</span><span class="rule">規則</span><span class="similar">相似</span><span class="none">未匹配</span></div>
        </section>

        <section class="quotation-panel">
          <div class="quotation-panel-title"><div><span>04</span><h3>Workbook Patch</h3></div><em>PLANNED</em></div>
          <p>正式階段採「Patch 原始 Workbook」，不是重新生成長得相似的 Excel。公式、樣式、Merge、列印範圍都要經過匯出前驗證。</p>
          <div class="quotation-mini-list"><span>公式保護</span><b>待 Phase 3</b><span>樣式保留</span><b>待 Phase 3</b><span>Export Validator</span><b>待 Phase 3</b></div>
        </section>
      </div>

      <footer class="quotation-footer">
        <div><span class="quotation-ready-dot"></span><strong>模組已獨立載入</strong><small>Core 未內嵌 Excel／報價引擎，只有點擊 AI 報價時才下載本模組。</small></div>
        <button type="button" class="quotation-test-btn" data-action="selfTest"><i class="fa-solid fa-vial"></i>模組自我檢測</button>
      </footer>
      <div class="quotation-test-result" data-role="selfTestResult"></div>
    </div>`;

  root.querySelector('[data-action="close"]')?.addEventListener('click', () => onClose?.());
  root.querySelector('[data-action="selfTest"]')?.addEventListener('click', async () => {
    const target = root.querySelector('[data-role="selfTestResult"]');
    try {
      const result = await onSelfTest?.();
      if (target) target.textContent = result?.ok === false ? `Self Test FAIL｜${result.message || 'unknown'}` : `Self Test PASS｜Module ${context.moduleVersion} / Core ${context.coreVersion}`;
    } catch (error) {
      if (target) target.textContent = `Self Test FAIL｜${error?.message || error}`;
    }
  });
  root.querySelector('[data-role="file"]')?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    const result = workbook.inspectFile(file);
    const target = root.querySelector('[data-role="fileResult"]');
    if (!target) return;
    if (!result.ok) {
      target.textContent = result.reason === 'NO_FILE' ? '尚未選擇檔案。' : `目前底座不接受 .${result.extension || '?'}；請選擇 XLSX／XLSM／PDF。`;
      target.dataset.state = 'error';
      return;
    }
    target.textContent = `已偵測：${result.name}｜${formatBytes(result.size)}｜.${result.extension.toUpperCase()}｜尚未上傳或解析`;
    target.dataset.state = 'ok';
  });

  root.classList.add('is-open');
  return root;
}

export function unmountQuotationWorkspace() {
  document.getElementById(ROOT_ID)?.classList.remove('is-open');
}
