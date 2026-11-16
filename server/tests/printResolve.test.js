'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-print-resolve-'));
process.env.DATA_DIR = tempDir;

const { getDb } = require('../src/db');
const { parseInvoiceNumbers, resolveByNumbers } = require('../src/services/printService');

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_e) { /* Windows SQLite lock */ }
});

test('parseInvoiceNumbers：支持多种分隔符并保留首次出现顺序且去重', () => {
  const input = ' 25310001\n25310002, 25310003；25310001、25310004\t25310002 ';
  const r = parseInvoiceNumbers(input);
  assert.deepEqual(r.numbers, ['25310001', '25310002', '25310003', '25310004']);
  assert.equal(r.duplicatesRemoved, 2);
});

test('parseInvoiceNumbers：空输入或超出 500 条抛出 400 错误', () => {
  assert.throws(() => parseInvoiceNumbers('   \n , '), { status: 400 });
  const over = Array.from({ length: 501 }, (_, i) => `2531${String(i).padStart(4, '0')}`).join('\n');
  assert.throws(() => parseInvoiceNumbers(over), { status: 400 });
});

test('resolveByNumbers：严格按输入发票号码顺序返回 ID 与未找到列表', () => {
  const db = getDb();
  const userId = db.prepare("INSERT INTO users (role, name, student_id) VALUES ('student', '测试学生', 'S1001')").run().lastInsertRowid;
  const ins = db.prepare('INSERT INTO invoices (user_id, invoice_number, amount_incl_tax) VALUES (?, ?, ?)');
  const idA = Number(ins.run(userId, '25310000000000000001', 100).lastInsertRowid);
  const idB = Number(ins.run(userId, '25310000000000000002', 200).lastInsertRowid);
  const idC = Number(ins.run(userId, '25310000000000000003', 300).lastInsertRowid);

  const res = resolveByNumbers('25310000000000000003\n25319999999999999999\n25310000000000000001,25310000000000000002');
  assert.deepEqual(res.ids, [idC, idA, idB]);
  assert.deepEqual(res.missing, ['25319999999999999999']);
  assert.equal(res.totalInput, 4);
  assert.equal(res.matchedCount, 3);
});
