'use strict';
/** 字段定义、清洗归一化与票面校验提示。 */

const MAIN_FIELDS = [
  'invoiceNumber', 'issueDate', 'buyerName', 'buyerTaxId', 'sellerName', 'sellerTaxId',
  'amountExclTax', 'totalTax', 'amountInclTax', 'remark'
];
const ITEM_FIELDS = ['name', 'spec', 'unit', 'quantity', 'unitPrice', 'amount', 'taxRate', 'taxAmount'];
const NUMERIC_MAIN = ['amountExclTax', 'totalTax', 'amountInclTax'];
const NUMERIC_ITEM = ['quantity', 'unitPrice', 'amount', 'taxAmount'];
const SOURCES = ['xml', 'pdf', 'qr', 'ocr', 'manual'];

// 统一社会信用代码 GB 32100 校验位
const CS = '0123456789ABCDEFGHJKLMNPQRTUWXY';
const WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

function checkTaxId(id) {
  const s = String(id || '').trim().toUpperCase();
  const formatOk = /^[0-9A-Z]{18}$/.test(s) && [...s].every((c) => CS.includes(c));
  let checksumOk = false;
  if (formatOk) {
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += CS.indexOf(s[i]) * WEIGHTS[i];
    checksumOk = CS[(31 - (sum % 31)) % 31] === s[17];
  }
  return { formatOk, checksumOk };
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const text = String(v).replace(/[¥￥,，\s%％]/g, '');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function toDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);               // 20260501
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s.slice(0, 20);                                   // 原样保留，不猜测
}

function cleanText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/** 把解析层 / 前端提交的数据清洗成统一结构（不改来源） */
function normalizeDraft(draft = {}) {
  const src = draft.invoice || {};
  const invoice = {};
  for (const f of MAIN_FIELDS) invoice[f] = null;
  for (const f of MAIN_FIELDS) {
    const raw = src[f];
    if (raw === undefined || raw === null || raw === '') continue;
    if (NUMERIC_MAIN.includes(f)) invoice[f] = toNumber(raw);
    else if (f === 'issueDate') invoice[f] = toDate(raw);
    else if (f === 'invoiceNumber') invoice[f] = cleanText(String(raw).replace(/\D/g, '')) || null;
    else invoice[f] = cleanText(raw);
  }
  const items = (Array.isArray(draft.items) ? draft.items : []).map((row = {}) => {
    const out = {};
    for (const f of ITEM_FIELDS) out[f] = null;
    for (const f of ITEM_FIELDS) {
      if (row[f] === undefined || row[f] === null || row[f] === '') continue;
      out[f] = NUMERIC_ITEM.includes(f) ? toNumber(row[f]) : cleanText(row[f]);
    }
    return out;
  }).filter((row) => ITEM_FIELDS.some((f) => row[f] !== null));

  // 来源标记：只保留合法枚举，缺失即视为 manual（用户手工填的）
  const rawSources = draft.sources || {};
  const invoiceSources = {};
  for (const f of MAIN_FIELDS) {
    invoiceSources[f] = SOURCES.includes(rawSources.invoice?.[f]) ? rawSources.invoice[f] : (invoice[f] !== null ? 'manual' : null);
  }
  const itemSources = items.map((_row, i) => {
    const one = {};
    const rs = Array.isArray(rawSources.items) ? (rawSources.items[i] || {}) : {};
    for (const f of ITEM_FIELDS) one[f] = SOURCES.includes(rs[f]) ? rs[f] : null;
    return one;
  });
  return { invoice, items, sources: { invoice: invoiceSources, items: itemSources } };
}

/** 校验：返回警告数组，不阻塞 */
function validateDraft(invoice, items) {
  const w = [];
  const push = (type, field, message, extra = {}) => w.push({ level: 'warn', type, field, message, ...extra });

  if (invoice.invoiceNumber && !/^\d{20}$/.test(invoice.invoiceNumber)) {
    push('format', 'invoiceNumber', '数电票发票号码应为 20 位数字，请核对');
  }
  for (const [field, label] of [['buyerTaxId', '购买方'], ['sellerTaxId', '销售方']]) {
    const v = invoice[field];
    if (!v) continue;
    const r = checkTaxId(v);
    if (!r.formatOk) push('taxid', field, `${label}统一社会信用代码不是 18 位有效字符`);
    else if (!r.checksumOk) push('taxid', field, `${label}统一社会信用代码校验位不通过（可能是手误）`);
  }

  const near = (a, b, tol = 0.05) => a !== null && b !== null && Math.abs(a - b) <= tol;
  const itemSum = items.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  if (items.length && invoice.amountExclTax != null && !near(itemSum, invoice.amountExclTax)) {
    push('sum', 'amountExclTax', `明细金额之和 ${itemSum.toFixed(2)} 与合计金额 ${Number(invoice.amountExclTax).toFixed(2)} 不一致`,
      { expected: invoice.amountExclTax, actual: Number(itemSum.toFixed(2)) });
  }
  if (invoice.amountExclTax != null && invoice.totalTax != null && invoice.amountInclTax != null) {
    const s = Number((invoice.amountExclTax + invoice.totalTax).toFixed(2));
    if (!near(s, invoice.amountInclTax)) {
      push('sum', 'amountInclTax', `金额 + 税额 = ${s.toFixed(2)}，与价税合计 ${Number(invoice.amountInclTax).toFixed(2)} 不一致`,
        { expected: invoice.amountInclTax, actual: s });
    }
  }
  if (invoice.issueDate && !/^\d{4}-\d{2}-\d{2}$/.test(invoice.issueDate)) {
    push('format', 'issueDate', '开票日期格式建议为 YYYY-MM-DD');
  }
  return w;
}

/** 轻量入参校验（分页/数字区间等） */
function intIn(v, def, min, max) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v, max = 200) {
  if (v === undefined || v === null) return null;
  return String(v).trim().slice(0, max) || null;
}

module.exports = {
  MAIN_FIELDS, ITEM_FIELDS, SOURCES, checkTaxId, toNumber, toDate,
  normalizeDraft, validateDraft, intIn, numOrNull, str
};
