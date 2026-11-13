'use strict';
/** 管理员导出 Excel：Sheet1 发票主表（含打印状态/字段来源），Sheet2 全部明细行。 */
const ExcelJS = require('exceljs');
const { listInvoices } = require('./invoiceService');
const SOURCE_LABELS = { xml: 'XML', pdf: 'PDF文本', qr: '自动校验', ocr: '自动识别', manual: '手工', failed: '未识别' };

const MAIN_COLS = [
  ['ID', 'id', 8], ['姓名', 'studentName', 12], ['学号', 'studentId', 16],
  ['发票号码', 'invoiceNumber', 24], ['开票日期', 'issueDate', 14],
  ['购买方名称', 'buyerName', 26], ['购买方税号', 'buyerTaxId', 24],
  ['销售方名称', 'sellerName', 26], ['销售方税号', 'sellerTaxId', 24],
  ['合计金额(不含税)', 'amountExclTax', 16], ['合计税额', 'totalTax', 14], ['价税合计', 'amountInclTax', 16],
  ['备注', 'remark', 30], ['资金用途', 'fundPurpose', 30], ['打印状态', 'printStatus', 12], ['锁定', 'locked', 8],
  ['解析方式', 'parseStatus', 12], ['上传时间', 'createdAt', 20]
];
const ITEM_COLS = [
  ['发票ID', 'invoiceId', 10], ['发票号码', 'invoiceNumber', 24], ['姓名', 'studentName', 12], ['学号', 'studentId', 16],
  ['序号', 'sortOrder', 8], ['项目名称', 'name', 30], ['规格型号', 'spec', 16], ['单位', 'unit', 10],
  ['数量', 'quantity', 12], ['单价', 'unitPrice', 14], ['金额', 'amount', 14], ['税率', 'taxRate', 10], ['税额', 'taxAmount', 14]
];

function decorate(ws, cols) {
  ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
  head.alignment = { vertical: 'middle', horizontal: 'center' };
  head.height = 24;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

async function buildWorkbook(user, filters = {}) {
  const { list, items } = listInvoices(user, { ...filters, page: 1, size: 100000, withItems: true });
  const wb = new ExcelJS.Workbook();
  wb.creator = '数电发票收集与拼版打印系统';
  wb.created = new Date();

  const ws = wb.addWorksheet('发票主表');
  decorate(ws, MAIN_COLS);
  for (const inv of list) {
    ws.addRow({
      ...inv,
      parseStatus: SOURCE_LABELS[inv.parseStatus] || '混合来源',
      printStatus: inv.printStatus ? '已打印' : '未打印',
      locked: inv.locked ? '已锁定' : '否'
    });
  }
  ws.getColumn('amountExclTax').numFmt = '#,##0.00';
  ws.getColumn('totalTax').numFmt = '#,##0.00';
  ws.getColumn('amountInclTax').numFmt = '#,##0.00';

  const ws2 = wb.addWorksheet('发票明细');
  decorate(ws2, ITEM_COLS);
  for (const inv of list) {
    for (const it of (items?.[inv.id] || [])) {
      ws2.addRow({
        invoiceId: inv.id, invoiceNumber: inv.invoiceNumber,
        studentName: inv.studentName, studentId: inv.studentId,
        sortOrder: it.sortOrder + 1, name: it.name, spec: it.spec, unit: it.unit,
        quantity: it.quantity, unitPrice: it.unitPrice, amount: it.amount,
        taxRate: it.taxRate, taxAmount: it.taxAmount
      });
    }
  }
  for (const k of ['quantity', 'unitPrice', 'amount', 'taxAmount']) ws2.getColumn(k).numFmt = '#,##0.00';

  // 第三张表：字段来源审计（哪些字段来自 xml/pdf/qr/ocr/manual）
  const ws3 = wb.addWorksheet('字段来源');
  ws3.columns = [{ header: '发票ID', key: 'id', width: 10 }, { header: '发票号码', key: 'no', width: 24 },
    { header: '字段', key: 'field', width: 22 }, { header: '来源', key: 'source', width: 14 }, { header: '值', key: 'value', width: 40 }];
  ws3.getRow(1).font = { bold: true };
  for (const inv of list) {
    for (const [field, source] of Object.entries(inv.fieldSources?.invoice || {})) {
      if (!source) continue;
      ws3.addRow({ id: inv.id, no: inv.invoiceNumber, field, source: SOURCE_LABELS[source] || '自动识别', value: String(inv[field] ?? '') });
    }
  }
  return { buffer: await wb.xlsx.writeBuffer(), count: list.length };
}

module.exports = { buildWorkbook };

