export const WORKBOOK_BRIDGE_VERSION = '0.1.0';
const ALLOWED_EXTENSIONS = new Set(['xlsx', 'xlsm', 'pdf']);

export function createWorkbookBridge() {
  return Object.freeze({
    version: WORKBOOK_BRIDGE_VERSION,
    stage: 'foundation',
    allowedExtensions: [...ALLOWED_EXTENSIONS],
    inspectFile(file) {
      if (!file) return { ok: false, reason: 'NO_FILE' };
      const name = String(file.name || '');
      const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
      return {
        ok: ALLOWED_EXTENSIONS.has(ext),
        name,
        extension: ext,
        size: Number(file.size || 0),
        type: String(file.type || ''),
        reason: ALLOWED_EXTENSIONS.has(ext) ? '' : 'UNSUPPORTED_EXTENSION'
      };
    },
    health() {
      return { ok: true, version: WORKBOOK_BRIDGE_VERSION, stage: 'foundation' };
    }
  });
}
