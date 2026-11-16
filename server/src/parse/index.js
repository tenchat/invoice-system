'use strict';
/**
 * 解析编排器（核心）
 * ─────────────────────────────────────────────────────────────
 * 优先级：xml(4) > pdf(3) > qr(2) > ocr(1) > manual(5，用户编辑)
 * 合并策略：按优先级「从低到高」逐层写入，高优先级覆盖低优先级的同名字段；空值不覆盖。
 *   · 主表：严格字段级合并，每个字段单独记录来源。
 *   · 明细：按「层」整体取最高优先级的非空行集合（跨层按行合并会错行，属于编造，禁止）。
 *   · 二维码：不覆盖已有值，只用于校验，不一致产出 qrMismatch 供界面标红。
 *   · 任何识别失败都降级为空表单手动录入，绝不阻塞流程。
 */
const config = require('../../config');
const { parseXml } = require('./xml');
const { parsePdfBuffer } = require('./pdfText');
const { buildRaster } = require('./raster');
const { decodeQrFromRgba, compareQr } = require('./qrcode');
const { parseOcrImage } = require('./ocr');
const { normalizeDraft, validateDraft, MAIN_FIELDS, ITEM_FIELDS } = require('../utils/validate');

const PRIORITY = { ocr: 1, qr: 2, pdf: 3, xml: 4 };

function qrLayer(qr) {
  const invoice = {}, invoiceSources = {};
  const put = (f, v) => { if (v !== null && v !== undefined && v !== '') { invoice[f] = v; invoiceSources[f] = 'qr'; } };
  put('invoiceNumber', qr.invoiceNumber);
  put('issueDate', qr.issueDate);
  put('amountInclTax', qr.amount);
  return { layer: 'qr', ok: true, invoice, items: [], sources: { invoice: invoiceSources, items: [] } };
}

/** 多层级字段合并 */
function mergeLayers(layers) {
  const ordered = [...layers].sort((a, b) => (PRIORITY[a.layer] || 0) - (PRIORITY[b.layer] || 0));
  const invoice = {}, invoiceSources = {};
  for (const layer of ordered) {
    for (const f of MAIN_FIELDS) {
      const v = layer.invoice?.[f];
      if (v === null || v === undefined || v === '') continue;   // 空值不覆盖
      invoice[f] = v;
      invoiceSources[f] = layer.sources?.invoice?.[f] || layer.layer;
    }
  }
  let items = [], itemSources = [];
  for (const layer of ordered) {
    if (Array.isArray(layer.items) && layer.items.length) {
      items = layer.items.map((r) => {
        const row = {};
        for (const f of ITEM_FIELDS) row[f] = r[f] ?? null;
        return row;
      });
      itemSources = layer.items.map((r, i) => {
        const s = {};
        for (const f of ITEM_FIELDS) if (r[f] !== null && r[f] !== undefined && r[f] !== '') s[f] = layer.sources?.items?.[i]?.[f] || layer.layer;
        return s;
      });
    }
  }
  return { invoice, items, sources: { invoice: invoiceSources, items: itemSources } };
}

/**
 * @param {{buffer:Buffer, detectedType:string, originalName:string}} input
 * @returns 解析草稿 + _previewBuffer（由 files 路由落盘后剔除）
 */
async function parseFile({ buffer, detectedType, originalName }) {
  const layers = [], warnings = [], errors = [];
  let qr = null, previewBuffer = null, ocrUsed = false;

  // ① XML：最高优先级，可提取全部字段
  if (detectedType === 'xml') {
    const r = parseXml(buffer);
    if (r.ok) layers.push(r); else errors.push(r.error);
  }

  // ② PDF 文本层
  if (detectedType === 'pdf') {
    const r = await parsePdfBuffer(buffer);
    if (r.ok) layers.push(r); else errors.push(r.error);
  }

  // ③ 栅格化 + 二维码（PDF 渲染图 / 图片原件）
  let raster = { preview: null, rgba: null, width: 0, height: 0 };
  if (['pdf', 'jpg', 'png'].includes(detectedType)) {
    raster = await buildRaster(buffer, detectedType);
    previewBuffer = raster.preview;
    if (raster.error) warnings.push({ level: 'warn', type: 'raster', message: raster.error });
    if (raster.rgba) {
      const decoded = await decodeQrFromRgba(raster.rgba, raster.width, raster.height);
      if (decoded) {
        qr = decoded.payload;
        layers.push(qrLayer(qr));
      } else {
        warnings.push({ level: 'warn', type: 'qr', message: '未能自动校验，请核对票面' });
      }
    }
  }

  // ④ 图片和文本层缺失或不完整的 PDF 交给本地 OCR。
  const pdfLayer = layers.find((layer) => layer.layer === 'pdf');
  const needsOcr = ['jpg', 'png'].includes(detectedType) ||
    (detectedType === 'pdf' && raster.preview && (pdfLayer?.invoice.amountInclTax == null || !pdfLayer.items.length));
  if (config.ocr.enabled && needsOcr) {
    try {
      const r = await parseOcrImage(raster.preview || buffer);
      if (r.ok) { layers.push(r); ocrUsed = true; }
    } catch (error) {
      console.warn('[ocr]', error.message);
      warnings.push({ level: 'warn', type: 'ocr', message: '部分内容未能自动识别，请按票面补填' });
    }
  }

  const merged = mergeLayers(layers);
  // 票面明确标注的价税合计优先于可能只包含不含税金额的二维码。
  const ocrTotal = layers.find((layer) => layer.layer === 'ocr')?.invoice.amountInclTax;
  if (ocrTotal != null && merged.sources.invoice.amountInclTax === 'qr') {
    merged.invoice.amountInclTax = ocrTotal;
    merged.sources.invoice.amountInclTax = 'ocr';
  }
  const normalized = normalizeDraft(merged);
  const validation = validateDraft(normalized.invoice, normalized.items);
  const qrMismatch = compareQr(qr, normalized.invoice);
  for (const m of qrMismatch) {
    // 给出可操作的诊断提示：整数解析值 + 差额 < 1 元，通常意味着文本层小数位丢失
    m.hint = (m.field === 'amountInclTax' && Number.isInteger(Number(m.parsed)) && Math.abs(Number(m.qr) - Number(m.parsed)) < 1)
      ? '识别金额可能缺少小数位，请核对票面'
      : '请核对票面后修正，或选择「采用校验值」';
    warnings.push({ level: 'error', type: 'qr_mismatch', field: m.field, message: m.message, qr: m.qr, parsed: m.parsed, hint: m.hint });
  }

  const layerNames = layers.map((l) => l.layer);
  const highest = layerNames.length ? layerNames.sort((a, b) => (PRIORITY[b] || 0) - (PRIORITY[a] || 0))[0] : 'manual';

  return {
    originalName,
    detectedType,
    parseStatus: highest,
    ...normalized,
    qr,
    qrMismatch,
    warnings: [...warnings, ...validation],
    errors,
    meta: {
      layers: layerNames,
      ocrUsed,
      previewSize: previewBuffer ? previewBuffer.length : 0,
      extractableFields: MAIN_FIELDS.filter((f) => normalized.invoice[f] !== null).length,
      itemCount: normalized.items.length
    },
    _previewBuffer: previewBuffer
  };
}

module.exports = { parseFile, mergeLayers, PRIORITY };
