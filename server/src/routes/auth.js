'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { signToken, auth } = require('../middleware/auth');
const { ApiError, wrap } = require('../middleware/error');
const { writeLog } = require('../utils/log');

/** 学生：姓名和学号须匹配已登记的有效用户。 */
router.post('/student/login', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const studentId = String(req.body?.studentId || '').trim();
  if (!/^[\u4e00-\u9fa5a-zA-Z·\s]{2,30}$/.test(name)) throw new ApiError(400, '姓名需为 2-30 个中文或字母');
  if (!/^\d{6,20}$/.test(studentId)) throw new ApiError(400, '学号需为 6-20 位数字');

  const db = getDb();
  const u = db.prepare("SELECT * FROM users WHERE role='student' AND student_id = ? AND deleted_at IS NULL").get(studentId);
  if (!u || u.name !== name) throw new ApiError(401, '姓名或学号未匹配，请联系管理员核对');
  db.prepare("UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?").run(u.id);
  req.user = { uid: u.id, role: 'student', name: u.name, studentId };
  writeLog(req, { action: 'student_login', targetType: 'user', targetId: u.id });

  res.json({ token: signToken(u), user: { id: u.id, role: 'student', name: u.name, studentId } });
}));

/** 管理员：使用数据库中的账号和密码哈希。 */
router.post('/admin/login', wrap(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) throw new ApiError(400, '请输入账号和密码');
  const db = getDb();
  const u = db.prepare("SELECT * FROM users WHERE role='admin' AND username = ? AND deleted_at IS NULL").get(username);
  if (!u?.password_hash || Buffer.byteLength(password) > 72 || !bcrypt.compareSync(password, u.password_hash)) {
    throw new ApiError(401, '管理员账号或密码错误');
  }
  db.prepare("UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?").run(u.id);
  req.user = { uid: u.id, role: 'admin', name: u.name };
  writeLog(req, { action: 'admin_login', targetType: 'user', targetId: u.id });

  res.json({ token: signToken(u), user: { id: u.id, role: 'admin', name: u.name, username } });
}));

router.get('/me', auth, (req, res) => {
  const u = getDb().prepare('SELECT id, role, name, student_id, username, created_at, last_login_at FROM users WHERE id = ?').get(req.user.uid);
  if (!u) throw new ApiError(401, '用户不存在');
  res.json({ id: u.id, role: u.role, name: u.name, studentId: u.student_id, username: u.username, createdAt: u.created_at, lastLoginAt: u.last_login_at });
});

module.exports = router;

