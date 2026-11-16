'use strict';
/** 操作日志：所有打印状态变更、批次、删除、锁定都落库可追溯 */
const { getDb } = require('../db');

function writeLog(req, { action, targetType = null, targetId = null, detail = null }) {
  const u = req?.user || {};
  try {
    getDb().prepare(`
      INSERT INTO operation_logs (actor_id, actor_name, actor_role, action, target_type, target_id, detail, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      u.uid || null,
      u.name || 'system',
      u.role || 'system',
      action,
      targetType,
      targetId === null ? null : String(targetId),
      detail === null ? null : JSON.stringify(detail),
      (req?.ip || '').slice(0, 64)
    );
  } catch (e) {
    console.error('[LOG] 写入失败', e.message);
  }
}

module.exports = { writeLog };
