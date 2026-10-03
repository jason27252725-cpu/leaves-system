export const QUOTATION_ENGINE_VERSION = '0.4.0';
export const QUOTATION_STAGE = 'cost-master-revision-ui';

function inferDocumentKind(name = '') {
  const value = String(name || '').toLowerCase();
  if (/成本|工料|cost|price[-_ ]?list|material/.test(value)) return 'cost_master_candidate';
  return 'quotation_candidate';
}

function stableHash(input = '') {
  let hash = 2166136261;
  const text = String(input || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function createSourceFileId(fileMeta = {}) {
  const fingerprint = [
    String(fileMeta.name || ''),
    Number(fileMeta.size || 0),
    Number(fileMeta.lastModified || 0),
    String(fileMeta.type || ''),
    String(fileMeta.extension || '')
  ].join('|');
  return `quote-source-${stableHash(fingerprint)}`;
}

export function createQuotationEngine() {
  return Object.freeze({
    version: QUOTATION_ENGINE_VERSION,
    stage: QUOTATION_STAGE,
    schemas: Object.freeze({
      costMaster: 'draft-policy-ready',
      quotationProject: 'multi-draft-foundation',
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
      draftRegistry: true,
      draftReopen: true,
      inspectorSync: true,
      readCostMaster: true,
      costGatewayReadOnly: true
    }),
    createDraftEnvelope(fileMeta = {}, accessRole = 'member') {
      const kind = inferDocumentKind(fileMeta.name);
      const canPublishCostMaster = accessRole === 'admin' || accessRole === 'owner';
      const createdAt = new Date().toISOString();
      const sourceFileId = createSourceFileId(fileMeta);
      return {
        id: `quote-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        draftId: null,
        sourceFileId,
        quotationProjectId: null,
        kind,
        status: 'draft',
        pendingChangeCount: 0,
        createdAt,
        updatedAt: createdAt,
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
    normalizeDraftEnvelope(draft = {}) {
      if (!draft || typeof draft !== 'object') return null;
      if (!draft.draftId) draft.draftId = String(draft.id || '');
      if (!draft.id) draft.id = String(draft.draftId || '');
      return draft;
    },
    health() {
      return { ok: true, version: QUOTATION_ENGINE_VERSION, stage: QUOTATION_STAGE };
    }
  });
}
