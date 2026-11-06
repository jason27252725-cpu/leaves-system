export function installWindowStack() {
  const window=globalThis.window,document=window.document,MutationObserver=window.MutationObserver;
  if (window.LeavesWindowStack) return window.LeavesWindowStack;
  const registered = new Set(); let serial = 10000, front = null;
  const selector = '[data-leaves-window],#chatDrawer,.admin-window,.quotation-inspector,.qcm-window,#photoViewerWindow,#versionSummaryModal,#qaDiagnosticPanel,[id*="Quantity"][class*="workspace"],[id*="Quantity"][class*="window"],[id*="quantity"][class*="workspace"]';
  function portal(root) {
    // Share one top-level stacking context. The Core adapter uses viewport
    // coordinates for admin windows after this move; permissions stay in Core.
    if (root.parentElement === document.body) return;
    if (root.id === 'chatDrawer' || root.classList.contains('admin-window') || window.getComputedStyle(root).position === 'fixed') {
      const rect = root.getBoundingClientRect(), admin = root.classList.contains('admin-window');
      document.body.append(root);
      if (admin) { root.style.position = 'fixed'; if (rect.width && rect.height) { root.style.left = rect.left + 'px'; root.style.top = rect.top + 'px'; } }
    }
  }
  function register(root) { for(const old of registered)if(!old.isConnected)registered.delete(old);if (!root?.style) return root; portal(root); root.dataset.leavesWindow = ''; registered.add(root); return root; }
  function raise(root) {
    if (!root?.isConnected) return 0; register(root);
    if (++serial > 80000) { serial = 10000; for (const el of registered) if (el.isConnected) el.style.setProperty('z-index', String(++serial), 'important'); }
    for (const el of registered) el.classList.toggle('leaves-window-front', el === root);
    front = root; root.style.setProperty('z-index', String(serial), 'important');
    return serial;
  }
  const identify = target => { const direct = target?.closest?.(selector); if (direct) return direct; for (let el = target; el && el !== document.body; el = el.parentElement) { const css = window.getComputedStyle(el), r = el.getBoundingClientRect(); if (css.position === 'fixed' && r.width > 200 && r.height > 150 && !el.matches('[role="dialog"],.leaves-system-dialog,#viewAdmin,#appContainer')) return el; } return null; };
  const activate = event => { const root = identify(event.target); if (!root || root.closest('.leaves-system-dialog')) return; const ticket = raise(root); queueMicrotask(() => { if (front === root && root.isConnected) root.style.setProperty('z-index', String(ticket), 'important'); }); };
  document.addEventListener('pointerdown', activate, true); document.addEventListener('focusin', activate, true);
  // Hovering a dragged card over the chat reveals its drop target without sending.
  document.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].some(t => t.startsWith('application/x-leaves-'))) { const root = identify(e.target); if (root && root !== front) raise(root); } }, true);
  window.addEventListener('blur',()=>queueMicrotask(()=>{const active=document.activeElement;if(active?.tagName==='IFRAME'){const root=identify(active);if(root)raise(root);}}));
  const start = () => {
    for (const root of document.querySelectorAll(selector)) register(root);
    const app = document.getElementById('appContainer'), chat = document.getElementById('chatDrawer'), admin = document.getElementById('viewAdmin');
    if (app) new MutationObserver(() => { if (app.classList.contains('hidden-view')) { chat?.classList.remove('open'); for(const el of registered)if(el.classList.contains('admin-window'))el.classList.add('hidden-view'); } }).observe(app, {attributes:true,attributeFilter:['class']});
    if (admin) new MutationObserver(() => { if(admin.classList.contains('hidden-view'))for(const el of registered)if(el.classList.contains('admin-window'))el.classList.add('hidden-view'); }).observe(admin,{attributes:true,attributeFilter:['class']});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
  return window.LeavesWindowStack = Object.freeze({register,raise,unregister(root){registered.delete(root);root?.classList.remove('leaves-window-front');if(front===root)front=null;},get front(){return front;}});
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') installWindowStack();
