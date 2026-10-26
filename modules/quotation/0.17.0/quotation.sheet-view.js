const esc = v => String(v ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const value = cell => String(cell?.display || (cell?.value ?? ''));
function pageObjects(items, text) {
  return items.map(i => `<img src="${esc(i.src)}" alt="${esc(i.label)}" style="width:${i.width}px;max-width:100%;height:${i.height}px;object-fit:contain;align-self:${i.align === 'left' ? 'flex-start' : i.align === 'right' ? 'flex-end' : 'center'}">`).join('') + (text ? '<p>' + esc(text) + '</p>' : '');
}
export function buildWorkbookGrid(state, workbook, {original = false, suggestionIndex = new Map()} = {}) {
  const sh = workbook.getSheet(state.model, state.presentationSheet || state.model.activeSheet); if (!sh) return '';
  const layout = state.model.presentation?.sheets?.[sh.name], allRows = workbook.getVisibleRows(state.model, sh.name, state.viewMode), cols = workbook.getVisibleCols(state.model, sh.name, state.viewMode).slice(0, 40);
  let filtered = allRows;
  if (state.compare && state.diffOnly) { const changed = new Set(workbook.getDiffs(state.model, {sheetName: sh.name, viewMode: state.viewMode}).map(x => x.row)); filtered = allRows.filter(r => changed.has(r)); }
  const start = state.originalPreview ? 0 : Math.min(Number(state.rowWindowIndex || 0), Math.max(0, filtered.length - 1)), rows = filtered.slice(start, start + (state.originalPreview ? 2000 : state.visibleRows || 140));
  if (!rows.length || !cols.length) return '<div class="quotation-workbook-empty">此視圖沒有儲存格。</div>';
  const rowSet = new Set(rows), colSet = new Set(cols), covered = new Set(), merges = new Map();
  for (const m of sh.merges || []) {
    const mr = rows.filter(r => r >= m.s.r && r <= m.e.r), mc = cols.filter(c => c >= m.s.c && c <= m.e.c); if (!mr.length || !mc.length) continue;
    const anchor = workbook.columnAddress(state.model, m.s.c, m.s.r); merges.set(mr[0] + ':' + mc[0], {rowspan: mr.length, colspan: mc.length, anchor, clipped: !rowSet.has(m.s.r) || !colSet.has(m.s.c)});
    for (const r of mr) for (const c of mc) if (r !== mr[0] || c !== mc[0]) covered.add(r + ':' + c);
  }
  const widths = cols.map(c => Math.max(45, layout?.cols[c]?.width || (c === 1 ? 380 : c === 6 ? 240 : 90))), tableWidth = widths.reduce((a,b) => a+b, 46);
  const columns = '<col style="width:46px">' + widths.map(w => `<col style="width:${w}px">`).join('');
  const head = '<th class="q-row-head"></th>' + cols.map(c => `<th data-col="${c}">${esc(state.model.XLSX.utils.encode_col(c))}</th>`).join('');
  const body = rows.map(r => {
    const revealed = sh.revealedRows?.has(r), height = Math.max(24, layout?.rows[r]?.height || 24);
    let cells = `<th class="q-row-head" title="${revealed ? '原先隱藏，已在工作草稿顯示' : ''}">${r+1}${revealed ? '<small class="q-revealed-dot">顯</small>' : ''}</th>`;
    for (const c of cols) {
      if (covered.has(r + ':' + c)) continue;
      const merge = merges.get(r + ':' + c), addr = merge?.anchor || workbook.columnAddress(state.model, c, r), current = workbook.getCell(state.model, sh.name, addr), origin = workbook.originalCell(state.model, sh.name, addr), shown = original ? origin : current, formula = String(shown?.formula || ''), suggestion = original ? null : suggestionIndex.get(sh.name + '!' + addr), isTarget = state.highlight?.sheet === sh.name && state.highlight?.address === addr;
      const style = layout?.cellStyles[addr] || {}, preview = state.originalPreview, editable = !original && !formula && !merge?.clipped && !preview;
      const css = [style.horizontal && ['left','center','right'].includes(style.horizontal) ? 'text-align:' + style.horizontal : '', preview && style.family ? 'font-family:' + style.family.replace(/[^\w\s\u4e00-\u9fff-]/g, '') : '', preview && style.size ? 'font-size:' + Math.max(10, Math.min(40, style.size * 4/3)) + 'px' : '', style.bold ? 'font-weight:600' : '', style.italic ? 'font-style:italic' : '', preview && style.color ? 'color:' + style.color : '', preview && style.background ? 'background:' + style.background : ''].filter(Boolean).join(';');
      const cls = [value(origin) !== value(current) && !original ? 'is-manual-changed' : '', formula ? 'is-formula' : '', suggestion ? 'has-suggestion' : '', isTarget ? 'is-review-target' : ''].filter(Boolean).join(' ');
      cells += `<td class="${cls}" data-sheet="${esc(sh.name)}" data-address="${addr}" ${merge ? `rowspan="${merge.rowspan}" colspan="${merge.colspan}"` : ''} style="${esc(css)}" ${formula ? `title="既有公式：=${esc(formula)}"` : ''}><span class="q-cell-value" ${editable ? `contenteditable="true" spellcheck="false" data-sheet="${esc(sh.name)}" data-address="${addr}"` : formula && !preview ? 'data-formula-locked="true"' : ''}>${esc(value(shown))}</span>${formula && !preview ? '<span class="q-formula-dot">ƒx</span>' : ''}${suggestion && !preview ? `<span class="q-cell-proposed">→ ${esc(suggestion.newValue ?? suggestion.formula ?? '')}</span><span class="q-cell-actions"><button data-action="accept-suggestion" data-suggestion-id="${esc(suggestion.id)}">✓</button><button data-action="reject-suggestion" data-suggestion-id="${esc(suggestion.id)}">×</button></span>` : ''}</td>`;
    }
    return `<tr data-row="${r}" class="${revealed ? 'q-revealed-row' : ''}" style="height:${height}px">${cells}</tr>`;
  }).join('');
  const page = state.originalPreview, showHeader = state.viewMode === 'customer' && (!start || page), showFooter = state.viewMode === 'customer' && start + rows.length >= filtered.length;
  return `<div class="quotation-sheet-grid ${page ? 'q-original-view' : ''}" data-grid-kind="${original ? 'original' : 'draft'}">${showHeader && layout ? `<div class="q-page-header" style="width:${tableWidth}px">${pageObjects(layout.header, layout.headerText)}</div>` : ''}<div class="q-sheet-surface" style="width:${tableWidth}px"><table style="width:${tableWidth}px"><colgroup>${columns}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><div class="q-object-layer" aria-label="報價原稿圖片與圖形"></div></div>${showFooter && layout ? `<div class="q-page-footer" style="width:${tableWidth}px">${pageObjects(layout.footer, layout.footerText)}</div>` : ''}</div><div class="quotation-grid-range"><span>${page ? '原稿版面預覽 · ' : ''}第 ${start+1}–${start+rows.length} / ${filtered.length} 列${page && filtered.length > 2000 ? ' · 預覽限前2000列' : ''}</span><div>${!page ? `<button data-action="page-up" ${start ? '' : 'disabled'}>上一段</button><button data-action="page-down" ${start+rows.length < filtered.length ? '' : 'disabled'}>下一段</button>` : ''}</div></div>`;
}
