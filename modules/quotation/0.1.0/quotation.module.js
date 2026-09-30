import { createQuotationEngine } from './quotation.engine.js';
import { createWorkbookBridge } from './quotation.workbook.js';
import { mountQuotationWorkspace, unmountQuotationWorkspace } from './quotation.ui.js';

export async function registerLeavesModule(context) {
  const engine = createQuotationEngine();
  const workbook = createWorkbookBridge();

  const selfTest = async () => {
    const errors = [];
    if (!context?.coreVersion) errors.push('missing coreVersion');
    if (!context?.moduleVersion) errors.push('missing moduleVersion');
    if (!context?.getMountRoot?.()) errors.push('missing chatDrawer mount root');
    if (!engine.health().ok) errors.push('quotation engine unhealthy');
    if (!workbook.health().ok) errors.push('workbook bridge unhealthy');
    return { ok: errors.length === 0, errors, engine: engine.health(), workbook: workbook.health() };
  };

  return Object.freeze({
    async open() {
      context.ui?.openChat?.();
      context.ui?.setRailActiveByAction?.('quote');
      mountQuotationWorkspace({ context, engine, workbook, onClose: () => this.close(), onSelfTest: selfTest });
    },
    async close() {
      unmountQuotationWorkspace();
      context.ui?.setRailActiveByAction?.('chat');
    },
    async selfTest() {
      return selfTest();
    },
    getStatus() {
      return { key: context.moduleKey, version: context.moduleVersion, stage: engine.stage, engine: engine.health(), workbook: workbook.health() };
    }
  });
}
