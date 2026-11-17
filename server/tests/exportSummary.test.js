'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildSummaryWorkbook } = require('../src/services/exportService');

test('buildSummaryWorkbook：生成指定 11 列报销明细（多明细只取第一项）与人员报销统计', async () => {
  const invoices = [
    {
      id: 101, userId: 1, studentName: '张三', studentId: '2026001',
      invoiceNumber: '25310000000000000001',
      buyerName: '某大学', buyerTaxId: '12100000400000000X',
      sellerName: '测试商店A', issueDate: '2026-11-01',
      amountInclTax: 120.5,
      items: [{ name: '打印纸' }, { name: '墨盒' }]
    },
    {
      id: 102, userId: 2, studentName: '李四', studentId: '2026002',
      invoiceNumber: '25310000000000000002',
      buyerName: '某大学', buyerTaxId: '12100000400000000X',
      sellerName: '测试商店B', issueDate: '2026-11-02',
      amountInclTax: 80.1,
      items: [{ name: '交通费' }]
    },
    {
      id: 103, userId: 1, studentName: '张三', studentId: '2026001',
      invoiceNumber: '25310000000000000003',
      buyerName: '某大学', buyerTaxId: '12100000400000000X',
      sellerName: '测试商店C', issueDate: '2026-11-03',
      amountInclTax: 30.25,
      items: []
    }
  ];

  const { buffer, count } = await buildSummaryWorkbook(invoices);
  assert.equal(count, 3);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws1 = wb.getWorksheet('报销明细');
  assert.ok(ws1);
  assert.deepEqual(ws1.getRow(1).values.slice(1), [
    '发票ID', '姓名', '学号', '序号', '发票号码',
    '购买方名称', '购买方税号', '开票单位', '开票日期', '开票内容', '发票金额'
  ]);
  assert.deepEqual(ws1.getRow(2).values.slice(1), [
    101, '张三', '2026001', 1, '25310000000000000001',
    '某大学', '12100000400000000X', '测试商店A', '2026-11-01', '打印纸', 120.5
  ]);
  assert.equal(ws1.getRow(4).getCell(4).value, 3);
  assert.equal(ws1.getRow(4).getCell(10).value, '');

  const ws2 = wb.getWorksheet('人员报销统计');
  assert.ok(ws2);
  assert.deepEqual(ws2.getRow(1).values.slice(1), ['姓名', '学号', '发票张数', '应报销金额']);
  assert.deepEqual(ws2.getRow(2).values.slice(1), ['张三', '2026001', 2, 150.75]);
  assert.deepEqual(ws2.getRow(3).values.slice(1), ['李四', '2026002', 1, 80.1]);
  assert.deepEqual(ws2.getRow(4).values.slice(1), ['合计', '', 3, 230.85]);
});
