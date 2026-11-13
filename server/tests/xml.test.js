'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseXml } = require('../src/parse/xml');
const { normalizeDraft, validateDraft } = require('../src/utils/validate');

const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.xml'));

test('XML：主表 10 个字段全部提取', () => {
  const r = parseXml(buf);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.invoice.invoiceNumber, '24312000000012345678');
  assert.equal(r.invoice.issueDate, '2026-05-01');
  assert.equal(r.invoice.buyerName, '重庆大学');
  assert.equal(r.invoice.buyerTaxId, '12500000400001234X');
  assert.equal(r.invoice.sellerName, '重庆某某科技有限公司');
  assert.equal(r.invoice.sellerTaxId, '91500107MA5UXXXXXY');
  assert.equal(r.invoice.amountExclTax, '200.00');
  assert.equal(r.invoice.totalTax, '26.00');
  assert.equal(r.invoice.amountInclTax, '226.00');
  assert.equal(r.invoice.remark, '测试用样例发票');
});

test('XML：命名空间前缀 + 嵌套明细容器正确还原为 2 行', () => {
  const r = parseXml(buf);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].name, '*信息技术服务*软件开发');
  assert.equal(r.items[0].spec, '标准版');
  assert.equal(r.items[0].unit, '项');
  assert.equal(r.items[0].quantity, '1');
  assert.equal(r.items[0].unitPrice, '100.00');
  assert.equal(r.items[0].amount, '100.00');
  assert.equal(r.items[0].taxRate, '13%');
  assert.equal(r.items[0].taxAmount, '13.00');
  assert.equal(r.items[1].name, '*信息技术服务*技术服务');
});

test('XML：每个字段记录来源 xml，且不会编造不存在的字段', () => {
  const r = parseXml(buf);
  for (const [f, src] of Object.entries(r.sources.invoice)) assert.equal(src, 'xml', `字段 ${f} 来源错误`);
  assert.equal(r.items.length, r.sources.items.length);
  assert.equal(r.sources.items[0].name, 'xml');

  const minimal = Buffer.from('<?xml version="1.0"?><Invoice><InvoiceNumber>24312000000099999999</InvoiceNumber></Invoice>');
  const m = normalizeDraft(parseXml(minimal));
  assert.equal(m.invoice.invoiceNumber, '24312000000099999999');
  assert.equal(m.invoice.buyerName, null);
  assert.equal(m.invoice.sellerName, null);
  assert.equal(m.invoice.amountInclTax, null);
  assert.deepEqual(m.items, []);
});

test('XML：归一化后金额自洽（明细和 / 金额+税额 均无 sum 警告）', () => {
  const n = normalizeDraft(parseXml(buf));
  assert.equal(n.invoice.amountExclTax, 200);
  assert.equal(n.invoice.totalTax, 26);
  assert.equal(n.invoice.amountInclTax, 226);
  assert.equal(n.items.length, 2);
  assert.equal(n.items[0].amount, 100);
  const sumWarnings = validateDraft(n.invoice, n.items).filter((w) => w.type === 'sum');
  assert.equal(sumWarnings.length, 0, JSON.stringify(sumWarnings));
});

test('XML：非法内容返回失败层而不抛异常（降级手动录入）', () => {
  const r = parseXml(Buffer.from('<a><b>not closed'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.invoice, {});
  assert.ok(r.error);
});

