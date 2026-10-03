export const COST_REVISION_CLIENT_VERSION = '0.4.0';
export const COST_REVISION_STAGE = 'cost-master-revision-ui';

const GATEWAY_FUNCTION_NAME = 'leaves-cost-revision-gateway';
const SESSION_REFRESH_SKEW_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 15 * 1000;
const MAX_DRAFT_LIMIT = 100;

function normalizeEnvironment(value = '') {
  const env = String(value || '').trim().toLowerCase();
  return env === 'stable' ? 'stable' : env === 'sandbox' ? 'sandbox' : '';
}

function sessionStoragePrefix(environment) {
  return environment === 'sandbox' ? 'leaves:sandbox:' : 'leaves:prod:';
}

function readStorage(storage, key) {
  try { return String(storage?.getItem?.(key) || '').trim(); } catch (_) { return ''; }
}

function normalizeSupabaseUrl(value = '') {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch (_) {
    return '';
  }
}

function createRevisionError(message, details = {}) {
  const error = new Error(String(message || 'Cost Revision Gateway request failed'));
  error.name = 'LeavesCostRevisionGatewayError';
  error.code = String(details.code || 'COST_REVISION_GATEWAY_ERROR');
  error.status = Number(details.status || 0);
  error.dbDetail = String(details.dbDetail || '');
  error.retryRequiresFreshPreflight = details.retryRequiresFreshPreflight === true;
  error.publishMayHaveSucceeded = details.publishMayHaveSucceeded === true;
  error.retrySafe = details.retrySafe !== false;
  error.stateVerificationRequired = details.stateVerificationRequired === true;
  return error;
}

function parseErrorPayload(payload, status) {
  return createRevisionError(
    payload?.error || payload?.message || `Cost Revision Gateway request failed (HTTP ${status})`,
    {
      code: payload?.code || (status === 401 ? 'AUTH_INVALID' : `HTTP_${status}`),
      status,
      dbDetail: payload?.dbDetail,
      retryRequiresFreshPreflight: payload?.retryRequiresFreshPreflight,
      publishMayHaveSucceeded: payload?.publishMayHaveSucceeded,
      retrySafe: payload?.retrySafe,
      stateVerificationRequired: payload?.stateVerificationRequired
    }
  );
}

function sanitizeSessionState(session = null) {
  if (!session?.token) {
    return {
      authenticated: false,
      expiresAt: 0,
      actorId: '',
      name: '',
      role: '',
      environment: '',
      capabilities: {}
    };
  }
  return {
    authenticated: true,
    expiresAt: Number(session.expiresAt || 0),
    actorId: String(session.actorId || ''),
    name: String(session.name || ''),
    role: String(session.role || ''),
    environment: String(session.environment || ''),
    capabilities: { ...(session.capabilities || {}) }
  };
}

function normalizeUuid(value = '') {
  const s = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : '';
}

function normalizeItemCode(value = '') {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9_-]{1,80}$/.test(s) ? s : '';
}

function normalizeLockVersion(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 2147483647 ? n : 0;
}

function normalizeVersionLabel(value = '') {
  const s = String(value || '').trim().toUpperCase();
  return /^V\d+\.\d+$/.test(s) ? s : '';
}

function normalizeFingerprint(value = '') {
  const s = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : '';
}

export function createCostRevisionClient(context = {}, options = {}) {
  const environment = normalizeEnvironment(context?.environment);
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  const sessionStore = options.sessionStorage || globalThis.sessionStorage;
  const localStore = options.localStorage || globalThis.localStorage;
  const timeoutMs = Math.max(1500, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));

  let session = null;
  let sessionPromise = null;
  let lastError = null;
  let lastSuccessAt = 0;

  const getActiveCode = () => environment
    ? readStorage(sessionStore, `${sessionStoragePrefix(environment)}shiye_active_code`)
    : '';

  const getSupabaseUrl = () => normalizeSupabaseUrl(readStorage(localStore, 'shiye_supabase_url'));
  const getGatewayUrl = () => {
    const base = getSupabaseUrl();
    return base ? `${base}/functions/v1/${GATEWAY_FUNCTION_NAME}` : '';
  };

  const clearSession = () => {
    session = null;
    sessionPromise = null;
  };

  const invalidateSession = () => { session = null; };

  const hasFreshSession = () => {
    const now = Date.now();
    return !!session?.token &&
      Number(session.expiresAt || 0) > now + SESSION_REFRESH_SKEW_MS &&
      session.environment === environment &&
      session.identityCode === getActiveCode();
  };

  const rawPost = async (body, token = '', requestOptions = {}) => {
    if (!fetchImpl) throw createRevisionError('瀏覽器不支援 Cost Revision Gateway 網路請求。', { code: 'FETCH_UNAVAILABLE' });
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) throw createRevisionError('尚未設定 Supabase URL，成本修訂後台暫時無法使用。', { code: 'SUPABASE_URL_MISSING' });

    const controller = new AbortController();
    let timeoutTriggered = false;
    let externalAbortTriggered = false;
    const timer = setTimeout(() => { timeoutTriggered = true; controller.abort('timeout'); }, timeoutMs);
    const externalSignal = requestOptions?.signal;
    const abortFromExternal = () => {
      externalAbortTriggered = true;
      controller.abort(externalSignal?.reason || 'external-abort');
    };
    if (externalSignal) {
      if (externalSignal.aborted) abortFromExternal();
      else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetchImpl(gatewayUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body || {}),
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) throw parseErrorPayload(payload, response.status);
      return payload;
    } catch (error) {
      if (externalAbortTriggered) throw createRevisionError('Cost Revision Gateway request aborted.', { code: 'REQUEST_ABORTED' });
      if (timeoutTriggered || error?.name === 'AbortError' || controller.signal.aborted) {
        throw createRevisionError('Cost Revision Gateway 連線逾時。', {
          code: requestOptions?.publishRequest ? 'PUBLISH_RESULT_UNCERTAIN' : 'GATEWAY_TIMEOUT',
          publishMayHaveSucceeded: requestOptions?.publishRequest === true,
          retrySafe: requestOptions?.publishRequest !== true,
          stateVerificationRequired: requestOptions?.publishRequest === true
        });
      }
      if (error?.name === 'LeavesCostRevisionGatewayError') throw error;
      throw createRevisionError(
        requestOptions?.publishRequest
          ? 'Atomic Publish 連線結果不確定；請重新讀取 Current / Draft 狀態，禁止直接重送。'
          : 'Cost Revision Gateway 暫時無法連線。',
        {
          code: requestOptions?.publishRequest ? 'PUBLISH_RESULT_UNCERTAIN' : 'GATEWAY_OFFLINE',
          publishMayHaveSucceeded: requestOptions?.publishRequest === true,
          retrySafe: requestOptions?.publishRequest !== true,
          stateVerificationRequired: requestOptions?.publishRequest === true
        }
      );
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener?.('abort', abortFromExternal);
    }
  };

  const exchangeSession = async ({ force = false } = {}) => {
    if (!force && hasFreshSession()) return session;
    if (sessionPromise) return sessionPromise;
    if (!environment) throw createRevisionError('目前 LEAVES environment 無法辨識。', { code: 'BAD_ENVIRONMENT' });

    const activeCode = getActiveCode();
    if (!activeCode) throw createRevisionError('找不到目前 LEAVES 登入通行碼，請重新登入後再使用成本後台。', { code: 'ACTIVE_CODE_MISSING' });

    const task = (async () => {
      const payload = await rawPost({ action: 'session', environment, code: activeCode });
      if (!payload?.token || !Number(payload?.expiresAt)) {
        throw createRevisionError('Cost Revision Gateway 回傳的 Session 格式不完整。', { code: 'SESSION_RESPONSE_INVALID' });
      }
      session = {
        token: String(payload.token),
        expiresAt: Number(payload.expiresAt),
        environment: String(payload.environment || environment),
        actorId: String(payload?.actor?.actorId || payload?.actorId || ''),
        name: String(payload?.actor?.name || payload?.name || ''),
        role: String(payload?.actor?.role || payload?.role || ''),
        identityCode: activeCode,
        capabilities: { ...(payload?.capabilities || {}) }
      };
      if (session.environment !== environment) {
        clearSession();
        throw createRevisionError('Cost Revision Session environment 不符合目前模組。', { code: 'SESSION_SCOPE_INVALID' });
      }
      lastError = null;
      lastSuccessAt = Date.now();
      return session;
    })();

    sessionPromise = task;
    try {
      return await task;
    } catch (error) {
      lastError = error;
      clearSession();
      throw error;
    } finally {
      if (sessionPromise === task) sessionPromise = null;
    }
  };

  const authorizedPost = async (action, payload = {}, requestOptions = {}) => {
    let currentSession = await exchangeSession();
    try {
      const data = await rawPost({ action, ...payload }, currentSession.token, requestOptions);
      lastError = null;
      lastSuccessAt = Date.now();
      return data;
    } catch (error) {
      if (Number(error?.status) === 401 && requestOptions?.retryAuth !== false) {
        invalidateSession();
        currentSession = await exchangeSession({ force: true });
        try {
          const data = await rawPost(
            { action, ...payload },
            currentSession.token,
            { ...requestOptions, retryAuth: false }
          );
          lastError = null;
          lastSuccessAt = Date.now();
          return data;
        } catch (retryError) {
          lastError = retryError;
          throw retryError;
        }
      }
      lastError = error;
      throw error;
    }
  };

  const createDraft = ({ title = '', summary = '', signal } = {}) =>
    authorizedPost('createDraft', { title, summary }, { signal });

  const listDrafts = ({ limit = 25, status = '', signal } = {}) => {
    const safeLimit = Math.max(1, Math.min(MAX_DRAFT_LIMIT, Number.parseInt(String(limit), 10) || 25));
    const payload = { limit: safeLimit };
    if (status) payload.status = String(status);
    return authorizedPost('listDrafts', payload, { signal });
  };

  const getDraft = (draftId, { signal } = {}) => {
    const id = normalizeUuid(draftId);
    if (!id) throw createRevisionError('draftId 格式不正確。', { code: 'BAD_DRAFT_ID' });
    return authorizedPost('getDraft', { draftId: id }, { signal });
  };

  const addChange = ({ draftId, itemCode, proposedUnitCost, reason = '', signal } = {}) => {
    const id = normalizeUuid(draftId);
    const code = normalizeItemCode(itemCode);
    const amount = Number(proposedUnitCost);
    if (!id) throw createRevisionError('draftId 格式不正確。', { code: 'BAD_DRAFT_ID' });
    if (!code) throw createRevisionError('itemCode 格式不正確。', { code: 'BAD_ITEM_CODE' });
    if (!Number.isFinite(amount) || amount < 0) throw createRevisionError('新成本必須是 0 以上的有效數字。', { code: 'BAD_UNIT_COST' });
    return authorizedPost('addChange', {
      draftId: id,
      itemCode: code,
      proposedUnitCost: Math.round(amount * 100) / 100,
      reason
    }, { signal });
  };

  const updateChange = ({ draftId, expectedLockVersion, changeId, proposedUnitCost, reason, signal } = {}) => {
    const id = normalizeUuid(draftId);
    const change = normalizeUuid(changeId);
    const lock = normalizeLockVersion(expectedLockVersion);
    const amount = Number(proposedUnitCost);
    if (!id || !change) throw createRevisionError('Draft / Change ID 格式不正確。', { code: 'BAD_CHANGE_ID' });
    if (!lock) throw createRevisionError('expectedLockVersion 無效。', { code: 'BAD_LOCK_VERSION' });
    if (!Number.isFinite(amount) || amount < 0) throw createRevisionError('新成本必須是 0 以上的有效數字。', { code: 'BAD_UNIT_COST' });
    const payload = {
      draftId: id,
      expectedLockVersion: lock,
      changeId: change,
      proposedUnitCost: Math.round(amount * 100) / 100
    };
    if (reason !== undefined) payload.reason = reason;
    return authorizedPost('updateChange', payload, { signal });
  };

  const removeChange = ({ draftId, expectedLockVersion, changeId, signal } = {}) => {
    const id = normalizeUuid(draftId);
    const change = normalizeUuid(changeId);
    const lock = normalizeLockVersion(expectedLockVersion);
    if (!id || !change) throw createRevisionError('Draft / Change ID 格式不正確。', { code: 'BAD_CHANGE_ID' });
    if (!lock) throw createRevisionError('expectedLockVersion 無效。', { code: 'BAD_LOCK_VERSION' });
    return authorizedPost('removeChange', { draftId: id, expectedLockVersion: lock, changeId: change }, { signal });
  };

  const cancelDraft = ({ draftId, expectedLockVersion, signal } = {}) => {
    const id = normalizeUuid(draftId);
    const lock = normalizeLockVersion(expectedLockVersion);
    if (!id) throw createRevisionError('draftId 格式不正確。', { code: 'BAD_DRAFT_ID' });
    if (!lock) throw createRevisionError('expectedLockVersion 無效。', { code: 'BAD_LOCK_VERSION' });
    return authorizedPost('cancelDraft', { draftId: id, expectedLockVersion: lock }, { signal });
  };

  const submitDraft = ({ draftId, expectedLockVersion, signal } = {}) => {
    const id = normalizeUuid(draftId);
    const lock = normalizeLockVersion(expectedLockVersion);
    if (!id) throw createRevisionError('draftId 格式不正確。', { code: 'BAD_DRAFT_ID' });
    if (!lock) throw createRevisionError('expectedLockVersion 無效。', { code: 'BAD_LOCK_VERSION' });
    return authorizedPost('submitDraft', { draftId: id, expectedLockVersion: lock }, { signal });
  };

  const reviewChange = ({ draftId, expectedLockVersion, changeId, decision, signal } = {}) => {
    const id = normalizeUuid(draftId);
    const change = normalizeUuid(changeId);
    const lock = normalizeLockVersion(expectedLockVersion);
    const normalizedDecision = String(decision || '').trim().toLowerCase();
    if (!id || !change) throw createRevisionError('Draft / Change ID 格式不正確。', { code: 'BAD_CHANGE_ID' });
    if (!lock) throw createRevisionError('expectedLockVersion 無效。', { code: 'BAD_LOCK_VERSION' });
    if (!['accepted', 'rejected'].includes(normalizedDecision)) throw createRevisionError('審核決策必須是 accepted 或 rejected。', { code: 'BAD_REVIEW_DECISION' });
    return authorizedPost('reviewChange', {
      draftId: id,
      expectedLockVersion: lock,
      changeId: change,
      decision: normalizedDecision
    }, { signal });
  };

  const finalizeReview = ({ draftId, expectedLockVersion, signal } = {}) => {
    const id = normalizeUuid(draftId);
    const lock = normalizeLockVersion(expectedLockVersion);
    if (!id) throw createRevisionError('draftId 格式不正確。', { code: 'BAD_DRAFT_ID' });
    if (!lock) throw createRevisionError('expectedLockVersion 無效。', { code: 'BAD_LOCK_VERSION' });
    return authorizedPost('finalizeReview', { draftId: id, expectedLockVersion: lock }, { signal });
  };

  const publishDbPreflight = ({ draftId, expectedLockVersion, proposedVersionLabel, signal } = {}) => {
    const id = normalizeUuid(draftId);
    const lock = normalizeLockVersion(expectedLockVersion);
    const label = normalizeVersionLabel(proposedVersionLabel);
    if (!id) throw createRevisionError('draftId 格式不正確。', { code: 'BAD_DRAFT_ID' });
    if (!lock) throw createRevisionError('expectedLockVersion 無效。', { code: 'BAD_LOCK_VERSION' });
    if (!label) throw createRevisionError('版本格式必須例如 V2.2。', { code: 'BAD_VERSION_LABEL' });
    return authorizedPost('publishDbPreflight', {
      draftId: id,
      expectedLockVersion: lock,
      proposedVersionLabel: label
    }, { signal });
  };

  const publishCostMaster = ({ draftId, expectedLockVersion, proposedVersionLabel, dbPreflightFingerprint, confirmText, signal } = {}) => {
    const id = normalizeUuid(draftId);
    const lock = normalizeLockVersion(expectedLockVersion);
    const label = normalizeVersionLabel(proposedVersionLabel);
    const fingerprint = normalizeFingerprint(dbPreflightFingerprint);
    if (!id) throw createRevisionError('draftId 格式不正確。', { code: 'BAD_DRAFT_ID' });
    if (!lock) throw createRevisionError('expectedLockVersion 無效。', { code: 'BAD_LOCK_VERSION' });
    if (!label) throw createRevisionError('版本格式必須例如 V2.2。', { code: 'BAD_VERSION_LABEL' });
    if (!fingerprint) throw createRevisionError('DB Preflight fingerprint 無效。', { code: 'BAD_PREFLIGHT_FINGERPRINT' });
    return authorizedPost('publishCostMaster', {
      draftId: id,
      expectedLockVersion: lock,
      proposedVersionLabel: label,
      dbPreflightFingerprint: fingerprint,
      confirmText: String(confirmText || '').trim()
    }, { signal, publishRequest: true });
  };

  const health = () => {
    const supabaseUrl = getSupabaseUrl();
    const activeCodeAvailable = !!getActiveCode();
    return {
      ok: !!environment,
      version: COST_REVISION_CLIENT_VERSION,
      stage: COST_REVISION_STAGE,
      mode: 'sandbox-revision-and-atomic-publish',
      environment,
      configured: !!supabaseUrl && activeCodeAvailable,
      gatewayConfigured: !!supabaseUrl,
      activeIdentityAvailable: activeCodeAvailable,
      session: sanitizeSessionState(session),
      lastSuccessAt,
      lastError: lastError ? {
        code: String(lastError.code || ''),
        status: Number(lastError.status || 0),
        message: String(lastError.message || '')
      } : null,
      capabilities: {
        createDraft: true,
        listDrafts: true,
        getDraft: true,
        updateUnitCost: true,
        submitReview: true,
        review: true,
        dbPreflight: true,
        atomicPublish: true,
        stableMutation: false
      }
    };
  };

  return Object.freeze({
    version: COST_REVISION_CLIENT_VERSION,
    stage: COST_REVISION_STAGE,
    createDraft,
    listDrafts,
    getDraft,
    addChange,
    updateChange,
    removeChange,
    cancelDraft,
    submitDraft,
    reviewChange,
    finalizeReview,
    publishDbPreflight,
    publishCostMaster,
    exchangeSession,
    clearSession,
    health,
    getGatewayUrl,
    getSessionState: () => sanitizeSessionState(session)
  });
}
