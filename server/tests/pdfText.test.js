'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const items = require('./fixtures/pdf-text-items.json');
const { buildLines, parsePdfTextItems, columnAnchors } = require('../src/parse/pdfText');
const { normalizeDraft, validateDraft } = require('../src/utils/validate');

test('PDF：按 y 聚类还原 11 行，行内按 x 排序', () => {
  const lines = buildLines(items);
  assert.equal(lines.length, 11);
  assert.ok(lines[0].text.includes('电子发票'));
  assert.ok(lines[1].text.includes('发票号码') && lines[1].text.includes('开票日期'));
  assert.ok(lines[1].segments[0].x <= lines[1].segments[1].x);
});

test('PDF：表头列锚点切出 8 列', () => {
  const lines = buildLines(items);
  const header = lines.findIndex((l) => l.text.includes('项目名称'));
  assert.ok(header >= 0);
  assert.equal(columnAnchors(lines[header]).length, 8);
  assert.deepEqual(columnAnchors(lines[header]).map((a) => a.field),
    ['name', 'spec', 'unit', 'quantity', 'unitPrice', 'amount', 'taxRate', 'taxAmount']);
});

test('PDF：关键词 + 左右分栏抽主表字段', () => {
  const r = parsePdfTextItems(items);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.invoice.invoiceNumber, '24312000000012345678');
  assert.equal(r.invoice.issueDate, '2026-05-01');
  assert.equal(r.invoice.buyerName, '重庆大学');
  assert.equal(r.invoice.sellerName, '重庆某某科技有限公司');
  assert.equal(r.invoice.buyerTaxId, '12500000400001234X');
  assert.equal(r.invoice.sellerTaxId, '91500107MA5UXXXXXY');
  assert.equal(r.invoice.amountExclTax, 200);
  assert.equal(r.invoice.totalTax, 26);
  assert.equal(r.invoice.amountInclTax, 226);
  assert.equal(r.invoice.remark, '测试用 PDF 样例');
  for (const [f, src] of Object.entries(r.sources.invoice)) assert.equal(src, 'pdf', `${f} 来源错误`);
});

test('PDF：明细表格按 x 归列，不把合计行当成明细', () => {
  const r = parsePdfTextItems(items);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].name, '*信息技术服务*软件开发');
  assert.equal(r.items[0].spec, '标准版');
  assert.equal(r.items[0].unit, '项');
  assert.equal(r.items[0].amount, '100.00');
  assert.equal(r.items[0].taxRate, '13%');
  assert.equal(r.items[0].taxAmount, '13.00');
  assert.equal(r.items[1].name, '*信息技术服务*技术服务');
  assert.equal(r.sources.items.length, 2);
  assert.equal(r.sources.items[0].amount, 'pdf');
});

test('PDF：解析结果归一化后金额自洽，无 sum 警告', () => {
  const n = normalizeDraft(parsePdfTextItems(items));
  assert.equal(n.invoice.amountInclTax, 226);
  assert.equal(n.items.length, 2);
  assert.equal(validateDraft(n.invoice, n.items).filter((w) => w.type === 'sum').length, 0);
});

test('PDF：空文本层返回失败层（扫描件降级手动录入）', () => {
  const r = parsePdfTextItems([]);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('无'));
});

