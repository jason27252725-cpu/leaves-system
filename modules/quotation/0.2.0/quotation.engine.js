export const QUOTATION_ENGINE_VERSION = '0.2.0';
export const QUOTATION_STAGE = 'seamless-capability-foundation';

function inferDocumentKind(name = '') {
  const value = String(name || '').toLowerCase();
  if (/成本|工料|cost|price[-_ ]?list|material/.test(value)) return 'cost_master_candidate';
  return 'quotation_candidate';
}

export function createQuotationEngine() {
  return Object.freeze({
    version: QUOTATION_ENGINE_VERSION,
    stage: QUOTATION_STAGE,
    schemas: Object.freeze({
      costMaster: 'draft-policy-ready',
      quotationProject: 'foundation',
      quoteItem: 'planned',
      costComponent: 'planned',
      workbookAction: 'planned'
    }),
    capabilities: Object.freeze({
      parseQuotation: false,
      matchCost: false,
      calculate: false,
      mutateWorkbook: false,
      exportWorkbook: false,
      draftEnvelope: true,
      inspectorSync: true
    }),
    createDraftEnvelope(fileMeta = {}, accessRole = 'member') {
      const kind = inferDocumentKind(fileMeta.name);
      const canPublishCostMaster = accessRole === 'admin' || accessRole === 'owner';
      return {
        id: `quote-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        status: 'draft',
        createdAt: new Date().toISOString(),
        file: { ...fileMeta },
        sourceImmutable: true,
        costMasterPolicy: {
          compareDraftOnly: kind === 'cost_master_candidate',
          canPublishCostMaster,
          publishCreatesNewVersion: true,
          overwritePreviousVersion: false
        },
        quotationPolicy: {
          workingCopyOnly: kind === 'quotation_candidate',
          exportCreatesNewFile: true,
          overwriteOriginalFile: false
        }
      };
    },
    health() {
      return { ok: true, version: QUOTATION_ENGINE_VERSION, stage: QUOTATION_STAGE };
    }
  });
}
