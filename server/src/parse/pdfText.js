'use strict';
/**
 * 第 2 优先级：PDF 文本层解析（pdf.js）。
 * 思路：TextContent.items 自带 transform[4]=x / transform[5]=y，
 *   1) 按 y 聚类还原「行」，行内按 x 排序；
 *   2) 关键词 + 左右分栏规则抽主表字段；
 *   3) 用明细表头各列文字的 x 锚点切出列区间，把后续每行按 x 归列 → 明细表格。
 * 全部为纯函数，便于单元测试（fixture 直接给 items，不需要真实 PDF）。
 */
require('./env');   // 必须在 pdfjs 之前注入 Web API polyfill
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const TABLE_HEADERS = [
  ['name', '项目名称'], ['name', '货物或应税劳务'], ['name', '货物名称'],
  ['spec', '规格型号'], ['unit', '单位'], ['quantity', '数量'],
  ['unitPrice', '单价'], ['amount', '金额'], ['taxRate', '税率'], ['taxAmount', '税额']
];

// 捕获「完整数字（含小数）」：早期版本把 \.\d{2} 放在捕获组外，导致 217.78 被截成 217。
// 同时兼容千分位 1,234.56 与 pdf.js 偶尔拆出的 "217. 78"（小数点两侧空白）。
const MONEY_RE = /[¥￥]?\s*(-?\s*(?:\d{1,3}(?:,\d{3})+|\d+)\s*\.\s*\d{2})/g;
const TAXID_RE = /(?:^|[^0-9A-Z])([0-9A-Z]{18})(?![0-9A-Z])/;
const SIMPLE_NUMBER = /^-?\d+(?:\.\d{1,2})?$/;
const NUMERIC_COLUMNS = ['quantity', 'unitPrice', 'amount', 'taxAmount'];

// ---------- 1. 行还原 ----------
function buildLines(items, yTolerance = 3) {
  const segs = [];
  for (const it of items || []) {
    const text = String(it.str ?? '');
    if (!text.trim()) continue;
    const x = Number(it.transform?.[4] ?? it.x ?? 0);
    const y = Number(it.transform?.[5] ?? it.y ?? 0);
    const w = Number(it.width ?? text.length * 6);
    segs.push({ x, y, endX: x + w, text });
  }
  // PDF 坐标 y 自下而上，页面顶部 y 更大 → 降序即阅读顺序
  segs.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  for (const s of segs) {
    let line = lines.find((l) => Math.abs(l.y - s.y) <= yTolerance);
    if (!line) { line = { y: s.y, segments: [] }; lines.push(line); }
    line.segments.push(s);
  }
  for (const l of lines) {
    l.segments.sort((a, b) => a.x - b.x);
    l.text = l.segments.map((s) => s.text).join('');
    l.maxX = Math.max(...l.segments.map((s) => s.endX), 0);
  }
  return lines;
}

/** 一行按 x 拆成左右两栏（数电票版式：左购买方 / 右销售方） */
function splitColumns(line, splitX) {
  const left = [], right = [];
  for (const s of line.segments) (s.x < splitX ? left : right).push(s.text);
  return { left: left.join(''), right: right.join('') };
}

function allMoney(text) {
  const out = [];
  for (const m of String(text).matchAll(MONEY_RE)) {
    const n = Number(m[1].replace(/[,\s]/g, ''));   // m[1] 已包含小数部分
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function findDate(text) {
  const m = String(text).match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

function cleanName(s) {
  return String(s || '')
    .replace(/^.*?名\s*称[:：]?/, '')
    .replace(/(统一社会信用代码|纳税人识别号|统一社会信用|地址|电话|开户行|账号).*$/, '')
    .replace(/[:：\s]/g, '')
    .trim() || null;
}

// ---------- 2. 明细表列锚点 ----------
/** 把行的 segments 摊成「每个字符对应的 x」，从而在合并文本里定位关键词的列起点 */
function charXs(line) {
  const arr = [];
  for (const s of line.segments) {
    const len = s.text.length || 1;
    for (let i = 0; i < s.text.length; i++) arr.push(s.x + ((s.endX - s.x) * i) / len);
  }
  return arr;
}

function isHeaderLine(line) {
  const text = line.text.replace(/\s/g, '');
  const fields = new Set(TABLE_HEADERS.filter(([, kw]) => text.includes(kw)).map(([f]) => f));
  return fields.size >= 3;
}

function columnAnchors(line) {
  const text = line.text.replace(/\s/g, '');
  const xs = charXs(line).filter((_, i) => !/\s/.test(line.text[i]));
  const found = new Map();
  for (const [field, kw] of TABLE_HEADERS) {
    if (found.has(field)) continue;
    const idx = text.indexOf(kw);
    if (idx >= 0) found.set(field, xs[Math.min(idx, xs.length - 1)] ?? 0);
  }
  const anchors = [...found.entries()].map(([field, x]) => ({ field, x })).sort((a, b) => a.x - b.x);
  // 去重：同一 x 附近只保留一个，避免 "金额/税额" 被误判成同一列
  const uniq = [];
  for (const a of anchors) if (!uniq.length || a.x - uniq[uniq.length - 1].x > 2) uniq.push(a);
  return uniq;
}

/** 边界数组：相邻列锚点的中点 */
function boundsOf(anchors) {
  const bounds = [];
  for (let i = 0; i < anchors.length - 1; i++) bounds.push((anchors[i].x + anchors[i + 1].x) / 2);
  return bounds;
}
function colAt(x, bounds) {
  let col = 0;
  while (col < bounds.length && x >= bounds[col]) col++;
  return col;
}

/**
 * 按列锚点把一行切成 cells。
 * 真实数电票里 pdf.js 常把「数量/单价/金额」连成一整段 item（如 "1215.623762376238215.62"），
 * 此时按字符的 x 位置线性分配到各列，而不是把整段塞进第一列。
 */
function splitRowByAnchors(line, anchors) {
  const cells = anchors.map(() => '');
  if (!anchors.length) return cells;
  const bounds = boundsOf(anchors);
  for (const s of line.segments) {
    const text = s.text;
    if (!text) continue;
    const startCol = colAt(s.x, bounds);
    const endCol = colAt(s.endX, bounds);
    // 只有「纯数字串」且明显横跨多列时才按字符 x 分列；
    // 中文名称/规格的宽度估算偏大是常态，不能拿去逐字符切碎。
    const numericRun = /^[\d.,¥￥\s%+\-]+$/.test(text);
    if (startCol === endCol || !numericRun || endCol - startCol < 2) {
      cells[startCol] += text;
      continue;
    }
    const len = text.length || 1;
    for (let i = 0; i < text.length; i++) {
      const cx = s.x + ((s.endX - s.x) * i) / len;
      cells[colAt(cx, bounds)] += text[i];
    }
  }
  return cells.map((c) => c.trim());
}

/**
 * 明细数字列清洗：串列产生的超长/畸形数字（如 1215.623762376238）不可信，
 * 按「不猜测、不编造」原则直接留空交给人工补填，而不是填一个看似合理的错值。
 */
function sanitizeItemRow(row) {
  for (const f of NUMERIC_COLUMNS) {
    if (row[f] === undefined || row[f] === null || row[f] === '') continue;
    const s = String(row[f]).replace(/[¥￥,\s]/g, '');
    if (!SIMPLE_NUMBER.test(s)) delete row[f];
    else row[f] = s;
  }
  return row;
}

function parseItemTable(lines, headerIndex) {
  const anchors = columnAnchors(lines[headerIndex]);
  const fields = anchors.map((a) => a.field);
  const rows = [];
  let leadingText = {};
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const t = lines[i].text;
    if (/^\s*(?:价税合计|合\s*计|备\s*注|开票人|收款人|复核人)/.test(t)) break;
    // OCR 有时只识别出合计标签中的「计」，此时紧接的货币符号仍能标识合计行。
    if (/^\s*计\s*[¥￥]/.test(t)) break;
    if (!t.trim()) continue;
    const cells = splitRowByAnchors(lines[i], anchors);
    const row = {};
    fields.forEach((f, idx) => { if (cells[idx]) row[f] = cells[idx]; });
    sanitizeItemRow(row);
    if (row.taxRate && !/^(?:\d+(?:\.\d+)?\s*[%％]|免税|不征税|零税率|\*{2,3})$/.test(row.taxRate)) delete row.taxRate;

    // 金额或税额所在行才是明细行；紧接的名称、规格续行不单独计数。
    if (row.amount === undefined && row.taxAmount === undefined) {
      const startsItem = /^\*[^*]+\*/.test(row.name || '');
      const previous = rows.at(-1);
      const target = previous && !startsItem && !leadingText.name ? previous.row : leadingText;
      for (const field of ['name', 'spec']) {
        if (!row[field]) continue;
        target[field] = (target[field] || '') + row[field];
        if (target === previous?.row) previous.sources[field] = 'pdf';
      }
      continue;
    }

    for (const field of ['name', 'spec']) {
      if (leadingText[field]) row[field] = leadingText[field] + (row[field] || '');
    }
    leadingText = {};

    const sources = {};
    for (const f of Object.keys(row)) sources[f] = 'pdf';
    rows.push({ row, sources });
  }
  return rows;
}

// ---------- 3. 主表字段 ----------
function parseMain(lines) {
  const invoice = {}, sources = {};
  const set = (f, v) => { if (v !== null && v !== undefined && v !== '' && !invoice[f]) { invoice[f] = v; sources[f] = 'pdf'; } };
  const pageWidth = Math.max(...lines.map((l) => l.maxX), 600);
  // 购买方 / 销售方表头所在行的 x 中点作为左右分栏边界
  const partyLine = lines.find((l) => /购买方|购\s*买\s*方/.test(l.text) && /销售方|销\s*售\s*方/.test(l.text));
  let splitX = pageWidth / 2;
  if (partyLine) {
    const buyerSeg = partyLine.segments.find((s) => /购买方|购\s*买\s*方/.test(s.text));
    const sellerSeg = partyLine.segments.find((s) => /销售方|销\s*售\s*方/.test(s.text));
    if (buyerSeg && sellerSeg && buyerSeg !== sellerSeg) splitX = (buyerSeg.x + sellerSeg.x) / 2;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const near = [line.text, lines[i + 1]?.text || '', lines[i + 2]?.text || ''].join(' ');

    if (/发票号码|发票号/.test(line.text)) {
      const m = near.match(/(?<!\d)(\d{20})(?!\d)/);
      if (m) set('invoiceNumber', m[1]);
    }
    if (/开票日期/.test(line.text)) {
      const d = findDate(near);
      if (d) set('issueDate', d);
    }
    if (/价税合计/.test(line.text)) {
      const nums = allMoney(line.text).length ? allMoney(line.text) : allMoney(near);
      if (nums.length) set('amountInclTax', nums[nums.length - 1]);
    }
    if (/合\s*计/.test(line.text) && !/价税合计/.test(line.text)) {
      const nums = allMoney(line.text);
      if (nums.length >= 2) { set('amountExclTax', nums[0]); set('totalTax', nums[1]); }
    }
    if (/备\s*注/.test(line.text)) {
      const v = line.text.replace(/^.*?备\s*注[:：]?/, '').trim();
      if (v) set('remark', v);
    }

    // 左右栏：名称 + 18 位统一社会信用代码（跳过明细表头，避免 "项目名称" 被当成购买方名称）
    const cols = splitColumns(line, splitX);
    if (!isHeaderLine(line)) {
      if (/名\s*称/.test(cols.left)) set('buyerName', cleanName(cols.left));
      if (/名\s*称/.test(cols.right)) set('sellerName', cleanName(cols.right));
    }
    const tl = cols.left.match(TAXID_RE), tr = cols.right.match(TAXID_RE);
    if (/统一社会信用代码|纳税人识别号|税号|名称/.test(cols.left) && tl) set('buyerTaxId', tl[1]);
    if (/统一社会信用代码|纳税人识别号|税号|名称/.test(cols.right) && tr) set('sellerTaxId', tr[1]);
  }

  // 兜底：全文唯一 20 位数字必是数电票号码；唯一 18 位 alphanumeric 交给人工确认（不自动归属）
  if (!invoice.invoiceNumber) {
    const m = lines.map((l) => l.text).join(' ').match(/(?<!\d)(\d{20})(?!\d)/);
    if (m) set('invoiceNumber', m[1]);
  }
  return { invoice, sources };
}

// ---------- 4. 对外主函数 ----------
/** 纯函数：输入 pdf.js TextContent.items，输出一层解析结果 */
function parsePdfTextItems(items, { layer = 'pdf', yTolerance = 3 } = {}) {
  const lines = buildLines(items, yTolerance);
  if (!lines.length) return { layer, ok: false, invoice: {}, items: [], sources: { invoice: {}, items: [] }, meta: { lines: [] }, error: '无可提取文本' };

  const main = parseMain(lines);
  const headerIndex = lines.findIndex(isHeaderLine);
  const table = headerIndex >= 0 ? parseItemTable(lines, headerIndex) : [];

  return {
    layer, ok: true,
    invoice: main.invoice,
    items: table.map((t) => t.row),
    sources: {
      invoice: Object.fromEntries(Object.keys(main.sources).map((field) => [field, layer])),
      items: table.map((t) => Object.fromEntries(Object.keys(t.sources).map((field) => [field, layer])))
    },
    meta: { lineCount: lines.length, lines: lines.map((l) => l.text), headerIndex, columnCount: headerIndex >= 0 ? columnAnchors(lines[headerIndex]).length : 0 }
  };
}

/** 从 PDF Buffer 提取文本层（不渲染、不需要 canvas） */
async function extractTextItems(buffer, maxPages = 2) {
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0
  }).promise;
  try {
    const out = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      out.push(...tc.items);
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

async function parsePdfBuffer(buffer) {
  try {
    const items = await extractTextItems(buffer);
    return parsePdfTextItems(items);
  } catch (e) {
    return { layer: 'pdf', ok: false, invoice: {}, items: [], sources: { invoice: {}, items: [] }, meta: { lines: [] }, error: `PDF 文本层解析失败: ${e.message}` };
  }
}

module.exports = {
  buildLines, parsePdfTextItems, extractTextItems, parsePdfBuffer,
  columnAnchors, isHeaderLine, allMoney, splitRowByAnchors, sanitizeItemRow
};

