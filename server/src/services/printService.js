'use strict';
/** 打印状态 + 打印批次：批量标记、批次生成/重新打印/撤销，全部写操作日志。 */
const { getDb, transaction } = require('../db');
const { ApiError } = require('../middleware/error');
const { writeLog } = require('../utils/log');
const { toDto, getItems, SELECT } = require('./invoiceService');
const { originalPageCount } = require('./printDocument');

function idsOf(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, '请先勾选发票');
  const uniq = [...new Set(ids.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];
  if (!uniq.length || uniq.length > 500) throw new ApiError(400, '发票 ID 列表不合法');
  return uniq;
}

function printStatusSummary() {
  const r = getDb().prepare(`SELECT
    SUM(CASE WHEN print_status = 0 THEN 1 ELSE 0 END) AS unprinted,
    SUM(CASE WHEN print_status = 1 THEN 1 ELSE 0 END) AS printed,
    COUNT(*) AS total FROM invoices`).get();
  return { unprinted: r.unprinted || 0, printed: r.printed || 0, total: r.total || 0 };
}

/** 批量标记（二次确认由 confirm:true 在服务端强制） */
function markStatus(ids, status, req) {
  if (req.body?.confirm !== true) throw new ApiError(400, '该操作需要二次确认');
  const list = idsOf(ids);
  const next = status ? 1 : 0;
  const db = getDb();
  return transaction(() => {
    const ph = list.map(() => '?').join(',');
    const r = db.prepare(`UPDATE invoices SET print_status = ?,
      printed_at = CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END,
      print_batch_id = NULL, updated_at = datetime('now','localtime') WHERE id IN (${ph})`)
      .run(next, next, ...list);
    writeLog(req, {
      action: next ? 'mark_printed' : 'mark_unprinted',
      targetType: 'invoice', targetId: list.join(','), detail: { ids: list, status: next }
    });
    return { updated: r.changes, ids: list, printStatus: !!next };
  })();
}

/** 批量锁定/解锁（学生端未被锁定前才能改） */
function setLocked(ids, locked, req) {
  const list = idsOf(ids);
  const db = getDb();
  return transaction(() => {
    const ph = list.map(() => '?').join(',');
    const r = db.prepare(`UPDATE invoices SET locked = ?, updated_at = datetime('now','localtime') WHERE id IN (${ph})`).run(locked ? 1 : 0, ...list);
    writeLog(req, { action: locked ? 'lock' : 'unlock', targetType: 'invoice', targetId: list.join(','), detail: { ids: list, locked: !!locked } });
    return { updated: r.changes };
  })();
}

/** Mark one or more invoices as reimbursed; caller must be an administrator. */
function setReimbursed(ids, reimbursed, req, batchId = null) {
  if (typeof reimbursed !== 'boolean') throw new ApiError(400, '报销状态不合法');
  const list = idsOf(ids);
  const db = getDb();
  return transaction(() => {
    const ph = list.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id FROM invoices WHERE id IN (${ph})`).all(...list);
    if (rows.length !== list.length) throw new ApiError(404, '部分发票已不存在，请刷新后重试');
    const r = db.prepare(`UPDATE invoices SET reimbursed = ?, updated_at = datetime('now','localtime')
      WHERE id IN (${ph}) AND reimbursed <> ?`).run(reimbursed ? 1 : 0, ...list, reimbursed ? 1 : 0);
    writeLog(req, {
      action: reimbursed ? 'mark_reimbursed' : 'unmark_reimbursed',
      targetType: batchId === null ? 'invoice' : 'print_batch',
      targetId: batchId === null ? list.join(',') : batchId,
      detail: { ids: list, reimbursed, ...(batchId === null ? {} : { batchId }) }
    });
    return { updated: r.changes, ids: list, reimbursed };
  })();
}

function setBatchReimbursed(id, reimbursed, req) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(400, '打印批次不存在');
  const batch = getBatch(id);
  if (batch.undone) throw new ApiError(400, '已撤销的打印批次不能批量标记报销');
  const ids = getDb().prepare(`SELECT i.id FROM invoices i
    JOIN print_batch_items bi ON bi.invoice_id = i.id WHERE bi.batch_id = ? ORDER BY i.id`).all(id).map((row) => row.id);
  if (!ids.length) throw new ApiError(400, '该批次没有可标记的发票');
  return setReimbursed(ids, reimbursed, req, id);
}

/** 打印/导出后生成批次；markPrinted=true 时同时把所选发票标记为已打印 */
function createBatch({ ids, layout = {}, action = 'print', markPrinted = false, req }) {
  const list = idsOf(ids);
  const db = getDb();
  const u = req.user || {};
  const savedLayout = { ...layout, ids: list };
  return transaction(() => {
    const r = db.prepare(`INSERT INTO print_batches (operator_id, operator_name, count, layout, action)
      VALUES (?, ?, ?, ?, ?)`).run(u.uid || 0, u.name || 'system', list.length, JSON.stringify(savedLayout), action);
    const batchId = Number(r.lastInsertRowid);
    const sel = db.prepare('SELECT id, print_status FROM invoices WHERE id = ?');
    const ins = db.prepare('INSERT OR IGNORE INTO print_batch_items (batch_id, invoice_id, prev_print_status) VALUES (?, ?, ?)');
    for (const id of list) {
      const row = sel.get(id);
      if (!row) throw new ApiError(404, `发票 ${id} 不存在`);
      ins.run(batchId, id, row.print_status);
    }
    if (markPrinted) {
      const ph = list.map(() => '?').join(',');
      db.prepare(`UPDATE invoices SET print_status = 1, print_batch_id = ?, printed_at = datetime('now','localtime'),
        updated_at = datetime('now','localtime') WHERE id IN (${ph})`).run(batchId, ...list);
    }
    writeLog(req, { action: 'create_print_batch', targetType: 'print_batch', targetId: batchId, detail: { batchId, ids: list, action, markPrinted, layout: savedLayout } });
    if (markPrinted) writeLog(req, { action: 'batch_mark_printed', targetType: 'invoice', targetId: list.join(','), detail: { batchId, ids: list } });
    return getBatch(batchId);
  })();
}

function batchDto(row) {
  let layout = {};
  try { layout = JSON.parse(row.layout || '{}'); } catch (_e) { /* ignore */ }
  return {
    id: row.id, operatorName: row.operator_name, count: row.count,
    invoiceCount: row.invoice_count ?? null, reimbursedCount: row.reimbursed_count ?? 0,
    action: row.action, undone: !!row.undone,
    createdAt: row.created_at, undoneAt: row.undone_at,
    layout,
    layoutText: `${layout.perPage || 2} 张/页 · ${layout.orientation === 'landscape' ? '横向' : '纵向'}`
  };
}

function listBatches() {
  return getDb().prepare(`SELECT pb.*, COUNT(i.id) AS invoice_count,
      COALESCE(SUM(CASE WHEN i.reimbursed = 1 THEN 1 ELSE 0 END), 0) AS reimbursed_count
    FROM print_batches pb
    LEFT JOIN print_batch_items bi ON bi.batch_id = pb.id
    LEFT JOIN invoices i ON i.id = bi.invoice_id
    GROUP BY pb.id ORDER BY pb.id DESC`).all().map(batchDto);
}

function getBatch(id) {
  const row = getDb().prepare('SELECT * FROM print_batches WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, '打印批次不存在');
  return batchDto(row);
}

function getBatchInvoices(id) {
  const batch = getBatch(id);
  const rows = getDb().prepare(`${SELECT}
    JOIN print_batch_items bi ON bi.invoice_id = i.id
    WHERE bi.batch_id = ? ORDER BY i.id`).all(id);
  const items = getItems(rows.map((r) => r.id));
  const positions = new Map((batch.layout.ids || []).map((invoiceId, index) => [invoiceId, index]));
  rows.sort((a, b) => (positions.get(a.id) ?? rows.length) - (positions.get(b.id) ?? rows.length));
  return rows.map((r) => ({ ...toDto(r, true), items: items[r.id] || [] }));
}

/** 撤销批次：该批发票恢复到此前的打印状态（通常恢复为未打印） */
function undoBatch(id, req) {
  const batch = getBatch(id);
  if (batch.undone) throw new ApiError(400, '该批次已撤销，不能重复操作');
  const db = getDb();
  return transaction(() => {
    const rows = db.prepare('SELECT invoice_id, prev_print_status FROM print_batch_items WHERE batch_id = ?').all(id);
    const upd = db.prepare(`UPDATE invoices SET print_status = ?, print_batch_id = NULL, printed_at = NULL,
      updated_at = datetime('now','localtime') WHERE id = ? AND print_batch_id = ?`);
    let restored = 0;
    for (const r of rows) restored += upd.run(r.prev_print_status, r.invoice_id, id).changes;
    db.prepare("UPDATE print_batches SET undone = 1, undone_at = datetime('now','localtime') WHERE id = ?").run(id);
    writeLog(req, { action: 'undo_print_batch', targetType: 'print_batch', targetId: id, detail: { batchId: id, restored, count: batch.count } });
    return { id, undone: true, restored };
  })();
}

/** 拼版预览/打印所需数据（含预览图访问路径、姓名学号、版式参数） */
function printRows(ids, sortBy = 'manual', order = 'asc') {
  const list = idsOf(ids);
  const ph = list.map(() => '?').join(',');
  const rows = getDb().prepare(`${SELECT} WHERE i.id IN (${ph})`).all(...list);
  if (rows.length !== list.length) throw new ApiError(404, '部分发票已删除，请重新选择');
  const sortKeys = {
    uploadedAt: (r) => r.created_at || '',
    issueDate: (r) => r.issue_date || '',
    amount: (r) => Number(r.amount_incl_tax || 0),
    studentId: (r) => r.student_id || ''
  };
  const key = sortKeys[sortBy] || sortKeys.uploadedAt;
  const positions = new Map(list.map((id, index) => [id, index]));
  rows.sort((a, b) => {
    if (sortBy === 'manual') return positions.get(a.id) - positions.get(b.id);
    const x = key(a), y = key(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return (order === 'desc' ? -c : c) || positions.get(a.id) - positions.get(b.id);
  });
  return rows;
}

async function previewData(ids, sortBy = 'uploadedAt', order = 'asc') {
  const list = [];
  for (const row of printRows(ids, sortBy, order)) {
    try {
      list.push({ ...toDto(row), pageCount: await originalPageCount(row), printError: null });
    } catch (error) {
      if (!error.status) throw error;
      list.push({ ...toDto(row), pageCount: 0, printError: error.message });
    }
  }
  return list;
}

module.exports = { printStatusSummary, markStatus, setLocked, setReimbursed, setBatchReimbursed, createBatch, listBatches, getBatch, getBatchInvoices, undoBatch, previewData, printRows, idsOf };
