'use strict';
/**
 * 回归测试：用户实测发票「二维码 217.78 / 解析 217」暴露的小数位丢失 bug。
 * 早期 MONEY_RE 把 \.\d{2} 放在捕获组外，导致所有非 .00 金额被截断为整数；
 * 原单元测试金额恰好全是 .00，未能发现，故补充本文件。
 * 行文本已脱敏，仅保留版式与数字特征，不包含原件二进制。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePdfTextItems, allMoney, sanitizeItemRow } = require('../src/parse/pdfText');
const { compareQr } = require('../src/parse/qrcode');
const { normalizeDraft, validateDraft } = require('../src/utils/validate');
const { decodeFilename } = require('../src/routes/files');

const REAL_LINES = [
  '电子发票（普通发票）发票号码：26444000000349868371',
  '开票日期：2026年11月13日',
  '项目名称规格型号单位数量单价金额税率/征收率税额',
  '*移动通信设备*配件个1215.623762376238215.621%2.16',
  '合计¥215.62¥2.16',
  '价税合计（大写）贰佰壹拾柒圆柒角捌分（小写）¥217.78',
  '开票人：测试'
];
const asItems = (lines) => lines.map((str, i) => ({ str, transform: [1, 0, 0, 1, 40, 800 - i * 20], width: str.length * 10 }));

test('回归：金额必须保留小数位，不能被截断成整数', () => {
  assert.deepEqual(allMoney('合计¥215.62¥2.16'), [215.62, 2.16]);
  assert.deepEqual(allMoney('价税合计（大写）贰佰壹拾柒圆柒角捌分（小写）¥217.78'), [217.78]);
  assert.deepEqual(allMoney('¥1,234.56'), [1234.56]);          // 千分位
  assert.deepEqual(allMoney('¥217. 78'), [217.78]);             // pdf.js 拆出空白
  assert.notEqual(allMoney('¥217.78')[0], 217);
});

test('回归：真实版式端到端解析出 215.62 / 2.16 / 217.78', () => {
  const r = parsePdfTextItems(asItems(REAL_LINES));
  assert.equal(r.ok, true);
  assert.equal(r.invoice.invoiceNumber, '26444000000349868371');
  assert.equal(r.invoice.issueDate, '2026-11-13');
  assert.equal(r.invoice.amountExclTax, 215.62);
  assert.equal(r.invoice.totalTax, 2.16);
  assert.equal(r.invoice.amountInclTax, 217.78);
});

test('回归：修复后二维码 217.78 不再报不一致，金额校验无 sum 警告', () => {
  const r = parsePdfTextItems(asItems(REAL_LINES));
  const qr = { invoiceNumber: '26444000000349868371', issueDate: '2026-11-13', amount: 217.78 };
  assert.deepEqual(compareQr(qr, r.invoice), []);
  const n = normalizeDraft(r);
  assert.equal(n.invoice.amountInclTax, 217.78);
  const sumWarnings = validateDraft(n.invoice, n.items).filter((w) => w.type === 'sum' && w.field === 'amountInclTax');
  assert.equal(sumWarnings.length, 0, JSON.stringify(sumWarnings));
});

test('回归：项目名称版式换行时合并为一行，不产生半截明细', () => {
  const cell = (str, x, y, w) => ({ str, transform: [1, 0, 0, 1, x, y], width: w });
  const items = [
    cell('项目名称', 40, 600, 40), cell('规格型号', 140, 600, 40), cell('单位', 220, 600, 20),
    cell('数量', 270, 600, 20), cell('单价', 320, 600, 20), cell('金额', 390, 600, 20),
    cell('税率', 460, 600, 20), cell('税额', 520, 600, 20),
    cell('*移动通信设备*配件', 40, 570, 140), cell('个', 220, 570, 12), cell('1', 270, 570, 10),
    cell('215.62', 320, 570, 40), cell('215.62', 390, 570, 40), cell('1%', 460, 570, 22), cell('2.16', 520, 570, 38),
    cell('牌 原装手机周边配件', 40, 545, 140), cell('线充电器小涡轮', 140, 545, 40)
  ];
  const r = parsePdfTextItems(items);
  assert.equal(r.items.length, 1);
  assert.ok(r.items[0].name.includes('牌 原装手机周边配件'));
  assert.equal(r.items[0].amount, '215.62');
  assert.equal(r.items[0].taxAmount, '2.16');
});

test('回归：表头有空格、续行只有商品名称时保留完整明细及下一商品', () => {
  const cell = (str, x, y) => ({ str, x, y, width: str.length * 5 });
  const items = [
    cell('项目名称', 40, 600), cell('数 量', 270, 600), cell('单 价', 320, 600),
    cell('金 额', 390, 600), cell('税 率', 460, 600), cell('税 额', 520, 600),
    cell('*文具*长商品名称', 40, 570), cell('1', 270, 570), cell('70.80', 320, 570),
    cell('70.80', 390, 570), cell('13%', 460, 570), cell('9.20', 520, 570),
    cell('第二行', 40, 558),
    cell('*文具*另一个商品', 40, 546), cell('20.00', 390, 546), cell('2.60', 520, 546),
    cell('计', 40, 530), cell('¥90.80', 390, 530), cell('¥11.80', 520, 530)
  ];
  const result = parsePdfTextItems(items);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, '*文具*长商品名称第二行');
  assert.equal(result.items[0].quantity, '1');
  assert.equal(result.items[0].amount, '70.80');
  assert.equal(result.items[1].name, '*文具*另一个商品');
});

test('回归：multipart 中文文件名的 latin1 乱码还原为 UTF-8', () => {
  const mojibake = Buffer.from('拼多多商家电子发票.pdf', 'utf8').toString('latin1');
  assert.notEqual(mojibake, '拼多多商家电子发票.pdf');
  assert.equal(decodeFilename(mojibake), '拼多多商家电子发票.pdf');
  assert.equal(decodeFilename('invoice.pdf'), 'invoice.pdf');   // 纯 ASCII 不受影响
  assert.equal(decodeFilename('中文发票.pdf'), '中文发票.pdf');  // 已是中文不重复转换
});

test('回归：明细串列产生的畸形数字留空，不编造看似合理的错值', () => {
  const s = sanitizeItemRow({
    name: '*移动通信设备*配件', quantity: '1215.623762376238',
    amount: '215.62', taxAmount: '2.16', taxRate: '1%'
  });
  assert.equal(s.quantity, undefined);       // 畸形长数字 → 留空待人工补填
  assert.equal(s.amount, '215.62');
  assert.equal(s.taxAmount, '2.16');
  assert.equal(s.name, '*移动通信设备*配件');
});

