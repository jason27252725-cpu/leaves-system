import {customerSheets} from './quotation.visibility.js';

// Visibility changes belong to the working draft, never the source buffer.
export function revealCustomerRows(model, accessRole) {
  if (!['owner', 'admin'].includes(accessRole)) return 0;
  model.visibilityJournal ||= new Map(); let count = 0;
  for (const sheet of customerSheets(model)) {
    const range = sheet.customerRange || sheet.range;
    for (const row of [...sheet.hiddenRows]) {
      if (row < range.s.r || row > range.e.r) continue;
      const meta = model.workbook.Sheets[sheet.name]['!rows'] ||= [];
      const before = {...(meta[row] || {hidden: true})};
      model.visibilityJournal.set(sheet.name + '!' + row, {sheet: sheet.name, row, before});
      meta[row] = {...before, hidden: false, hpt: before.hpt > 0 ? before.hpt : 18, hpx: before.hpx > 0 ? before.hpx : 24};
      sheet.hiddenRows.delete(row); (sheet.revealedRows ||= new Set()).add(row); count++;
    }
  }
  model.dirty = !!model.editJournal?.size || !!model.visibilityJournal.size || !!model.structuralChanges;
  return count;
}

export function restoreCustomerVisibility(model, accessRole) {
  if (!['owner', 'admin'].includes(accessRole)) return 0;
  let count = 0;
  for (const entry of model.visibilityJournal?.values() || []) {
    const sheet = model.sheets.find(s => s.name === entry.sheet); if (!sheet) continue;
    const meta = model.workbook.Sheets[sheet.name]['!rows'] ||= []; meta[entry.row] = {...entry.before};
    sheet.hiddenRows.add(entry.row); sheet.revealedRows?.delete(entry.row); count++;
  }
  model.visibilityJournal?.clear(); model.dirty = !!model.editJournal?.size || !!model.structuralChanges; return count;
}

export function patchRowVisibility(xml, entries) {
  for (const entry of entries) {
    const re = new RegExp('<row\\b([^>]*\\br="' + (entry.row + 1) + '"[^>]*)(/?>)');
    let found = false;
    xml = xml.replace(re, (_, attrs, end) => {
      found = true;
      const clean = attrs.replace(/\s+(?:hidden|ht|customHeight)="[^"]*"/g, '');
      const height = entry.before.hpt > 0 ? entry.before.hpt : entry.before.hpx > 0 ? entry.before.hpx * .75 : 18;
      return '<row' + clean + ' hidden="0" ht="' + height + '" customHeight="1"' + end;
    });
    if (!found) throw Error('EXPORT_VISIBILITY_ROW_MISSING:' + entry.sheet + ':' + (entry.row + 1));
  }
  return xml;
}
