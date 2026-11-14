'use strict';
/** 发票业务层：CRUD、查重、权限、统计。所有学生查询强制带 user_id，杜绝越权。 */
const { getDb, transaction } = require('../db');
const { ApiError } = require('../middleware/error');
const { normalizeDraft, validateDraft, str, intIn, numOrNull } = require('../utils/validate');
const { validateSubmission } = require('./amountPolicy');

function toDto(row) {
  if (!row) return null;
  const j = (s, def) => { try { return JSON.parse(s || 'null') ?? def; } catch (_e) { return def; } };
  return {
    id: row.id, userId: row.user_id, fileId: row.file_id,
    invoiceNumber: row.invoice_number, issueDate: row.issue_date,
    buyerName: row.buyer_name, buyerTaxId: row.buyer_tax_id,
    sellerName: row.seller_name, sellerTaxId: row.seller_tax_id,
    amountExclTax: row.amount_excl_tax, totalTax: row.total_tax, amountInclTax: row.amount_incl_tax,
    remark: row.remark,
    fundPurpose: row.fund_purpose,
    scanStatus: !!row.scan_status,
    recognizedTotal: row.recognized_total ?? null,
    fieldSources: j(row.field_sources, { invoice: {}, items: [] }),
    warnings: j(row.warnings, []),
    parseStatus: row.parse_status,
    locked: !!row.locked,
    printStatus: !!row.print_status,
    printBatchId: row.print_batch_id,
    printedAt: row.printed_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
    studentName: row.student_name || null,
    studentId: row.student_id || null,
    originalName: row.original_name || null,
    detectedType: row.detected_type || null
  };
}

function itemDto(row) {
  return {
    id: row.id, invoiceId: row.invoice_id, sortOrder: row.sort_order,
    name: row.name, spec: row.spec, unit: row.unit,
    quantity: row.quantity, unitPrice: row.unit_price, amount: row.amount,
    taxRate: row.tax_rate, taxAmount: row.tax_amount,
    fieldSources: (() => { try { return JSON.parse(row.field_sources || '{}'); } catch (_e) { return {}; } })()
  };
}

const SELECT = `
  SELECT i.*, u.name AS student_name, u.student_id AS student_id,
         f.original_name AS original_name, f.detected_type AS detected_type,
         f.preview_rel_path AS preview_rel_path, f.rel_path AS file_rel_path, f.recognized_total AS recognized_total
  FROM invoices i
  LEFT JOIN users u ON u.id = i.user_id
  LEFT JOIN files f ON f.id = i.file_id
`;

function getItems(invoiceIds) {
  if (!invoiceIds.length) return {};
  const db = getDb();
  const ph = invoiceIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id IN (${ph}) ORDER BY sort_order, id`).all(...invoiceIds);
  const map = {};
  for (const r of rows) (map[r.invoice_id] ||= []).push(itemDto(r));
  return map;
}

/** 新建：检查发票查重与金额规则，保留票面校验提示。 */
function createInvoice(user, payload) {
  const d = normalizeDraft(payload);
  if (!d.invoice.invoiceNumber) throw new ApiError(400, '发票号码为必填项（20 位数电票号码），请手动补填后再提交');
  const warnings = validateDraft(d.invoice, d.items);
  const warningsFromClient = Array.isArray(payload.warnings) ? payload.warnings.slice(0, 30) : [];
  const db = getDb();

  const dup = db.prepare('SELECT id, user_id FROM invoices WHERE invoice_number = ?').get(d.invoice.invoiceNumber);
  if (dup) throw new ApiError(409, `发票号码 ${d.invoice.invoiceNumber} 已存在（ID ${dup.id}），重复提交被拒绝`);

  let fileId = null;
  let recognizedTotal = null;
  if (payload.fileId) {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(payload.fileId);
    if (!f) throw new ApiError(400, '关联文件不存在');
    if (f.uploaded_by !== user.uid && user.role !== 'admin') throw new ApiError(403, '无权使用该文件');
    fileId = f.id;
    recognizedTotal = f.recognized_total ?? null;
  }
  const fundPurpose = typeof payload.fundPurpose === 'string' ? str(payload.fundPurpose, 500) : null;
  validateSubmission(d.invoice, recognizedTotal, fundPurpose);

  return transaction(() => {
    const r = db.prepare(`
      INSERT INTO invoices (user_id, file_id, invoice_number, issue_date, buyer_name, buyer_tax_id,
        seller_name, seller_tax_id, amount_excl_tax, total_tax, amount_incl_tax, remark,
        field_sources, warnings, parse_status, fund_purpose)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.uid, fileId, d.invoice.invoiceNumber, d.invoice.issueDate,
      d.invoice.buyerName, d.invoice.buyerTaxId, d.invoice.sellerName, d.invoice.sellerTaxId,
      d.invoice.amountExclTax, d.invoice.totalTax, d.invoice.amountInclTax, d.invoice.remark,
      JSON.stringify(d.sources), JSON.stringify([...warnings, ...warningsFromClient]),
      str(payload.parseStatus, 20) || 'manual', fundPurpose
    );
    const id = Number(r.lastInsertRowid);
    const ins = db.prepare(`INSERT INTO invoice_items
      (invoice_id, sort_order, name, spec, unit, quantity, unit_price, amount, tax_rate, tax_amount, field_sources)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    d.items.forEach((it, i) => ins.run(id, i, it.name, it.spec, it.unit, it.quantity, it.unitPrice, it.amount, it.taxRate, it.taxAmount, JSON.stringify(d.sources.items[i] || {})));
    if (fileId) db.prepare('UPDATE files SET bound = 1 WHERE id = ?').run(fileId);
    return getInvoice(id, user);
  })();
}

/**
 * 列表：学生强制 user_id = 自己；管理员可全量 + 多维筛选。
 * filters: q, from, to, minAmount, maxAmount, seller, status, page, size
 */
function listInvoices(user, filters = {}) {
  const db = getDb();
  const where = [], args = [];
  const isAdmin = user.role === 'admin';
  if (!isAdmin) { where.push('i.user_id = ?'); args.push(user.uid); }

  if (isAdmin && filters.studentId) { where.push('u.student_id = ?'); args.push(str(filters.studentId, 40)); }
  if (isAdmin && filters.name) { where.push('u.name LIKE ?'); args.push(`%${str(filters.name, 50)}%`); }
  const q = str(filters.q, 100);
  if (q) {
    where.push('(i.invoice_number LIKE ? OR i.seller_name LIKE ? OR i.buyer_name LIKE ? OR u.name LIKE ? OR u.student_id LIKE ?)');
    args.push(...Array(5).fill(`%${q}%`));
  }
  if (filters.from) { where.push('COALESCE(i.issue_date, substr(i.created_at,1,10)) >= ?'); args.push(str(filters.from, 20)); }
  if (filters.to) { where.push('COALESCE(i.issue_date, substr(i.created_at,1,10)) <= ?'); args.push(str(filters.to, 20)); }
  const min = numOrNull(filters.minAmount), max = numOrNull(filters.maxAmount);
  if (min !== null) { where.push('i.amount_incl_tax >= ?'); args.push(min); }
  if (max !== null) { where.push('i.amount_incl_tax <= ?'); args.push(max); }
  if (filters.seller) { where.push('i.seller_name LIKE ?'); args.push(`%${str(filters.seller, 100)}%`); }
  // 语义：0 = 未打印，1 = 已打印；前端主要传 'unprinted' / 'printed'
  const st = filters.status;
  if (st === 'printed' || st === 1 || st === '1') where.push('i.print_status = 1');
  if (st === 'unprinted' || st === 0 || st === '0') where.push('i.print_status = 0');

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM invoices i LEFT JOIN users u ON u.id = i.user_id ${clause}`).get(...args).c;
  const page = intIn(filters.page, 1, 1, 100000), size = intIn(filters.size, 20, 1, 100000);
  const sortColumns = {
    invoiceNumber: 'i.invoice_number', issueDate: 'i.issue_date', sellerName: 'i.seller_name',
    amountInclTax: 'i.amount_incl_tax', printStatus: 'i.print_status', locked: 'i.locked', createdAt: 'i.created_at'
  };
  const sortColumn = sortColumns[filters.sortBy] || 'i.created_at';
  const sortDirection = filters.sortOrder === 'ascending' ? 'ASC' : 'DESC';
  const rows = db.prepare(`${SELECT} ${clause} ORDER BY ${sortColumn} ${sortDirection}, i.id DESC LIMIT ? OFFSET ?`)
    .all(...args, size, (page - 1) * size);
  const withItems = !!filters.withItems;
  return {
    list: rows.map(toDto),
    items: withItems ? getItems(rows.map((r) => r.id)) : undefined,
    total, page, size
  };
}

function getRaw(id) {
  return getDb().prepare(`${SELECT} WHERE i.id = ?`).get(id);
}

function getInvoice(id, user) {
  const row = getRaw(id);
  if (!row) throw new ApiError(404, '发票不存在');
  if (user.role !== 'admin' && row.user_id !== user.uid) throw new ApiError(403, '无权访问该发票');
  const dto = toDto(row);
  dto.items = getItems([row.id])[row.id] || [];
  return dto;
}

/** 学生：只能改自己的、未打印、未锁定的发票；管理员不受限 */
function assertMutable(row, user) {
  if (user.role !== 'admin') {
    if (row.user_id !== user.uid) throw new ApiError(403, '无权操作该发票');
    if (row.print_status) throw new ApiError(403, '该发票已打印，禁止修改或删除');
    if (row.locked) throw new ApiError(403, '该发票已被管理员锁定，禁止修改或删除');
  }
}

function updateInvoice(id, user, payload) {
  const row = getRaw(id);
  if (!row) throw new ApiError(404, '发票不存在');
  assertMutable(row, user);
  const d = normalizeDraft(payload);
  if (!d.invoice.invoiceNumber) throw new ApiError(400, '发票号码为必填项');
  const fundPurpose = payload.fundPurpose === undefined ? row.fund_purpose :
    typeof payload.fundPurpose === 'string' ? str(payload.fundPurpose, 500) : null;
  validateSubmission(d.invoice, row.recognized_total ?? null, fundPurpose);
  const db = getDb();
  const dup = db.prepare('SELECT id FROM invoices WHERE invoice_number = ? AND id <> ?').get(d.invoice.invoiceNumber, id);
  if (dup) throw new ApiError(409, `发票号码 ${d.invoice.invoiceNumber} 与 ID ${dup.id} 重复`);
  const warnings = validateDraft(d.invoice, d.items);

  return transaction(() => {
    db.prepare(`UPDATE invoices SET
      invoice_number=?, issue_date=?, buyer_name=?, buyer_tax_id=?, seller_name=?, seller_tax_id=?,
      amount_excl_tax=?, total_tax=?, amount_incl_tax=?, remark=?, field_sources=?, warnings=?, fund_purpose=?,
      updated_at=datetime('now','localtime') WHERE id=?`).run(
      d.invoice.invoiceNumber, d.invoice.issueDate, d.invoice.buyerName, d.invoice.buyerTaxId,
      d.invoice.sellerName, d.invoice.sellerTaxId, d.invoice.amountExclTax, d.invoice.totalTax,
      d.invoice.amountInclTax, d.invoice.remark, JSON.stringify(d.sources), JSON.stringify(warnings), fundPurpose, id
    );
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(id);
    const ins = db.prepare(`INSERT INTO invoice_items
      (invoice_id, sort_order, name, spec, unit, quantity, unit_price, amount, tax_rate, tax_amount, field_sources)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    d.items.forEach((it, i) => ins.run(id, i, it.name, it.spec, it.unit, it.quantity, it.unitPrice, it.amount, it.taxRate, it.taxAmount, JSON.stringify(d.sources.items[i] || {})));
    return getInvoice(id, user);
  })();
}

function deleteInvoices(ids, user) {
  const db = getDb();
  return transaction(() => {
    const find = db.prepare('SELECT id, user_id, file_id, print_status, locked FROM invoices WHERE id = ?');
    const rows = ids.map((id) => {
      const row = find.get(id);
      if (!row) throw new ApiError(404, ids.length === 1 ? '发票不存在' : '部分发票已不存在，请刷新列表后重新选择');
      assertMutable(row, user);
      return row;
    });
    // 保留批次历史，移除已删除发票的关联。
    const unlinkBatch = db.prepare('DELETE FROM print_batch_items WHERE invoice_id = ?');
    const remove = db.prepare('DELETE FROM invoices WHERE id = ?');
    const unbindFile = db.prepare(`UPDATE files SET bound = 0 WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM invoices WHERE file_id = ?)`);
    for (const row of rows) {
      unlinkBatch.run(row.id);
      remove.run(row.id);
    }
    const fileIds = new Set(rows.map((row) => row.file_id).filter(Boolean));
    for (const fileId of fileIds) unbindFile.run(fileId, fileId);
    return { ids, deleted: rows.length };
  })();
}

function deleteInvoice(id, user) {
  deleteInvoices([id], user);
  return { id, deleted: true };
}

/** 学生统计：总数 / 价税合计总额 / 本月新增 / 按月金额（ECharts 折线） */
function stats(user) {
  const db = getDb();
  const scope = user.role === 'admin' ? '' : 'WHERE user_id = ?';
  const args = user.role === 'admin' ? [] : [user.uid];
  const base = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(amount_incl_tax),0) AS amount FROM invoices ${scope}`).get(...args);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = db.prepare(`SELECT COUNT(*) AS c FROM invoices ${scope ? scope + ' AND' : 'WHERE'} substr(created_at,1,7) = ?`).get(...args, month).c;
  const monthly = db.prepare(`SELECT COALESCE(substr(issue_date,1,7), substr(created_at,1,7)) AS m,
      COUNT(*) AS c, COALESCE(SUM(amount_incl_tax),0) AS amount
    FROM invoices ${scope} GROUP BY m ORDER BY m`).all(...args);
  return { total: base.total, totalAmount: Number(base.amount.toFixed(2)), thisMonth, monthly };
}

module.exports = { toDto, getItems, createInvoice, listInvoices, getInvoice, getRaw, updateInvoice, deleteInvoice, deleteInvoices, stats, assertMutable, SELECT };
