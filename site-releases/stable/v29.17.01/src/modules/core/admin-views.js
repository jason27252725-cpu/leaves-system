function renderUsageLedgerBadges(){}

function renderAuditCenterLocal() {
const xs=aiAuditSession.filter(x=>x.rag); const today=new Date().toISOString().slice(0,10); const todays=xs.filter(x=>String(x.ts).startsWith(today));
setTextById('auditTodayQuestions', todays.length.toLocaleString());
const avg=todays.length?todays.reduce((n,x)=>n+Number(x.rag?.savingsPct||0),0)/todays.length:0; setTextById('auditAvgSavings', `${avg.toFixed(1)}%`);
setTextById('auditLowConfidence', todays.filter(x=>x.rag?.confidence==='LOW'||x.rag?.matchConfidence==='LOW'||x.rag?.coverageConfidence==='LOW').length.toLocaleString());
const badge=document.getElementById('ragIndexStateBadge'); if(badge){ badge.textContent=sopRagRuntime.chunks.length?`r${sopRagRuntime.revision||'--'} · ${sopRagRuntime.chunks.length} chunks`:'尚未建立'; }
const xray=document.getElementById('ragXrayList'); if(xray){ xray.innerHTML=xs.length?xs.slice(0,40).map(x=>{ const r=x.rag||{}; const overall=r.confidence||'LOW'; const cls=overall==='HIGH'?'rag-confidence-high':overall==='MEDIUM'?'rag-confidence-medium':'rag-confidence-low'; return `<div class="rag-xray-row"><div class="min-w-0"><div class="flex flex-wrap items-center gap-1.5"><div class="text-[10px] text-white truncate">${escapeHtml(x.question||'')}</div><span class="text-[8px] font-mono px-1.5 py-0.5 rounded border border-white/10 text-neutral-400">${escapeHtml(r.intent||'GENERAL')}</span></div><div class="text-[9px] text-neutral-500 mt-1">${(r.selected||[]).slice(0,6).map(c=>`${escapeHtml(c.id)} ${escapeHtml(c.section)} ${Number(c.score||0).toFixed(1)}`).join(' · ')||'無 SOP 命中'}</div><div class="text-[8px] text-neutral-600 font-mono mt-1">Match ${escapeHtml(r.matchConfidence||r.confidence||'--')} · Coverage ${escapeHtml(r.coverageConfidence||r.confidence||'--')} · Pass ${Number(r.passes||1)}</div></div><div class="text-right shrink-0"><div class="text-[10px] font-mono ${cls}">${escapeHtml(overall)}</div><div class="text-[9px] text-neutral-500 font-mono">${Number(r.contextTokens||0).toLocaleString()}T · -${Number(r.savingsPct||0).toFixed(1)}%</div></div></div>`; }).join(''):'<div class="text-[10px] text-neutral-500 p-3">尚無本工作階段 X-Ray 紀錄。</div>'; }
const logs=document.getElementById('aiAuditLogList'); if(logs){ logs.innerHTML=aiAuditSession.length?aiAuditSession.slice(0,40).map(x=>`<div class="rounded-xl border border-neutral-800 bg-black/20 p-3"><div class="flex justify-between gap-3"><div class="text-[10px] text-white truncate">${escapeHtml(x.question||'')}</div><div class="text-[9px] text-neutral-500 font-mono shrink-0">${new Date(x.ts).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}</div></div><div class="text-[9px] text-neutral-500 mt-1 line-clamp-2">${escapeHtml(String(x.answer||'').slice(0,260))}</div><div class="text-[9px] text-neutral-600 font-mono mt-2">${escapeHtml(x.model||'--')} · ${Number(x.tokens||0).toLocaleString()} T</div></div>`).join(''):'<div class="text-[10px] text-neutral-500 p-3">尚無本工作階段問答日誌。</div>'; }
}

function formatReleaseDate(dateStr) {
return String(dateStr || '').replaceAll('-', '.');
}

function normalizeReleaseVersion(value, fallback) {
const v = String(value || '').trim();
return /^v\d+\.\d+(?:\.\d+)?(?:[-._a-zA-Z0-9]+)?$/.test(v) ? v : fallback;
}

function renderReleaseEnvironmentCenter() {
const manifest = normalizeReleaseManifest(releaseManifest || getDefaultReleaseManifest(), releaseManifestRowUpdatedAt);
initReleaseCreatorInteractions();
const latest = getCurrentRelease();
const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
set('releaseCurrentBuildText', `${latest.version} · ${APP_ENVIRONMENT.toUpperCase()}`);
const currentEnvText = document.getElementById('releaseCurrentEnvironmentText');
if (currentEnvText) {
currentEnvText.textContent = APP_ENVIRONMENT === 'sandbox' ? '沙盒' : '正式版';
currentEnvText.className = `text-sm font-medium ${APP_ENVIRONMENT === 'sandbox' ? 'text-purple-200' : 'text-emerald-200'}`;
}
set('releaseStableVersionText', manifest.stableVersion);
set('releaseSandboxVersionText', manifest.sandboxVersion);
set('releaseManifestRevisionText', `版本指標 r${manifest.revision || 1}`);
set('releaseManifestStableValue', manifest.stableVersion);
set('releaseManifestSandboxValue', manifest.sandboxVersion);
set('releaseManifestPreviousValue', manifest.previousStableVersion || '--');
set('releaseManifestSchemaValue', String(manifest.schemaVersion || RELEASE_MANIFEST_SCHEMA_VERSION));
set('releaseStableUrlText', getReleaseUrl(manifest.stableVersion));
set('releaseSandboxUrlText', getReleaseUrl(manifest.sandboxVersion));

const bootstrapNotice = document.getElementById('releaseBootstrapNotice');
const bootstrapMessage = document.getElementById('releaseBootstrapMessage');
const bootstrapBtn = document.getElementById('releaseBootstrapRegisterBtn');
const sandboxManifestMismatch = APP_ENVIRONMENT === 'sandbox' && manifest.sandboxVersion !== BUILD_VERSION;
if (bootstrapNotice) bootstrapNotice.classList.toggle('show', sandboxManifestMismatch);
if (bootstrapMessage && sandboxManifestMismatch) {
bootstrapMessage.textContent = `你目前正在執行 ${BUILD_VERSION} 沙盒，但雲端「目前沙盒版」仍是 ${manifest.sandboxVersion}，所以「已登錄的測試版入口」目前會指向 ${manifest.sandboxVersion}。按下右側按鈕後只會把沙盒指標改成 ${BUILD_VERSION}，正式版 ${manifest.stableVersion} 不會被修改。`;
}
if (bootstrapBtn) {
bootstrapBtn.disabled = !isSuperAdminSession() || !sandboxManifestMismatch || deploymentOperationBusy;
bootstrapBtn.title = sandboxManifestMismatch ? `將目前 ${BUILD_VERSION} 登錄為沙盒，不影響正式版 ${manifest.stableVersion}` : '目前版本已經是已登錄的沙盒版本';
}

const registerBtn = document.getElementById('releaseRegisterSandboxBtn');
const promoteBtn = document.getElementById('releasePromoteBtn');
const rollbackBtn = document.getElementById('releaseRollbackBtn');
if (registerBtn) {
registerBtn.disabled = APP_ENVIRONMENT !== 'sandbox' || manifest.sandboxVersion === BUILD_VERSION || deploymentOperationBusy;
registerBtn.title = APP_ENVIRONMENT !== 'sandbox' ? '請從 Sandbox 版本操作' : (manifest.sandboxVersion === BUILD_VERSION ? '目前版本已登錄為 Sandbox' : `將 ${BUILD_VERSION} 登錄為 Sandbox candidate`);
}
if (promoteBtn) {
promoteBtn.disabled = !isSuperAdminSession() || APP_ENVIRONMENT !== 'sandbox' || manifest.sandboxVersion !== BUILD_VERSION || manifest.stableVersion === BUILD_VERSION || deploymentOperationBusy;
}
if (rollbackBtn) {
rollbackBtn.disabled = !isSuperAdminSession() || deploymentOperationBusy || (!manifest.previousStableVersion && deploymentState.status !== 'failed');
}
renderReleaseCandidateValidation();
const creatorPanel = document.getElementById('releaseCreatorPanel');
if (creatorPanel) creatorPanel.style.opacity = (APP_ENVIRONMENT === 'sandbox' && isSuperAdminSession()) ? '1' : '.52';
const seed = document.getElementById('releaseSandboxSeedState');
if (seed) {
const ok = sandboxSeedStatus.global && sandboxSeedStatus.sop && sandboxSeedStatus.maintenance;
seed.innerHTML = ok
? `<span class="text-emerald-300">✓ 沙盒核心資料已隔離</span><br><span class="text-neutral-600 font-mono">${escapeHtml(SANDBOX_GLOBAL_STATE_ROW_ID)} · ${escapeHtml(SANDBOX_SOP_DOCUMENT_ROW_ID)}</span>`
: `<span class="text-amber-300">尚未完成沙盒核心資料檢查</span>${sandboxSeedStatus.error ? `<br><span class="text-red-300">${escapeHtml(sandboxSeedStatus.error)}</span>` : ''}`;
}
}

function renderReleaseHealthChecks(items) {
const box = document.getElementById('releaseHealthCheckList');
if (!box) return;
box.innerHTML = items.map(item => `
                <div class="release-health-row">
                    <div class="min-w-0"><div class="text-[10px] text-neutral-200">${escapeHtml(item.label)}</div><div class="text-[8px] text-neutral-600 mt-1 font-mono break-all">${escapeHtml(item.detail || '')}</div></div>
                    <span class="release-health-status ${item.ok ? 'pass' : 'fail'}">${item.ok ? '通過' : '失敗'}</span>
                </div>`).join('');
}

function renderReleaseCandidateValidation() {
const result = releaseUploadState.validation;
const list = document.getElementById('releaseCandidateValidationList');
const versionEl = document.getElementById('releaseCandidateVersion');
const schemaEl = document.getElementById('releaseCandidateSchema');
const stateEl = document.getElementById('releaseCandidateValidationState');
const uploadBtn = document.getElementById('releaseUploadCandidateBtn');
if (versionEl) versionEl.textContent = releaseUploadState.version || '--';
if (schemaEl) schemaEl.textContent = releaseUploadState.appSchemaVersion ? `schema ${releaseUploadState.appSchemaVersion}` : '--';
if (stateEl) {
stateEl.textContent = result ? (result.allPass ? '通過' : '失敗') : '等待中';
stateEl.className = `text-[10px] font-mono mt-1 block ${result ? (result.allPass ? 'text-emerald-300' : 'text-red-300') : 'text-neutral-500'}`;
}
if (list) {
list.innerHTML = result ? result.items.map(item => `
                    <div class="release-validator-row">
                        <div class="min-w-0"><div class="text-[9px] text-neutral-200">${escapeHtml(item.label)}</div><div class="text-[8px] text-neutral-600 mt-1 font-mono break-all">${escapeHtml(item.detail)}</div></div>
                        <span class="release-health-status ${item.ok ? 'pass' : 'fail'}">${item.ok ? '通過' : '失敗'}</span>
                    </div>`).join('') : '<div class="text-[9px] text-neutral-600">選擇新版 HTML 後，這裡會顯示完整檢查結果。</div>';
}
if (uploadBtn) uploadBtn.disabled = !result?.allPass || releaseUploadState.busy || APP_ENVIRONMENT !== 'sandbox' || !isSuperAdminSession();
}

function renderDeploymentChecks(items, targetId = 'releaseDeploymentChecks') {
const box = document.getElementById(targetId);
if (!box) return;
if (!Array.isArray(items) || !items.length) {
box.innerHTML = '<div class="text-[9px] text-neutral-600">尚無部署檢查項目。</div>';
return;
}
box.innerHTML = items.map(item => `
                <div class="release-health-row">
                    <div class="min-w-0"><div class="text-[10px] text-neutral-200">${escapeHtml(item.label || 'Check')}</div><div class="text-[8px] text-neutral-600 mt-1 font-mono break-all">${escapeHtml(item.detail || '')}</div></div>
                    <span class="release-health-status ${item.ok ? 'pass' : 'fail'}">${item.ok ? '通過' : '失敗'}</span>
                </div>`).join('');
}

function renderDeploymentState(next = deploymentState) {
deploymentState = normalizeDeploymentState(next);
const [label, cls] = deploymentStatusMeta(deploymentState.status);
const badge = document.getElementById('releaseDeploymentStatusBadge');
const step = document.getElementById('releaseDeploymentStepText');
const route = document.getElementById('releaseDeploymentRouteText');
const pct = document.getElementById('releaseDeploymentProgressText');
const bar = document.getElementById('releaseDeploymentProgressBar');
if (badge) { badge.textContent = label; badge.className = `release-health-status ${cls}`; }
if (step) step.textContent = deploymentState.error ? `${deploymentState.step}｜${deploymentState.error}` : deploymentState.step;
if (route) route.textContent = `${deploymentState.sourceVersion || '--'} → ${deploymentState.targetVersion || '--'}`;
if (pct) pct.textContent = `${Math.round(deploymentState.progress)}%`;
if (bar) bar.style.width = `${deploymentState.progress}%`;
renderDeploymentChecks(deploymentState.checks);

const panel = document.getElementById('maintenanceDeploymentPanel');
const mRoute = document.getElementById('maintenanceDeploymentRoute');
const mPct = document.getElementById('maintenanceDeploymentPercent');
const mBar = document.getElementById('maintenanceDeploymentBar');
const mStep = document.getElementById('maintenanceDeploymentStep');
const active = ['preparing','health_gate','maintenance','switching','verifying','rolling_back'].includes(deploymentState.status) || (maintenanceState?.enabled && deploymentState.progress > 0);
if (panel) panel.classList.toggle('active', active);
if (mRoute) mRoute.textContent = `${deploymentState.sourceVersion || '--'} → ${deploymentState.targetVersion || '--'}`;
if (mPct) mPct.textContent = `${Math.round(deploymentState.progress)}%`;
if (mBar) mBar.style.width = `${deploymentState.progress}%`;
if (mStep) mStep.textContent = deploymentState.error ? `${deploymentState.step}｜${deploymentState.error}` : deploymentState.step;
renderReleaseEnvironmentCenter();
maybeRedirectAfterDeployment();
}

function renderMaintenanceAdminUi() {
const state = normalizeMaintenanceState(maintenanceState);
const statusDot = document.getElementById('maintenanceAdminStatusDot');
const statusText = document.getElementById('maintenanceAdminStatusText');
const reason = document.getElementById('maintenanceReasonInput');
const updated = document.getElementById('maintenanceLastUpdateText');
const list = document.getElementById('maintenanceEventList');
const enableBtn = document.getElementById('maintenanceEnableBtn');
const disableBtn = document.getElementById('maintenanceDisableBtn');

if (statusDot) statusDot.className = `maintenance-live-dot ${state.enabled ? 'offline' : 'online'}`;
if (statusText) {
statusText.textContent = state.enabled ? '維護模式啟用中' : '正常運行';
statusText.className = `text-sm font-medium ${state.enabled ? 'text-amber-300' : 'text-emerald-300'}`;
}
if (reason && document.activeElement !== reason) reason.value = state.message || '';
if (updated) updated.textContent = state.updatedAt ? `更新 ${formatMaintenanceTime(state.updatedAt)}` : '--';
if (enableBtn) enableBtn.disabled = maintenanceWriteInFlight || state.enabled;
if (disableBtn) disableBtn.disabled = maintenanceWriteInFlight || !state.enabled;
if (list) {
const events = state.events || [];
list.innerHTML = events.length ? events.map(evt => `
                    <div class="flex items-start justify-between gap-3 rounded-xl border border-neutral-800 bg-black/20 px-3 py-2">
                        <div><span class="${evt.enabled ? 'text-amber-300' : 'text-emerald-300'}">${evt.enabled ? '啟用維護' : '結束維護'}</span><span class="text-neutral-600 ml-2">${escapeHtml(evt.actor || 'SYSTEM')}</span></div>
                        <span class="text-[9px] text-neutral-600 font-mono shrink-0">${escapeHtml(formatMaintenanceTime(evt.at))}</span>
                    </div>`).join('') : '<div class="text-neutral-600">尚無紀錄</div>';
}
}

function renderSystemVersionRail() {
const rail = document.getElementById('versionHistoryRail');
const count = document.getElementById('versionRailCount');
if (!rail) return;
const releases = filterSystemReleases();
if (count) count.textContent = `${releases.length} / ${SYSTEM_VERSION_HISTORY.length}`;

if (!releases.length) {
rail.innerHTML = `
                    <div class="text-center py-10 px-3 text-neutral-600">
                        <i class="fa-solid fa-magnifying-glass text-lg mb-2"></i>
                        <p class="text-[10px]">找不到符合條件的版本</p>
                    </div>
                `;
return;
}

if (!releases.some(v => v.version === currentSystemVersionView)) {
currentSystemVersionView = releases[0].version;
renderSystemUpdateDetails(currentSystemVersionView);
}

rail.innerHTML = releases.map((v, idx) => {
const fixes = (v.summaryItems || []).filter(x => x.type === 'fix').length;
const additions = (v.summaryItems || []).filter(x => x.type === 'feat').length;
return `
                    <button type="button" onclick="selectSystemVersion('${v.version}')" class="release-rail-btn ${v.version === currentSystemVersionView ? 'is-active' : ''}">
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center gap-1.5 min-w-0">
                                <span class="text-[10px] text-white font-mono">${v.version}</span>
                                ${idx === 0 && v.version === getCurrentRelease().version ? '<span class="text-[7px] text-emerald-300 border border-emerald-900/60 bg-emerald-950/30 px-1.5 py-0.5 rounded-full">CURRENT</span>' : ''}
                            </div>
                            <span class="text-[8px] text-neutral-600 font-mono shrink-0">${formatReleaseDate(v.date)}</span>
                        </div>
                        <p class="text-[9px] text-neutral-400 leading-relaxed mt-1.5 line-clamp-2">${escapeHtml(v.title)}</p>
                        <div class="flex items-center gap-1.5 mt-2">
                            <span class="text-[8px] text-neutral-500 border border-neutral-800 px-1.5 py-0.5 rounded">${(v.summaryItems || []).length} 項</span>
                            ${fixes ? `<span class="text-[8px] text-amber-400/80">${fixes} 修復</span>` : ''}
                            ${additions ? `<span class="text-[8px] text-emerald-400/80">${additions} 新增</span>` : ''}
                        </div>
                    </button>
                `;
}).join('');
}

async function renderTokenAnalytics(){}

function renderDailyArchiveTable(){}

function renderCompanyModelTelemetry(){}

function renderModelHealthRankingRows(){}

function renderAutoFreeDashboard() {
refreshModelHealthCenter(false).catch(()=>{});
const lastNodeText=document.getElementById('lastAssignedNodeText');
const lastModel=appStorage.getItem('shiye_last_real_model');
if(lastNodeText)lastNodeText.innerHTML=lastModel?`本機最近實體指派模型：<span class="text-white font-semibold font-mono">${escapeHtml(lastModel)}</span>`:'本機最近實體指派模型：尚無本機問答紀錄';
renderCompanyModelTelemetry();
}

function renderErrorLogs() {
const container = document.getElementById('errorLogsContainer');
const countBadge = document.getElementById('errorLogsCountBadge');
if(!container) return;

const logs = safeJsonParse(appStorage.getItem('shiye_error_logs'), []);
countBadge.textContent = `${logs.length} 筆`;

if (logs.length === 0) {
container.innerHTML = `
                    <div class="p-8 text-center border border-dashed border-neutral-800 rounded-2xl">
                        <i class="fa-solid fa-circle-check text-neutral-600 text-2xl mb-1.5"></i>
                        <p class="text-xs text-neutral-500">目前尚無任何錯誤回報紀錄</p>
                    </div>
                `;
return;
}

container.innerHTML = logs.map(l => `
                <div class="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-2 selectable-text">
                    <div class="flex justify-between items-center text-[10px] text-neutral-400 font-mono border-b border-neutral-900 pb-2">
                        <span class="text-white font-medium">${escapeHtml(l.name)} (${escapeHtml(l.code)})</span>
                        <span>${escapeHtml(l.time)}</span>
                    </div>
                    <div class="text-xs text-neutral-300"><strong>問：</strong>${escapeHtml(l.question)}</div>
                    <div class="text-xs text-neutral-400 font-mono"><strong>答：</strong>${escapeHtml(l.answer)}</div>
                </div>
            `).join('');
}
