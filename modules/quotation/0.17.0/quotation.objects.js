// Local OOXML presentation only. No workbook/media data is uploaded.
const local = (node, name) => {
  if (!node) return [];
  // Static query results avoid repeatedly materializing live XML collections on
  // large workbooks (notably under DOM implementations used for import tests).
  const all = node.getElementsByTagNameNS('*', name), out = [], length = all.length;
  for (let i = 0; i < length; i++) out.push(all.item(i));
  return out;
};
const first = (node, name) => local(node, name)[0];
const val = (node, name, fallback = 0) => Number(first(node, name)?.textContent ?? fallback);
const attr = (node, name, fallback = '') => node?.getAttribute(name) ?? fallback;
const px = n => Number(n || 0) / 9525;
const text = node => node?.textContent || '';
function xml(source) {
  const Parser = globalThis.DOMParser || globalThis.document?.defaultView?.DOMParser;
  if (!Parser) throw Error('XML parser unavailable');
  const doc = new Parser().parseFromString(source, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw Error('Invalid OOXML part');
  return doc;
}
function resolve(base, target) {
  const parts = (target.startsWith('/') ? target.slice(1) : base.slice(0, base.lastIndexOf('/') + 1) + target).split('/'), out = [];
  for (const part of parts) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); }
  return out.join('/');
}
const relPath = path => path.slice(0, path.lastIndexOf('/') + 1) + '_rels/' + path.slice(path.lastIndexOf('/') + 1) + '.rels';
async function relations(zip, path) {
  const part = zip.file(relPath(path));
  if (!part) return new Map();
  return new Map(local(xml(await part.async('string')), 'Relationship').filter(n => attr(n, 'TargetMode') !== 'External').map(n => [attr(n, 'Id'), { path: resolve(path, attr(n, 'Target')), type: attr(n, 'Type') }]));
}
const relationId = node => node?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || attr(node, 'r:id');
const color = node => { const s = attr(node, 'rgb'); return /^[a-f\d]{6,8}$/i.test(s) ? '#' + s.slice(-6) : ''; };
function readStyles(doc) {
  const fonts = [...(first(doc, 'fonts')?.children || [])].map(n => ({ family: attr(first(n, 'name'), 'val'), size: Number(attr(first(n, 'sz'), 'val')) || 11, bold: !!first(n, 'b'), italic: !!first(n, 'i'), color: color(first(n, 'color')) }));
  const fills = [...(first(doc, 'fills')?.children || [])].map(n => color(first(n, 'fgColor')));
  return [...(first(doc, 'cellXfs')?.children || [])].map(n => ({ ...fonts[Number(attr(n, 'fontId'))], background: fills[Number(attr(n, 'fillId'))], horizontal: attr(first(n, 'alignment'), 'horizontal'), vertical: attr(first(n, 'alignment'), 'vertical'), wrap: attr(first(n, 'alignment'), 'wrapText') === '1' }));
}
const units = raw => { const n = parseFloat(raw) || 0; return /pt$/.test(raw) ? n * 4 / 3 : /in$/.test(raw) ? n * 96 : n; };
export async function readWorkbookPresentation(buffer, JSZip, sheets) {
  const zip = await JSZip.loadAsync(buffer), wb = xml(await zip.file('xl/workbook.xml').async('string')), rels = await relations(zip, 'xl/workbook.xml');
  const result = { sheets: {}, warnings: [], mediaCount: 0, pictureCount: 0 }, assets = new Map();
  const styles = zip.file('xl/styles.xml') ? readStyles(xml(await zip.file('xl/styles.xml').async('string'))) : [];
  async function asset(path) {
    if (assets.has(path)) return assets.get(path);
    const mime = /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.gif$/i.test(path) ? 'image/gif' : /\.webp$/i.test(path) ? 'image/webp' : '';
    const part = zip.file(path);
    if (!part || !mime) { result.warnings.push('圖片格式尚未支援：' + path.split('/').at(-1)); return ''; }
    const encoded = await part.async('base64');
    if (encoded.length > 24000000) { result.warnings.push('單張圖片過大，請使用原始 Excel 核對'); return ''; }
    const data = 'data:' + mime + ';base64,' + encoded; assets.set(path, data); return data;
  }
  for (const sheetNode of local(wb, 'sheet')) {
    const name = attr(sheetNode, 'name'), sh = sheets.find(s => s.name === name), path = rels.get(relationId(sheetNode))?.path;
    if (!sh || !path || !zip.file(path)) continue;
    const doc = xml(await zip.file(path).async('string')), sr = await relations(zip, path), rows = {}, cols = {}, cellStyles = {}, pictures = [], shapes = [], header = [], footer = [];
    for (const row of local(doc, 'row')) rows[Number(attr(row, 'r')) - 1] = { height: Number(attr(row, 'ht')) * 4 / 3 || 24, hidden: attr(row, 'hidden') === '1' };
    for (const col of local(doc, 'col')) for (let c = Number(attr(col, 'min')) - 1; c < Math.min(120, Number(attr(col, 'max'))); c++) cols[c] = { width: Math.max(24, Math.round((Number(attr(col, 'width')) || 9) * 7 + 5)), hidden: attr(col, 'hidden') === '1' };
    for (const cell of local(doc, 'c')) cellStyles[attr(cell, 'r')] = styles[Number(attr(cell, 's'))] || {};
    for (const drawing of local(doc, 'drawing')) {
      const dp = sr.get(relationId(drawing))?.path; if (!dp || !zip.file(dp)) continue;
      const dd = xml(await zip.file(dp).async('string')), dr = await relations(zip, dp);
      if(local(dd,'graphicFrame').length)result.warnings.push(sh.displayName+' 有圖表或圖形框架尚未完整呈現，請以原始Excel核對');
      if(local(dd,'grpSp').length)result.warnings.push(sh.displayName+' 有群組物件，群組變形需以原始Excel核對');
      for (const anchor of [...dd.documentElement.children]) {
        const from = first(anchor, 'from'), to = first(anchor, 'to'), ext = first(anchor, 'ext'), pos = first(anchor, 'pos');
        const geometry = { kind: anchor.localName, from: { row: val(from, 'row'), col: val(from, 'col'), x: px(val(from, 'colOff')), y: px(val(from, 'rowOff')) }, to: to ? { row: val(to, 'row'), col: val(to, 'col'), x: px(val(to, 'colOff')), y: px(val(to, 'rowOff')) } : null, width: px(attr(ext, 'cx')), height: px(attr(ext, 'cy')), x: px(attr(pos, 'x')), y: px(attr(pos, 'y')) };
        for (const pic of local(anchor, 'pic')) {
          const blip = first(pic, 'blip'), embed = blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || attr(blip, 'r:embed'), mp = dr.get(embed)?.path, src = mp ? await asset(mp) : '';
          const props = first(pic, 'cNvPr'), crop = first(pic, 'srcRect'), transform = first(pic, 'xfrm');
          if (!src) { result.warnings.push('無法顯示一個圖片物件：' + (attr(props, 'name') || '未命名')); continue; }
          pictures.push({ ...geometry, src, label: attr(props, 'descr') || attr(props, 'name') || '報價圖片', crop: Object.fromEntries(['l', 't', 'r', 'b'].map(k => [k, Number(attr(crop, k)) / 100000])), rotation: Number(attr(transform, 'rot')) / 60000, flipH: attr(transform, 'flipH') === '1', flipV: attr(transform, 'flipV') === '1' });
          result.pictureCount++;
        }
        for (const shape of local(anchor, 'sp')) {
          const words = local(shape, 't').map(text).join('\n'), preset = attr(first(shape, 'prstGeom'), 'prst'), fill = attr(first(first(shape, 'solidFill'), 'srgbClr'), 'val'), line = attr(first(first(shape, 'ln'), 'srgbClr'), 'val');
          if (words || ['rect', 'roundRect', 'ellipse', 'line'].includes(preset)) shapes.push({ ...geometry, text: words, preset, fill: /^[a-f\d]{6}$/i.test(fill) ? '#' + fill : '', line: /^[a-f\d]{6}$/i.test(line) ? '#' + line : '' });
          else result.warnings.push('一個特殊圖形尚未完整呈現，請核對原稿');
        }
      }
    }
    for (const rel of sr.values()) if (/vmlDrawing$/.test(rel.type) && zip.file(rel.path)) {
      const vd = xml(await zip.file(rel.path).async('string')), vr = await relations(zip, rel.path);
      for (const shape of local(vd, 'shape')) {
        const im = first(shape, 'imagedata'), id = attr(im, 'o:relid') || relationId(im), mp = vr.get(id)?.path;
        if (!mp) continue;
        const src = await asset(mp); if (!src) continue;
        const style = Object.fromEntries(attr(shape, 'style').split(';').map(s => s.split(':').map(x => x.trim()))), key = attr(shape, 'id');
        const image = { src, label: attr(im, 'o:title') || key || '頁首頁尾圖片', width: units(style.width) || 180, height: units(style.height) || 60, align: /^L/.test(key) ? 'left' : /^R/.test(key) ? 'right' : 'center' };
        (/F$/.test(key) ? footer : header).push(image);
      }
    }
    const pageText = n => local(first(doc, 'headerFooter'), n).map(text).filter(Boolean).join('\n').replace(/&G/g, '').replace(/&P/g, '〔頁碼〕').replace(/&N/g, '〔總頁數〕').replace(/&[LCR]/g, '').replace(/&"[^"]*"/g, '').replace(/&\d+/g, '').replace(/&[BUIS]/g, '').trim();
    result.sheets[name] = { rows, cols, cellStyles, pictures, shapes, header, footer, headerText: pageText('oddHeader'), footerText: pageText('oddFooter'), unsupported: local(doc, 'oleObject').length + local(doc, 'chart').length };
    if (result.sheets[name].unsupported) result.warnings.push(sh.displayName + ' 有嵌入物件，請以原始 Excel 核對');
  }
  result.mediaCount = assets.size; result.warnings = [...new Set(result.warnings)]; return result;
}

export function positionWorkbookObjects(root, state, workbook) {
  for (const grid of root.querySelectorAll('.quotation-sheet-grid')) {
    const name = state.presentationSheet || state.model.activeSheet, layout = state.model.presentation?.sheets?.[name], sh = workbook.getSheet(state.model, name), layer = grid.querySelector('.q-object-layer');
    if (!layout || !layer || !sh) continue;
    const table = grid.querySelector('table'), origin = table.getBoundingClientRect(), cols = new Map([...grid.querySelectorAll('thead th[data-col]')].map(n => [Number(n.dataset.col), n.getBoundingClientRect()])), rows = new Map([...grid.querySelectorAll('tbody tr[data-row]')].map(n => [Number(n.dataset.row), n.getBoundingClientRect()]));
    const range = workbook.getViewRange(state.model, name, state.viewMode), visible = [...rows.keys()]; if (!visible.length) continue;
    function point(row, col, x = 0, y = 0) {
      let left = cols.get(col)?.left, top = rows.get(row)?.top;
      if (left == null) { left = origin.left + 46; for (let c = range.s.c; c < col; c++) if (!sh.hiddenCols.has(c)) left += layout.cols[c]?.width || 90; }
      if (top == null) { const firstRow = visible[0]; top = rows.get(firstRow).top; for (let r = Math.min(row, firstRow); r < Math.max(row, firstRow); r++) if (!sh.hiddenRows.has(r)) top += (row < firstRow ? -1 : 1) * (layout.rows[r]?.height || 24); }
      return { x: left - origin.left + x, y: top - origin.top + y };
    }
    layer.replaceChildren();
    for (const object of [...layout.pictures, ...layout.shapes]) {
      const endRow = object.to?.row ?? object.from.row + Math.ceil(object.height / 24), endCol = object.to?.col ?? object.from.col;
      // Never display hidden or internal-column anchors in a customer view.
      if (object.from.col < range.s.c || object.from.col > range.e.c || endCol > range.e.c + 1 || sh.hiddenCols.has(object.from.col) || sh.hiddenRows.has(object.from.row) || endRow < visible[0] || object.from.row > visible.at(-1)) continue;
      const a = object.kind === 'absoluteAnchor' ? { x: object.x, y: object.y } : point(object.from.row, object.from.col, object.from.x, object.from.y), b = object.to ? point(object.to.row, object.to.col, object.to.x, object.to.y) : { x: a.x + object.width, y: a.y + object.height };
      const el = document.createElement(object.src ? 'figure' : 'div'); el.className = 'q-workbook-object'; el.style.cssText = `left:${a.x}px;top:${a.y}px;width:${Math.max(1, b.x - a.x)}px;height:${Math.max(1, b.y - a.y)}px;`;
      if (object.src) { const im = document.createElement('img'); im.src = object.src; im.alt = object.label; im.draggable = false; const c = object.crop, w = Math.max(.01, 1 - c.l - c.r), h = Math.max(.01, 1 - c.t - c.b); im.style.cssText = `width:${100 / w}%;height:${100 / h}%;left:${-100 * c.l / w}%;top:${-100 * c.t / h}%;transform:rotate(${object.rotation || 0}deg) scale(${object.flipH ? -1 : 1},${object.flipV ? -1 : 1});`; el.append(im); }
      else { el.textContent = object.text; el.style.background = object.fill || 'transparent'; el.style.border = object.line ? '1px solid ' + object.line : 'none'; if (object.preset === 'ellipse') el.style.borderRadius = '50%'; }
      layer.append(el);
    }
    layer.style.width = table.offsetWidth + 'px'; layer.style.height = table.offsetHeight + 'px';
  }
}
