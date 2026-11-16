'use strict';
/**
 * 示例数据：3 名学生 + 6 张发票（含明细、字段来源、预览版式图）+ 1 个打印批次。
 * 幂等：已有发票时直接跳过；如需重置请删除 data/invoice.db 后重跑 init-db + seed。
 */
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { getDb, transaction } = require('../db');

getDb().exec(fs.readFileSync(config.schemaFile, 'utf8'));
const db = getDb();
if (db.prepare('SELECT COUNT(*) AS c FROM invoices').get().c > 0) {
  console.log('ℹ️  已存在发票数据，跳过示例数据（如需重置请删除 data/invoice.db）');
  process.exit(0);
}

// 示例版式图用中文字体（按平台探测）
let FONT = 'sans-serif';
try {
  const { GlobalFonts } = require('@napi-rs/canvas');
  const candidates = ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simsun.ttc',
    '/System/Library/Fonts/PingFang.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'];
  for (const p of candidates) {
    if (fs.existsSync(p)) { GlobalFonts.registerFromPath(p, 'CJK'); FONT = 'CJK'; break; }
  }
} catch (_e) { /* 字体不可用时退化为默认字体 */ }

const F = (n) => `${n}px ${FONT}, sans-serif`;
function makePreview(inv) {
  const { createCanvas } = require('@napi-rs/canvas');
  const c = createCanvas(900, 600);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 600);
  x.strokeStyle = '#b23b3b'; x.lineWidth = 3; x.strokeRect(16, 16, 868, 568);
  x.fillStyle = '#b23b3b'; x.font = F(30); x.fillText('电子发票（普通发票）', 300, 66);
  x.fillStyle = '#222'; x.font = F(18);
  x.fillText(`发票号码：${inv.no}`, 40, 110);
  x.fillText(`开票日期：${inv.date}`, 520, 110);
  x.strokeStyle = '#999'; x.lineWidth = 1; x.strokeRect(36, 130, 828, 90);
  x.fillText(`购买方名称：重庆大学`, 48, 162);
  x.fillText(`销售方名称：${inv.seller}`, 48, 200);
  x.fillText(`统一社会信用代码：12500000400001234X / 91500107MA5UXXXXXY`, 48, 232 - 6);
  x.strokeRect(36, 236, 828, 130);
  x.fillText('项目名称', 48, 266); x.fillText('数量', 400, 266); x.fillText('单价', 530, 266); x.fillText('金额', 680, 266); x.fillText('税额', 790, 266);
  x.beginPath(); x.moveTo(36, 280); x.lineTo(864, 280); x.stroke();
  x.fillText(inv.itemName, 48, 312); x.fillText('1', 400, 312);
  x.fillText(inv.amount.toFixed(2), 530, 312); x.fillText(inv.amount.toFixed(2), 680, 312); x.fillText(inv.tax.toFixed(2), 790, 312);
  x.fillText('合计', 48, 348); x.fillText(`¥${inv.amount.toFixed(2)}`, 680, 348); x.fillText(`¥${inv.tax.toFixed(2)}`, 790, 348);
  x.fillStyle = '#b23b3b'; x.font = F(22);
  x.fillText(`价税合计（小写）¥${inv.total.toFixed(2)}`, 48, 400);
  x.fillStyle = '#555'; x.font = F(15);
  x.fillText(`备注：${inv.remark}`, 48, 440);
  x.fillText('本图由示例数据生成，仅用于演示拼版打印，非真实发票', 48, 540);
  return c.toBuffer('image/png');
}

function makeXml(inv) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ElectronicInvoice>
  <Header><InvoiceNumber>${inv.no}</InvoiceNumber><IssueDate>${inv.date}</IssueDate><Remark>${inv.remark}</Remark></Header>
  <Buyer><Name>重庆大学</Name><TaxID>12500000400001234X</TaxID></Buyer>
  <Seller><Name>${inv.seller}</Name><TaxID>91500107MA5UXXXXXY</TaxID></Seller>
  <Totals><AmountExclTax>${inv.amount.toFixed(2)}</AmountExclTax><TotalTax>${inv.tax.toFixed(2)}</TotalTax><AmountInclTax>${inv.total.toFixed(2)}</AmountInclTax></Totals>
  <Items><Item><Name>${inv.itemName}</Name><Spec>标准</Spec><Unit>项</Unit><Quantity>1</Quantity><UnitPrice>${inv.amount.toFixed(2)}</UnitPrice><Amount>${inv.amount.toFixed(2)}</Amount><TaxRate>6%</TaxRate><TaxAmount>${inv.tax.toFixed(2)}</TaxAmount></Item></Items>
</ElectronicInvoice>`;
}

const students = [
  { name: '吕相辉', sid: '20244195' },
  { name: '张明', sid: '20244196' },
  { name: '李华', sid: '20244197' }
];
const samples = [
  { no: '24312000000000000001', date: '2026-09-03', seller: '重庆新华书店有限公司', itemName: '*印刷服务*教材印制', amount: 88.00, tax: 5.28, total: 93.28, ui: 0, remark: '教材资料' },
  { no: '24312000000000000002', date: '2026-09-18', seller: '重庆文具商贸有限公司', itemName: '*办公用品*笔记本', amount: 126.00, tax: 7.56, total: 133.56, ui: 1, remark: '实验耗材' },
  { no: '24312000000000000003', date: '2026-10-05', seller: '重庆云计算科技有限公司', itemName: '*信息技术服务*云主机', amount: 399.00, tax: 23.94, total: 422.94, ui: 0, remark: '' },
  { no: '24312000000000000004', date: '2026-10-21', seller: '重庆交通服务有限公司', itemName: '*运输服务*市内交通', amount: 45.50, tax: 2.73, total: 48.23, ui: 2, remark: '调研差旅' },
  { no: '24312000000000000005', date: '2026-11-02', seller: '重庆图书发行有限公司', itemName: '*图书*专业教材', amount: 216.00, tax: 12.96, total: 228.96, ui: 1, remark: '' },
  { no: '24312000000000000006', date: '2026-11-11', seller: '重庆软件服务有限公司', itemName: '*软件服务*授权许可', amount: 680.00, tax: 40.80, total: 720.80, ui: 0, remark: '毕业设计用' }
];

fs.mkdirSync(config.uploadsDir, { recursive: true });
fs.mkdirSync(config.previewDir, { recursive: true });
const seedDir = path.join(config.uploadsDir, 'seed');
fs.mkdirSync(seedDir, { recursive: true });

transaction(() => {
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()
    || { id: db.prepare("INSERT INTO users (role, name, username) VALUES ('admin', ?, 'admin')").run(config.admin.displayName).lastInsertRowid };
  const userIds = students.map((s) => {
    let u = db.prepare("SELECT id FROM users WHERE student_id = ? AND deleted_at IS NULL").get(s.sid);
    if (!u) u = { id: db.prepare("INSERT INTO users (role, name, student_id) VALUES ('student', ?, ?)").run(s.name, s.sid).lastInsertRowid };
    return u.id;
  });

  const invoiceIds = [];
  samples.forEach((inv, i) => {
    const xmlName = `seed-${i + 1}.xml`, pngName = `seed-${i + 1}.png`;
    fs.writeFileSync(path.join(seedDir, xmlName), makeXml(inv), 'utf8');
    fs.writeFileSync(path.join(config.previewDir, pngName), makePreview(inv));
    const fr = db.prepare(`INSERT INTO files
      (original_name, stored_name, rel_path, preview_rel_path, mime, detected_type, size, sha256, uploaded_by, bound)
      VALUES (?, ?, ?, ?, 'application/xml', 'xml', ?, ?, ?, 1)`).run(
      `示例发票_${i + 1}.xml`, xmlName, path.posix.join('seed', xmlName), path.posix.join('_previews', pngName),
      Buffer.byteLength(makeXml(inv)), 'seed', userIds[inv.ui]
    );
    const sources = { invoice: {}, items: [{}] };
    for (const f of ['invoiceNumber', 'issueDate', 'buyerName', 'buyerTaxId', 'sellerName', 'sellerTaxId', 'amountExclTax', 'totalTax', 'amountInclTax', 'remark']) sources.invoice[f] = 'xml';
    for (const f of ['name', 'spec', 'unit', 'quantity', 'unitPrice', 'amount', 'taxRate', 'taxAmount']) sources.items[0][f] = 'xml';
    const ir = db.prepare(`INSERT INTO invoices
      (user_id, file_id, invoice_number, issue_date, buyer_name, buyer_tax_id, seller_name, seller_tax_id,
       amount_excl_tax, total_tax, amount_incl_tax, remark, field_sources, warnings, parse_status, created_at)
      VALUES (?, ?, ?, ?, '重庆大学', '12500000400001234X', ?, '91500107MA5UXXXXXY', ?, ?, ?, ?, ?, '[]', 'xml', ?)`).run(
      userIds[inv.ui], fr.lastInsertRowid, inv.no, inv.date, inv.seller,
      inv.amount, inv.tax, inv.total, inv.remark, JSON.stringify(sources),
      `${inv.date} 10:0${i}:00`
    );
    const id = Number(ir.lastInsertRowid);
    invoiceIds.push(id);
    db.prepare(`INSERT INTO invoice_items
      (invoice_id, sort_order, name, spec, unit, quantity, unit_price, amount, tax_rate, tax_amount, field_sources)
      VALUES (?, 0, ?, '标准', '项', 1, ?, ?, '6%', ?, ?)`).run(
      id, inv.itemName, inv.amount, inv.amount, inv.tax, JSON.stringify(sources.items[0])
    );
  });

  // 1 个示例打印批次：前 2 张标记为已打印
  const layout = { perPage: 2, orientation: 'portrait', marginTop: 10, marginBottom: 10, marginLeft: 10, marginRight: 10, gapX: 5, gapY: 8, scale: 100, sortBy: 'uploadedAt', order: 'asc', printNameId: true, ids: invoiceIds.slice(0, 2) };
  const br = db.prepare(`INSERT INTO print_batches (operator_id, operator_name, count, layout, action, created_at)
    VALUES (?, ?, 2, ?, 'print', datetime('now','localtime','-2 days'))`).run(admin.id, config.admin.displayName, JSON.stringify(layout));
  const batchId = Number(br.lastInsertRowid);
  for (const id of invoiceIds.slice(0, 2)) {
    db.prepare('INSERT INTO print_batch_items (batch_id, invoice_id, prev_print_status) VALUES (?, ?, 0)').run(batchId, id);
    db.prepare("UPDATE invoices SET print_status = 1, print_batch_id = ?, printed_at = datetime('now','localtime','-2 days') WHERE id = ?").run(batchId, id);
  }
  db.prepare(`INSERT INTO operation_logs (actor_id, actor_name, actor_role, action, target_type, target_id, detail)
    VALUES (?, ?, 'admin', 'create_print_batch', 'print_batch', ?, ?)`).run(admin.id, config.admin.displayName, batchId, JSON.stringify({ ids: invoiceIds.slice(0, 2) }));
})();

console.log('✅ 示例数据已生成：3 名学生 / 6 张发票（2 张已打印）/ 1 个打印批次');
console.log('   学生登录示例：姓名 吕相辉 + 学号 20244195');
console.log('   管理员：admin / Admin@123456（见 server/config.js）');
