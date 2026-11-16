'use strict';
/**
 * 第 3 优先级：二维码。PDF 渲染成图片 / 图片原件 → jsQR 识别 → 解析链接参数。
 * 用途：**校验** XML / PDF 已解析出的「发票号码、开票日期、金额」，不一致时返回 mismatch 供界面标红；
 * 仅当高优先级没有值时才用来补字段（绝不覆盖 xml/pdf）。
 */
const jsQR = require('jsqr');
const { shrinkForQr } = require('./raster');

const QR_KEYS = {
  invoiceNumber: ['fphm', 'invoicenumber', 'invoiceno', 'billno', 'fpdm', 'number', '发票号码'],
  issueDate: ['kprq', 'issuedate', 'invoicedate', 'date', '开票日期'],
  amount: ['je', 'jshj', 'amount', 'total', 'totalamount', 'sum', 'money', '金额', '价税合计']
};

function normDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}
function normAmount(s) {
  if (s === null || s === undefined || s === '') return null;
  const n = Number(String(s).replace(/[¥￥,，\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 解析二维码字符串（URL 参数 / JSON / 逗号分隔串 / 正则兜底） */
function parseQrPayload(raw) {
  const text = String(raw || '').trim();
  const out = { invoiceNumber: null, issueDate: null, amount: null, raw: text };
  if (!text) return out;

  // 1) JSON
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text);
      for (const [k, v] of Object.entries(j)) {
        const key = k.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
        if (QR_KEYS.invoiceNumber.includes(key)) out.invoiceNumber = String(v);
        if (QR_KEYS.issueDate.includes(key)) out.issueDate = normDate(v);
        if (QR_KEYS.amount.includes(key)) out.amount = normAmount(v);
      }
    } catch (_e) { /* 非 JSON，继续 */ }
  }

  // 2) URL query（也兼容 & 连接的裸串）
  const qi = text.indexOf('?');
  const query = qi >= 0 ? text.slice(qi + 1) : (/[=&]/.test(text) && !text.startsWith('01,') ? text : '');
  if (query) {
    try {
      const p = new URLSearchParams(query.replace(/^\?/, ''));
      for (const [k, v] of p.entries()) {
        const key = k.toLowerCase();
        if (QR_KEYS.invoiceNumber.includes(key)) out.invoiceNumber = String(v).trim();
        if (QR_KEYS.issueDate.includes(key)) out.issueDate = normDate(v);
        if (QR_KEYS.amount.includes(key)) out.amount = normAmount(v);
      }
    } catch (_e) { /* ignore */ }
  }

  // 3) 逗号分隔（增值税/数电票二维码经典格式：01,票种,代码,号码,金额,日期,...）
  if (text.includes(',')) {
    const parts = text.split(/[,，]/).map((s) => s.trim());
    for (const part of parts) {
      if (/^\d{20}$/.test(part)) out.invoiceNumber = out.invoiceNumber || part;
      if (/^\d{8}$/.test(part)) out.issueDate = out.issueDate || normDate(part);
      if (/^\d+\.\d{1,2}$/.test(part) && out.amount === null) out.amount = normAmount(part);
    }
  }

  // 4) 正则兜底（只取明确特征，不做推断）
  if (!out.invoiceNumber) {
    const m = text.match(/(?<!\d)(\d{20})(?!\d)/);
    if (m) out.invoiceNumber = m[1];
  }
  if (!out.issueDate) out.issueDate = normDate(text) || (() => { const m = text.match(/(?<!\d)(\d{8})(?!\d)/); return m ? normDate(m[1]) : null; })();
  if (out.amount === null) {
    const m = text.match(/(?:金额|小写|价税合计|je|amount)\s*[:=]?\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/i);
    if (m) out.amount = normAmount(m[1]);
  }

  out.invoiceNumber = out.invoiceNumber ? String(out.invoiceNumber).replace(/\D/g, '') || null : null;
  return out;
}

/** RGBA → 二维码 → payload */
async function decodeQrFromRgba(rgba, width, height) {
  if (!rgba || !width || !height) return null;
  try {
    const small = await shrinkForQr(rgba, width, height);
    const res = jsQR(new Uint8ClampedArray(small.data), small.width, small.height, { inversionAttempts: 'attemptBoth' });
    return res ? { text: res.data, payload: parseQrPayload(res.data) } : null;
  } catch (e) {
    console.warn('[qr] 识别失败:', e.message);
    return null;
  }
}

/** 与已解析结果比对。qr 有值但解析为空 → 可补齐，不算冲突 */
function compareQr(qr, invoice) {
  const mismatches = [];
  if (!qr) return mismatches;
  const pairs = [
    ['invoiceNumber', '发票号码', (v) => String(v || '').replace(/\D/g, ''), (a, b) => a === b],
    ['issueDate', '开票日期', (v) => normalizeDateLoose(v), (a, b) => a === b],
    ['amount', '价税合计', (v) => (v === null || v === undefined ? null : Number(v)), (a, b) => Math.abs(a - b) <= 0.01]
  ];
  for (const [key, label, conv, eq] of pairs) {
    let parsedValue = key === 'amount' ? invoice.amountInclTax : invoice[key];
    const q = conv(qr[key]);
    const p = parsedValue === null || parsedValue === undefined || parsedValue === '' ? null : conv(parsedValue);
    if (q === null || p === null) continue;
    if (!eq(p, q)) mismatches.push({ field: key === 'amount' ? 'amountInclTax' : key, label, parsed: parsedValue, qr: q, message: `${label}的校验值 ${q} 与识别结果 ${parsedValue} 不一致` });
  }
  return mismatches;
}

function normalizeDateLoose(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const m = s.match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : s;
}

module.exports = { parseQrPayload, decodeQrFromRgba, compareQr, normDate };
