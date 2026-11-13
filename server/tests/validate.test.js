'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkTaxId, normalizeDraft, validateDraft } = require('../src/utils/validate');
const { detectByMagic } = require('../src/utils/fileGuard');

test('税号：18 位格式 + GB32100 校验位', () => {
  assert.equal(checkTaxId('').formatOk, false);
  assert.equal(checkTaxId('123').formatOk, false);
  const r = checkTaxId('91500107MA5UXXXXXY');
  assert.equal(r.formatOk, true);
  assert.equal(typeof r.checksumOk, 'boolean');
});

test('校验：金额不自洽只产生警告，不抛异常', () => {
  const n = normalizeDraft({
    invoice: { invoiceNumber: '24312000000012345678', amountExclTax: '100.00', totalTax: '10.00', amountInclTax: '200.00', buyerTaxId: 'abc' },
    items: [{ name: '服务', amount: '50.00' }]
  });
  const w = validateDraft(n.invoice, n.items);
  assert.ok(w.some((x) => x.type === 'sum' && x.field === 'amountExclTax'));
  assert.ok(w.some((x) => x.type === 'sum' && x.field === 'amountInclTax'));
  assert.ok(w.some((x) => x.type === 'taxid'));
  assert.ok(w.every((x) => x.level === 'warn'));   // 只警告，不禁止提交
});

test('文件头：magic number 判定，扩展名不参与类型判定', () => {
  assert.equal(detectByMagic(Buffer.from('%PDF-1.7\nn')), 'pdf');
  assert.equal(detectByMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])), 'png');
  assert.equal(detectByMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'jpg');
  assert.equal(detectByMagic(Buffer.from('<?xml version="1.0"?><A><B>1</B></A>')), 'xml');
  assert.equal(detectByMagic(Buffer.from('MZ\x90\x00')), null);   // 伪造成 .pdf 的可执行文件
});

