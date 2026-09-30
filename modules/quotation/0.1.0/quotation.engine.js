export const QUOTATION_ENGINE_VERSION = '0.1.0';
export const QUOTATION_STAGE = 'foundation';

export function createQuotationEngine() {
  return Object.freeze({
    version: QUOTATION_ENGINE_VERSION,
    stage: QUOTATION_STAGE,
    schemas: Object.freeze({
      costMaster: 'planned',
      quotationProject: 'planned',
      quoteItem: 'planned',
      costComponent: 'planned',
      workbookAction: 'planned'
    }),
    capabilities: Object.freeze({
      parseQuotation: false,
      matchCost: false,
      calculate: false,
      mutateWorkbook: false,
      exportWorkbook: false
    }),
    health() {
      return { ok: true, version: QUOTATION_ENGINE_VERSION, stage: QUOTATION_STAGE };
    }
  });
}
