export const WORKBOOK_BRIDGE_VERSION = '0.2.0';
const ALLOWED_EXTENSIONS = new Set(['xlsx', 'xlsm', 'pdf']);

function getExtension(name = '') {
  const value = String(name || '');
  return value.includes('.') ? value.split('.').pop().toLowerCase() : '';
}

export function createWorkbookBridge() {
  return Object.freeze({
    version: WORKBOOK_BRIDGE_VERSION,
    stage: 'seamless-capability-foundation',
    allowedExtensions: [...ALLOWED_EXTENSIONS],
    inspectFile(file) {
      if (!file) return { ok: false, reason: 'NO_FILE' };
      const name = String(file.name || '');
      const extension = getExtension(name);
      return {
        ok: ALLOWED_EXTENSIONS.has(extension),
        name,
        extension,
        size: Number(file.size || 0),
        type: String(file.type || ''),
        lastModified: Number(file.lastModified || 0),
        reason: ALLOWED_EXTENSIONS.has(extension) ? '' : 'UNSUPPORTED_EXTENSION'
      };
    },
    createWorkingCopyDescriptor(fileMeta = {}) {
      const name = String(fileMeta.name || 'quotation.xlsx');
      const ext = getExtension(name) || 'xlsx';
      const stem = name.replace(/\.[^.]+$/, '') || 'quotation';
      return {
        sourceImmutable: true,
        sourceName: name,
        workingCopy: `${stem}-LEAVES-AI-DRAFT.${ext}`,
        futureOfficialExport: `${stem}-LEAVES-AI-REVISION.${ext}`,
        overwriteOriginalFile: false,
        mutationEnabled: false,
        exportEnabled: false
      };
    },
    health() {
      return { ok: true, version: WORKBOOK_BRIDGE_VERSION, stage: 'seamless-capability-foundation' };
    }
  });
}
