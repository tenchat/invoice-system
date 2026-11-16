'use strict';
/** JWT 会话 + 角色校验。学生只能访问自己的数据（在 service 层用 userId 强约束，双保险）。 */
const jwt = require('jsonwebtoken');
const config = require('../../config');
const { ApiError } = require('./error');
const { getDb } = require('../db');

function signToken(user) {
  return jwt.sign(
    { uid: user.id, role: user.role, name: user.name, studentId: user.student_id || null, version: user.auth_version },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn, issuer: 'digital-invoice-system' }
  );
}

/** 解析 Bearer Token；失败抛 401 */
function auth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new Error('missing');
    const session = jwt.verify(token, config.jwt.secret, { issuer: 'digital-invoice-system' });
    const user = getDb().prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(session.uid);
    if (!user || user.auth_version !== session.version || user.role !== session.role) throw new Error('revoked');
    req.user = { uid: user.id, role: user.role, name: user.name, studentId: user.student_id };
    next();
  } catch (_e) {
    next(new ApiError(401, '登录已失效，请重新登录'));
  }
}

function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user || req.user.role !== role) return next(new ApiError(403, '无权限访问该资源'));
    next();
  };
}

const requireStudent = requireRole('student');
const requireAdmin = requireRole('admin');

module.exports = { signToken, auth, requireRole, requireStudent, requireAdmin };
