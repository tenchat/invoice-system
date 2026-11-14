'use strict';
/** 管理员接口：全量筛选分页、用户汇总、打印状态统计/批量标记、锁定、Excel 导出、操作日志。 */
const router = require('express').Router();
const { auth, requireAdmin } = require('../middleware/auth');
const { ApiError, wrap } = require('../middleware/error');
const { getDb } = require('../db');
const { intIn, str } = require('../utils/validate');
const { writeLog } = require('../utils/log');
const svc = require('../services/invoiceService');
const printSvc = require('../services/printService');
const { buildWorkbook } = require('../services/exportService');
const { setAmountPolicy } = require('../services/amountPolicy');

router.use(auth, requireAdmin);

router.get('/reimbursement-stats', wrap(async (req, res) => {
  const name = str(req.query.name, 50), studentId = str(req.query.studentId, 40);
  const from = str(req.query.from, 10), to = str(req.query.to, 10);
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) {
    throw new ApiError(400, '开票日期范围不合法');
  }
  const where = ['i.reimbursed = 1'], args = [];
  if (name) { where.push('u.name LIKE ?'); args.push(`%${name}%`); }
  if (studentId) { where.push('u.student_id LIKE ?'); args.push(`%${studentId}%`); }
  if (from) { where.push('i.issue_date >= ?'); args.push(from); }
  if (to) { where.push('i.issue_date <= ?'); args.push(to); }
  const rows = getDb().prepare(`SELECT u.id, u.name, u.student_id,
    COUNT(i.id) AS count, COALESCE(SUM(ROUND(i.amount_incl_tax * 100)), 0) AS cents,
    SUM(CASE WHEN i.amount_incl_tax IS NULL THEN 1 ELSE 0 END) AS missing_amount
    FROM invoices i JOIN users u ON u.id = i.user_id WHERE ${where.join(' AND ')}
    GROUP BY u.id ORDER BY cents DESC, u.id`).all(...args);
  const users = rows.map((row) => ({ id: row.id, name: row.name, studentId: row.student_id,
    count: row.count, amount: row.cents / 100, missingAmount: row.missing_amount }));
  res.json({ users, count: users.reduce((n, u) => n + u.count, 0),
    amount: rows.reduce((n, row) => n + row.cents, 0) / 100,
    missingAmount: users.reduce((n, u) => n + u.missingAmount, 0) });
}));

router.put('/amount-policy', wrap(async (req, res) => {
  const policy = setAmountPolicy(req.body || {});
  writeLog(req, { action: 'update_amount_policy', targetType: 'invoice_amount_policy', detail: policy });
  res.json(policy);
}));

router.get('/invoices', wrap(async (req, res) => {
  res.json(svc.listInvoices(req.user, {
    ...req.query,
    q: str(req.query.q, 100),
    name: str(req.query.name, 50),
    studentId: str(req.query.studentId, 40),
    seller: str(req.query.seller, 100),
    from: str(req.query.from, 20), to: str(req.query.to, 20),
    minAmount: req.query.minAmount, maxAmount: req.query.maxAmount,
    status: req.query.status,
    sortBy: str(req.query.sortBy, 50), sortOrder: req.query.sortOrder,
    page: intIn(req.query.page, 1, 1, 100000),
    size: intIn(req.query.size, 20, 1, 200),
    withItems: req.query.withItems === '1' || req.query.withItems === 'true'
  }));
}));

router.get('/invoices/export', wrap(async (req, res) => {
  const { buffer, count } = await buildWorkbook(req.user, { ...req.query, status: req.query.status });
  writeLog(req, { action: 'export_excel', targetType: 'invoice', detail: { count, filters: req.query } });
  const fname = `发票汇总_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
  res.send(Buffer.from(buffer));
}));

/** 用户汇总：每人发票数量、金额、未打印数 */
router.get('/users/summary', wrap(async (req, res) => {
  const rows = getDb().prepare(`
    SELECT u.id, u.name, u.student_id, u.created_at,
      COUNT(i.id) AS count,
      COALESCE(SUM(i.amount_incl_tax), 0) AS total_amount,
      SUM(CASE WHEN i.print_status = 0 THEN 1 ELSE 0 END) AS unprinted,
      SUM(CASE WHEN i.print_status = 1 THEN 1 ELSE 0 END) AS printed,
      MAX(i.created_at) AS last_at
    FROM users u LEFT JOIN invoices i ON i.user_id = u.id
    WHERE u.role = 'student'
    GROUP BY u.id ORDER BY total_amount DESC, u.id
  `).all();
  res.json({
    list: rows.map((r) => ({
      id: r.id, name: r.name, studentId: r.student_id, count: r.count,
      totalAmount: Number((r.total_amount || 0).toFixed(2)),
      unprinted: r.unprinted || 0, printed: r.printed || 0,
      lastAt: r.last_at, createdAt: r.created_at
    })),
    total: rows.length
  });
}));

router.get('/print-status-summary', wrap(async (_req, res) => {
  res.json(printSvc.printStatusSummary());
}));

router.put('/invoices/:id/scan', wrap(async (req, res) => {
  if (typeof req.body?.scanned !== 'boolean') throw new ApiError(400, '扫描状态不合法');
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(400, '发票不存在');
  const updated = getDb().prepare('UPDATE invoices SET scan_status = ? WHERE id = ?')
    .run(req.body.scanned ? 1 : 0, id);
  if (!updated.changes) throw new ApiError(404, '发票不存在');
  writeLog(req, { action: 'set_scan_status', targetType: 'invoice', targetId: id, detail: { scanned: req.body.scanned } });
  res.json({ id, scanned: req.body.scanned });
}));

router.put('/invoices/:id/reimbursement', wrap(async (req, res) => {
  if (typeof req.body?.reimbursed !== 'boolean') throw new ApiError(400, '报销状态不合法');
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(400, '发票不存在');
  res.json(printSvc.setReimbursed([id], req.body.reimbursed, req));
}));

router.post('/invoices/reimbursement', wrap(async (req, res) => {
  if (req.body?.confirm !== true) throw new ApiError(400, '批量标记报销需要二次确认');
  res.json(printSvc.setReimbursed(req.body?.ids, req.body?.reimbursed, req));
}));

/** 批量标记打印状态：必须 confirm:true（服务端二次确认） */
router.post('/invoices/print-status', wrap(async (req, res) => {
  const r = printSvc.markStatus(req.body?.ids, !!req.body?.status, req);
  res.json(r);
}));

router.post('/invoices/lock', wrap(async (req, res) => {
  const r = printSvc.setLocked(req.body?.ids, !!req.body?.locked, req);
  writeLog(req, { action: req.body?.locked ? 'lock' : 'unlock', targetType: 'invoice', detail: { ids: r.ids || req.body?.ids } });
  res.json(r);
}));

router.post('/invoices/batch-delete', wrap(async (req, res) => {
  const { ids, confirm } = req.body || {};
  if (confirm !== true) throw new ApiError(400, '删除发票需要二次确认');
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new ApiError(400, '请选择有效的发票');
  }
  const result = svc.deleteInvoices([...new Set(ids)], req.user);
  writeLog(req, { action: 'batch_delete_invoices', targetType: 'invoice', detail: result });
  res.json(result);
}));

router.get('/logs', wrap(async (req, res) => {
  const limit = intIn(req.query.limit, 200, 1, 1000);
  const rows = getDb().prepare('SELECT * FROM operation_logs ORDER BY id DESC LIMIT ?').all(limit);
  res.json({
    list: rows.map((r) => ({
      id: r.id, actorName: r.actor_name, actorRole: r.actor_role, action: r.action,
      targetType: r.target_type, targetId: r.target_id,
      detail: (() => { try { return JSON.parse(r.detail || 'null'); } catch (_e) { return r.detail; } })(),
      ip: r.ip, createdAt: r.created_at
    }))
  });
}));

router.use('/users', require('./users'));

module.exports = router;
