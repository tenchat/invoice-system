'use strict';
const router = require('express').Router();
const { auth, requireAdmin } = require('../middleware/auth');
const { getDb } = require('../db');
const { ApiError, wrap } = require('../middleware/error');
const { writeLog } = require('../utils/log');

router.use(auth);
router.get('/', wrap(async (_req, res) => {
  const db = getDb();
  const limit = db.prepare('SELECT budget_limit FROM budget_settings WHERE id = 1').get()?.budget_limit ?? null;
  const users = db.prepare(`SELECT u.id, u.name, u.student_id,
    COALESCE(SUM(i.amount_incl_tax), 0) AS amount, COUNT(i.id) AS count
    FROM users u JOIN invoices i ON i.user_id = u.id
    GROUP BY u.id ORDER BY amount DESC, u.id`).all().map((row) => ({
    id: row.id, name: row.name, studentId: row.student_id,
    amount: Math.round(row.amount * 100) / 100, count: row.count
  }));
  const spent = Math.round(users.reduce((sum, user) => sum + user.amount, 0) * 100) / 100;
  res.json({ limit, spent, remaining: limit === null ? null : Math.round((limit - spent) * 100) / 100, users });
}));

router.put('/', requireAdmin, wrap(async (req, res) => {
  const limit = req.body?.limit;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0 || Math.round(limit * 100) / 100 !== limit) {
    throw new ApiError(400, '预算上限须为非负金额，最多两位小数');
  }
  getDb().prepare(`INSERT INTO budget_settings (id, budget_limit) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET budget_limit = excluded.budget_limit`).run(limit);
  writeLog(req, { action: 'set_budget', targetType: 'budget', detail: { limit } });
  res.json({ limit });
}));
module.exports = router;

