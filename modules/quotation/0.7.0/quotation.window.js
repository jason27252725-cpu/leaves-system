export const QUOTATION_WINDOW_VERSION = '0.7.0';

const HANDLE_NAMES = ['t','b','l','r','tl','tr','bl','br'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ensureHandles(root) {
  if (!root || root.querySelector('[data-q-resize-handle]')) return;
  HANDLE_NAMES.forEach(name => {
    const el = document.createElement('div');
    el.className = `quotation-window-resize quotation-window-resize-${name}`;
    el.dataset.qResizeHandle = name;
    root.appendChild(el);
  });
}

function chatSizedRect(context, options = {}) {
  const drawer = context?.getMountRoot?.();
  const r = drawer?.getBoundingClientRect?.();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = clamp(Number(r?.width || options.defaultWidth || 720), 420, Math.max(420, vw - 24));
  const height = clamp(Number(r?.height || options.defaultHeight || 720), 420, Math.max(420, vh - 24));
  let left = Number.isFinite(r?.left) ? r.left : Math.max(12, (vw - width) / 2);
  let top = Number.isFinite(r?.top) ? r.top : Math.max(12, (vh - height) / 2);
  if (options.offsetFromChat) {
    const candidate = left - width - 14;
    left = candidate >= 8 ? candidate : clamp(left + 36, 8, Math.max(8, vw - width - 8));
  }
  return { width, height, left: clamp(left, 8, Math.max(8, vw - width - 8)), top: clamp(top, 8, Math.max(8, vh - height - 8)) };
}

export function attachQuotationWindow(root, header, context, options = {}) {
  if (!root) return { cleanup() {}, reset() {} };
  root._quotationWindowManagerCleanup?.();
  ensureHandles(root);
  const minW = Number(options.minWidth || 420);
  const minH = Number(options.minHeight || 360);
  let mode = '';
  let handle = '';
  let sx = 0, sy = 0, sw = 0, sh = 0, sl = 0, st = 0;
  let rafId = 0;
  let pendingPointer = null;

  const raise = () => {
    const next = Number(window.__leavesQuotationZIndex || 210) + 1;
    window.__leavesQuotationZIndex = next;
    root.style.zIndex = String(next);
  };
  const applyRect = rect => {
    root.style.left = `${Math.round(rect.left)}px`;
    root.style.top = `${Math.round(rect.top)}px`;
    root.style.width = `${Math.round(rect.width)}px`;
    root.style.height = `${Math.round(rect.height)}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.style.transform = 'none';
  };
  const reset = () => {
    if (window.innerWidth <= 760) {
      root.style.left = '8px'; root.style.top = '8px'; root.style.right = '8px'; root.style.bottom = '8px';
      root.style.width = 'auto'; root.style.height = 'auto'; root.style.transform = 'none';
      root.dataset.manualPosition = 'false';
      return;
    }
    applyRect(chatSizedRect(context, options));
    root.dataset.manualPosition = 'false';
  };
  const begin = (e, kind, handleName = '') => {
    if (window.innerWidth <= 760) return;
    if (kind === 'drag' && e.target.closest('button,input,select,textarea,[contenteditable="true"]')) return;
    e.preventDefault(); e.stopPropagation(); raise();
    const rect = root.getBoundingClientRect();
    mode = kind; handle = handleName; sx = e.clientX; sy = e.clientY; sw = rect.width; sh = rect.height; sl = rect.left; st = rect.top;
    root.dataset.manualPosition = 'true';
    root.classList.add('is-window-interacting');
    document.body.style.userSelect = 'none';
  };
  const applyPointer = e => {
    if (!mode || !e) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (mode === 'drag') {
      const left = clamp(sl + dx, 4, Math.max(4, vw - sw - 4));
      const top = clamp(st + dy, 4, Math.max(4, vh - sh - 4));
      applyRect({left, top, width:sw, height:sh});
      return;
    }
    let left = sl, top = st, width = sw, height = sh;
    if (handle.includes('r')) width = clamp(sw + dx, minW, vw - sl - 4);
    if (handle.includes('b')) height = clamp(sh + dy, minH, vh - st - 4);
    if (handle.includes('l')) {
      const maxDx = sw - minW; const actualDx = clamp(dx, -sl + 4, maxDx);
      left = sl + actualDx; width = sw - actualDx;
    }
    if (handle.includes('t')) {
      const maxDy = sh - minH; const actualDy = clamp(dy, -st + 4, maxDy);
      top = st + actualDy; height = sh - actualDy;
    }
    applyRect({left, top, width, height});
  };
  const flushPointer = () => {
    rafId = 0;
    const e = pendingPointer;
    pendingPointer = null;
    applyPointer(e);
  };
  const move = e => {
    if (!mode) return;
    pendingPointer = { clientX: e.clientX, clientY: e.clientY };
    if (!rafId) rafId = requestAnimationFrame(flushPointer);
  };
  const end = () => {
    if (!mode) return;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (pendingPointer) applyPointer(pendingPointer);
    pendingPointer = null;
    mode=''; handle='';
    root.classList.remove('is-window-interacting');
    document.body.style.userSelect='';
  };
  const onResize = () => {
    if (window.innerWidth <= 760) reset();
    else {
      const r=root.getBoundingClientRect();
      applyRect({left:clamp(r.left,4,Math.max(4,window.innerWidth-r.width-4)),top:clamp(r.top,4,Math.max(4,window.innerHeight-r.height-4)),width:Math.min(r.width,window.innerWidth-8),height:Math.min(r.height,window.innerHeight-8)});
    }
  };
  const onRootDown = () => raise();
  root.addEventListener('pointerdown', onRootDown);
  header?.addEventListener('pointerdown', e => begin(e,'drag'));
  root.querySelectorAll('[data-q-resize-handle]').forEach(el => el.addEventListener('pointerdown', e => begin(e,'resize',el.dataset.qResizeHandle||'')));
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('resize', onResize);
  reset(); raise();
  const cleanup = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0; pendingPointer = null;
    root.classList.remove('is-window-interacting');
    root.removeEventListener('pointerdown', onRootDown);
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('resize', onResize);
    root._quotationWindowManagerCleanup = null;
  };
  root._quotationWindowManagerCleanup = cleanup;
  return { cleanup, reset, raise };
}
