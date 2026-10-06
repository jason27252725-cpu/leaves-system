export const COST_MASTER_CLIENT_VERSION = '0.7.1';
export const COST_MASTER_STAGE = 'cost-master-revision-ui';

const GATEWAY_FUNCTION_NAME = 'leaves-cost-gateway';
const SESSION_REFRESH_SKEW_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 12 * 1000;
const MAX_SEARCH_LIMIT = 12;
const MAX_LIST_LIMIT = 100;

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

function createCostError(message, details = {}) {
  const error = new Error(String(message || 'Cost Gateway request failed'));
  error.name = 'LeavesCostGatewayError';
  error.code = String(details.code || 'COST_GATEWAY_ERROR');
  error.status = Number(details.status || 0);
  error.retryAfter = Number(details.retryAfter || 0);
  error.causeCode = String(details.causeCode || '');
  return error;
}

function sanitizeSessionState(session = null) {
  if (!session?.token) {
    return { authenticated: false, expiresAt: 0, actorId: '', name: '', role: '', environment: '' };
  }
  return {
    authenticated: true,
    expiresAt: Number(session.expiresAt || 0),
    actorId: String(session.actorId || ''),
    name: String(session.name || ''),
    role: String(session.role || ''),
    environment: String(session.environment || '')
  };
}

function parseErrorPayload(payload, status) {
  const code = String(payload?.code || (status === 401 ? 'AUTH_INVALID' : `HTTP_${status}`));
  const message = String(payload?.error || payload?.message || `Cost Gateway request failed (HTTP ${status})`);
  return createCostError(message, { code, status, retryAfter: payload?.retryAfter });
}

export function createCostMasterClient(context = {}, options = {}) {
  const environment = normalizeEnvironment(context?.environment);
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  const sessionStore = options.sessionStorage || globalThis.sessionStorage;
  const localStore = options.localStorage || globalThis.localStorage;
  const timeoutMs = Math.max(1500, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));

  let session = null;
  let sessionPromise = null;
  let lastError = null;
  let lastSuccessAt = 0;

  const getActiveCode = () => {
    if (!environment) return '';
    return readStorage(sessionStore, `${sessionStoragePrefix(environment)}shiye_active_code`);
  };

  const getSupabaseUrl = () => normalizeSupabaseUrl(readStorage(localStore, 'shiye_supabase_url'));

  const getGatewayUrl = () => {
    const base = getSupabaseUrl();
    return base ? `${base}/functions/v1/${GATEWAY_FUNCTION_NAME}` : '';
  };

  const invalidateSession = () => {
    session = null;
  };

  const clearSession = () => {
    session = null;
    sessionPromise = null;
  };

  const hasFreshSession = () => {
    const now = Date.now();
    return !!session?.token && Number(session.expiresAt || 0) > now + SESSION_REFRESH_SKEW_MS && session.environment === environment && session.identityCode === getActiveCode();
  };

  const rawPost = async (body, token = '', requestOptions = {}) => {
    if (!fetchImpl) throw createCostError('瀏覽器不支援 Cost Gateway 網路請求。', { code: 'FETCH_UNAVAILABLE' });
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) throw createCostError('尚未設定 Supabase URL，Cost Master 暫時無法讀取。', { code: 'SUPABASE_URL_MISSING' });

    const controller = new AbortController();
    let timeoutTriggered = false;
    let externalAbortTriggered = false;
    const timer = setTimeout(() => { timeoutTriggered = true; controller.abort('timeout'); }, timeoutMs);
    const externalSignal = requestOptions?.signal;
    const abortFromExternal = () => { externalAbortTriggered = true; controller.abort(externalSignal?.reason || 'external-abort'); };
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
      if (externalAbortTriggered) {
        throw createCostError('Cost Gateway request aborted.', { code: 'REQUEST_ABORTED' });
      }
      if (timeoutTriggered || error?.name === 'AbortError' || controller.signal.aborted) {
        throw createCostError('Cost Gateway 連線逾時。', { code: 'GATEWAY_TIMEOUT' });
      }
      if (error?.name === 'LeavesCostGatewayError') throw error;
      throw createCostError('Cost Gateway 暫時無法連線。', { code: 'GATEWAY_OFFLINE', causeCode: error?.name || '' });
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener?.('abort', abortFromExternal);
    }
  };

  const exchangeSession = async ({ force = false } = {}) => {
    if (!force && hasFreshSession()) return session;
    if (sessionPromise) return sessionPromise;
    if (!environment) throw createCostError('目前 LEAVES environment 無法辨識。', { code: 'BAD_ENVIRONMENT' });

    const activeCode = getActiveCode();
    if (!activeCode) throw createCostError('找不到目前 LEAVES 登入通行碼，請重新登入後再使用成本資料。', { code: 'ACTIVE_CODE_MISSING' });

    const task = (async () => {
      const payload = await rawPost({ action: 'session', environment, code: activeCode });
      if (!payload?.token || !Number(payload?.expiresAt)) {
        throw createCostError('Cost Gateway 回傳的 Session 格式不完整。', { code: 'SESSION_RESPONSE_INVALID' });
      }
      session = {
        token: String(payload.token),
        expiresAt: Number(payload.expiresAt),
        environment: String(payload.environment || environment),
        actorId: String(payload.actorId || ''),
        name: String(payload.name || ''),
        role: String(payload.role || ''),
        identityCode: activeCode,
        capabilities: {
          readCostMaster: payload?.capabilities?.readCostMaster === true,
          writeCostMaster: false,
          publishCostMaster: false
        }
      };
      if (session.environment !== environment || session.capabilities.readCostMaster !== true) {
        clearSession();
        throw createCostError('Cost Session environment 或 read-only 權限不符合目前模組。', { code: 'SESSION_SCOPE_INVALID' });
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
          const data = await rawPost({ action, ...payload }, currentSession.token, { ...requestOptions, retryAuth: false });
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

  const current = async (requestOptions = {}) => authorizedPost('current', {}, requestOptions);

  const list = async ({ offset = 0, limit = MAX_LIST_LIMIT, signal } = {}) => {
    const safeOffset = Math.max(0, Math.min(10_000, Number.parseInt(String(offset), 10) || 0));
    const safeLimit = Math.max(1, Math.min(MAX_LIST_LIMIT, Number.parseInt(String(limit), 10) || MAX_LIST_LIMIT));
    return authorizedPost('list', { offset: safeOffset, limit: safeLimit }, { signal });
  };

  const item = async (itemCode, requestOptions = {}) => {
    const normalized = String(itemCode || '').trim().toUpperCase();
    if (!/^SC-\d{3,6}$/.test(normalized)) throw createCostError('itemCode 格式不正確。', { code: 'BAD_ITEM_CODE' });
    return authorizedPost('item', { itemCode: normalized }, requestOptions);
  };

  const search = async (query, { limit = 8, signal } = {}) => {
    const q = String(query || '').trim();
    if (!q || q.length > 160) throw createCostError('搜尋文字長度不正確。', { code: 'BAD_QUERY' });
    const safeLimit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Number.parseInt(String(limit), 10) || 8));
    return authorizedPost('search', { q, limit: safeLimit }, { signal });
  };

  const health = () => {
    const supabaseUrl = getSupabaseUrl();
    const activeCodeAvailable = !!getActiveCode();
    return {
      ok: !!environment,
      version: COST_MASTER_CLIENT_VERSION,
      stage: COST_MASTER_STAGE,
      mode: 'read-only',
      environment,
      configured: !!supabaseUrl && activeCodeAvailable,
      gatewayConfigured: !!supabaseUrl,
      activeIdentityAvailable: activeCodeAvailable,
      session: sanitizeSessionState(session),
      lastSuccessAt,
      lastError: lastError ? { code: String(lastError.code || ''), status: Number(lastError.status || 0), message: String(lastError.message || '') } : null,
      capabilities: { current: true, list: true, item: true, search: true, write: false, publish: false }
    };
  };

  return Object.freeze({
    version: COST_MASTER_CLIENT_VERSION,
    stage: COST_MASTER_STAGE,
    mode: 'read-only',
    current,
    list,
    item,
    search,
    exchangeSession,
    clearSession,
    health,
    getGatewayUrl,
    getSessionState: () => sanitizeSessionState(session)
  });
}
