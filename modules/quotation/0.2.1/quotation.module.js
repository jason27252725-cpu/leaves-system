import { createQuotationEngine } from './quotation.engine.js';
import { createWorkbookBridge } from './quotation.workbook.js';
import { mountQuotationCapability, unmountQuotationInspector } from './quotation.ui.js';

export async function registerLeavesModule(context) {
  const engine = createQuotationEngine();
  const workbook = createWorkbookBridge();
  let uiApi = null;

  const selfTest = async () => {
    const errors = [];
    if (!context?.coreVersion) errors.push('missing coreVersion');
    if (!context?.moduleVersion) errors.push('missing moduleVersion');
    if (!context?.getMountRoot?.()) errors.push('missing chatDrawer mount root');
    if (!context?.getChatContainer?.()) errors.push('missing chatContainer');
    if (!context?.getComposerDock?.()) errors.push('missing chat composer');
    if (!engine.health().ok) errors.push('quotation engine unhealthy');
    if (!workbook.health().ok) errors.push('workbook bridge unhealthy');
    const draftProbe = engine.normalizeDraftEnvelope(engine.createDraftEnvelope({ name: 'probe.xlsx', size: 1, lastModified: 1, extension: 'xlsx' }, context.accessRole));
    if (!draftProbe?.draftId || !draftProbe?.sourceFileId) errors.push('draft identity foundation unavailable');
    return {
      ok: errors.length === 0,
      errors,
      engine: engine.health(),
      workbook: workbook.health(),
      draftIdentity: !!draftProbe?.draftId && !!draftProbe?.sourceFileId,
      permissions: {
        canManageCostMaster: !!context.capabilities?.canManageCostMaster,
        canPublishCostMaster: !!context.capabilities?.canPublishCostMaster
      }
    };
  };

  const ensureMounted = () => {
    if (!uiApi) {
      uiApi = mountQuotationCapability({ context, engine, workbook, onSelfTest: selfTest });
    } else {
      uiApi.ensureMounted?.();
    }
    context.ui?.markCapabilityReady?.('quote', true);
    return uiApi;
  };

  return Object.freeze({
    async open() {
      context.ui?.openChat?.();
      ensureMounted();
      context.ui?.setRailActiveByAction?.('chat');
      return { ok: true, mode: 'seamless-capability' };
    },
    async close() {
      unmountQuotationInspector();
      context.ui?.setRailActiveByAction?.('chat');
    },
    async selfTest() {
      ensureMounted();
      return selfTest();
    },
    getStatus() {
      return {
        key: context.moduleKey,
        version: context.moduleVersion,
        stage: engine.stage,
        seamless: true,
        engine: engine.health(),
        workbook: workbook.health(),
        inspectorOpen: !!uiApi?.isInspectorOpen?.(),
        draftCount: Number(uiApi?.getDraftCount?.() || 0),
        activeDraftId: uiApi?.getActiveDraftId?.() || null
      };
    }
  });
}
