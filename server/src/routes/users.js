'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getDb, transaction } = require('../db');
const { ApiError, wrap } = require('../middleware/error');
const { writeLog } = require('../utils/log');

function userDto(row) {
  return {
    id: row.id, role: row.role, name: row.name, username: row.username, studentId: row.student_id,
    createdAt: row.created_at, lastLoginAt: row.last_login_at
  };
}

function findUser(id) {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(Number(id) || 0);
  if (!user) throw new ApiError(404, '用户不存在');
  return user;
}

function credentials(body, existing) {
  const role = existing?.role || body.role;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!['student', 'admin'].includes(role)) throw new ApiError(400, '请选择用户角色');
  if (role === 'student') {
    const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
    if (!/^[\u4e00-\u9fa5a-zA-Z·\s]{2,30}$/.test(name)) throw new ApiError(400, '姓名需为 2–30 个中文或字母');
    if (!/^\d{6,20}$/.test(studentId)) throw new ApiError(400, '学号需为 6–20 位数字');
    return { role, name, studentId, username: null, hash: null };
  }
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = body.password ?? '';
  if (!name || name.length > 30 || !username || username.length > 50) throw new ApiError(400, '请填写有效的管理员姓名和账号');
  if ((!existing || password !== '') && (typeof password !== 'string' || !password.trim() || Buffer.byteLength(password) > 72)) {
    throw new ApiError(400, '请填写有效密码，长度最多 72 字节');
  }
  return { role, name, studentId: null, username, hash: password ? bcrypt.hashSync(password, 10) : existing.password_hash };
}

function checkDuplicate(user, id = 0) {
  const field = user.role === 'student' ? 'student_id' : 'username';
  if (getDb().prepare(`SELECT id FROM users WHERE ${field} = ? AND id <> ? AND deleted_at IS NULL`).get(user.studentId || user.username, id)) {
    throw new ApiError(409, user.role === 'student' ? '该学号已存在' : '该管理员账号已存在');
  }
}

router.get('/', wrap(async (_req, res) => {
  res.json({ list: getDb().prepare('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY role, id').all().map(userDto) });
}));

router.post('/', wrap(async (req, res) => {
  const user = credentials(req.body || {});
  checkDuplicate(user);
  const result = getDb().prepare('INSERT INTO users (role, name, student_id, username, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(user.role, user.name, user.studentId, user.username, user.hash);
  const id = Number(result.lastInsertRowid);
  writeLog(req, { action: 'create_user', targetType: 'user', targetId: id });
  res.status(201).json(userDto(findUser(id)));
}));

router.put('/:id', wrap(async (req, res) => {
  const existing = findUser(req.params.id);
  const user = credentials(req.body || {}, existing);
  checkDuplicate(user, existing.id);
  const changed = user.name !== existing.name || user.studentId !== existing.student_id ||
    user.username !== existing.username || user.hash !== existing.password_hash;
  getDb().prepare(`UPDATE users SET name = ?, student_id = ?, username = ?, password_hash = ?,
    auth_version = auth_version + ? WHERE id = ?`)
    .run(user.name, user.studentId, user.username, user.hash, changed ? 1 : 0, existing.id);
  writeLog(req, { action: 'update_user', targetType: 'user', targetId: existing.id });
  res.json(userDto(findUser(existing.id)));
}));

router.delete('/:id', wrap(async (req, res) => {
  const user = findUser(req.params.id);
  if (user.id === req.user.uid) throw new ApiError(400, '不能删除当前登录的管理员');
  transaction(() => {
    getDb().prepare("UPDATE users SET deleted_at = datetime('now','localtime'), auth_version = auth_version + 1 WHERE id = ?").run(user.id);
    writeLog(req, { action: 'delete_user', targetType: 'user', targetId: user.id });
  })();
  res.status(204).end();
}));

module.exports = router;

