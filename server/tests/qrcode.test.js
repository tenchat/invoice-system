'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQrPayload, compareQr } = require('../src/parse/qrcode');
const { mergeLayers, PRIORITY } = require('../src/parse');

test('二维码：URL 参数解析发票号码 / 日期 / 金额', () => {
  const q = parseQrPayload('https://fp.example.com/verify?fphm=24312000000012345678&kprq=20260501&je=226.00&type=32');
  assert.equal(q.invoiceNumber, '24312000000012345678');
  assert.equal(q.issueDate, '2026-05-01');
  assert.equal(q.amount, 226);
});

test('二维码：逗号分隔经典格式解析', () => {
  const q = parseQrPayload('01,32,,24312000000012345678,226.00,20260501,1234567890');
  assert.equal(q.invoiceNumber, '24312000000012345678');
  assert.equal(q.issueDate, '2026-05-01');
  assert.equal(q.amount, 226);
});

test('二维码：不一致产出 mismatch，解析为空时视为可补齐不报警', () => {
  const qr = { invoiceNumber: '24312000000012345678', issueDate: '2026-05-01', amount: 226 };
  const bad = compareQr(qr, { invoiceNumber: '24312000000099999999', issueDate: '2026-05-01', amountInclTax: 226 });
  assert.equal(bad.length, 1);
  assert.equal(bad[0].field, 'invoiceNumber');
  assert.equal(bad[0].qr, '24312000000012345678');
  assert.equal(compareQr(qr, {}).length, 0);
  assert.equal(parseQrPayload('').invoiceNumber, null);
});

test('合并：xml > pdf > qr 字段级覆盖，明细整体取最高优先级层', () => {
  assert.ok(PRIORITY.xml > PRIORITY.pdf && PRIORITY.pdf > PRIORITY.qr && PRIORITY.qr > PRIORITY.ocr);
  const qr = { layer: 'qr', invoice: { invoiceNumber: '11111111111111111111', amountInclTax: 999 }, items: [], sources: { invoice: {}, items: [] } };
  const pdf = { layer: 'pdf', invoice: { invoiceNumber: '22222222222222222222', buyerName: 'PDF购买方', sellerName: 'PDF销售方' }, items: [{ name: 'PDF明细' }], sources: { invoice: {}, items: [{}] } };
  const xml = { layer: 'xml', invoice: { invoiceNumber: '33333333333333333333', buyerName: 'XML购买方' }, items: [{ name: 'XML明细' }], sources: { invoice: {}, items: [{}] } };
  const m = mergeLayers([xml, pdf, qr]);
  assert.equal(m.invoice.invoiceNumber, '33333333333333333333');
  assert.equal(m.invoice.buyerName, 'XML购买方');
  assert.equal(m.invoice.sellerName, 'PDF销售方');   // XML 无该字段，保留 PDF
  assert.equal(m.invoice.amountInclTax, 999);        // 仅二维码提供，用于补齐
  assert.equal(m.sources.invoice.invoiceNumber, 'xml');  // 最高层覆盖，来源同步更新
  assert.equal(m.sources.invoice.sellerName, 'pdf');
  assert.equal(m.sources.invoice.amountInclTax, 'qr');
  assert.equal(m.items.length, 1);
  assert.equal(m.items[0].name, 'XML明细');           // 不跨层拼行
});
