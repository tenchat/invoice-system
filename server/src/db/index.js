'use strict';
/**
 * 数据库适配层：统一 prepare/exec/transaction 接口。
 * 驱动 1（优先）：better-sqlite3 —— 性能最好，需要预编译二进制。
 * 驱动 2（回退）：Node >= 22.5 内置 node:sqlite —— 零原生依赖，Windows 无 VS 工具链也能跑。
 * 因此任一环境下 `npm install` 后系统都可直接启动。
 */
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const bcrypt = require('bcryptjs');

let instance = null;

// node:sqlite 不接受 undefined / boolean 绑定值，统一归一化
function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  return v;
}

function createConnection() {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

  try {
    const Database = require('better-sqlite3');
    const db = new Database(config.dbFile);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    console.log('[db] driver = better-sqlite3');
    return {
      driver: 'better-sqlite3',
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      transaction: (fn) => db.transaction(fn)
    };
  } catch (e) {
    console.warn('[db] better-sqlite3 不可用，回退 node:sqlite：', e.message.split('\n')[0]);
  }

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(config.dbFile);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  console.log('[db] driver = node:sqlite (内置)');
  return {
    driver: 'node:sqlite',
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const st = db.prepare(sql);
      return {
        get: (...a) => st.get(...a.map(norm)),
        all: (...a) => st.all(...a.map(norm)),
        run: (...a) => {
          const r = st.run(...a.map(norm));
          return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
        }
      };
    },
    transaction: (fn) => (...args) => {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (_e) { /* ignore */ }
        throw e;
      }
    }
  };
}

function getDb() {
  if (!instance) {
    const db = createConnection();
    db.exec(fs.readFileSync(config.schemaFile, 'utf8'));
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [table, column, type] of [
        ['invoices', 'fund_purpose', 'TEXT'],
        ['invoices', 'scan_status', 'INTEGER NOT NULL DEFAULT 0'],
        ['files', 'recognized_total', 'REAL'],
        ['users', 'deleted_at', 'TEXT'],
        ['users', 'auth_version', 'INTEGER NOT NULL DEFAULT 0']
      ]) {
        if (!db.prepare(`PRAGMA table_info(${table})`).all().some((field) => field.name === column)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        }
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_active_student_id ON users(student_id)
          WHERE student_id IS NOT NULL AND deleted_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_active_username ON users(username)
          WHERE username IS NOT NULL AND deleted_at IS NULL;
        DROP INDEX IF EXISTS uq_users_student_id;
        DROP INDEX IF EXISTS uq_users_username;
      `);
      const existingAdmin = db.prepare("SELECT id, password_hash FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
      if (!existingAdmin) {
        db.prepare("INSERT INTO users (role, name, username, password_hash) VALUES ('admin', ?, ?, ?)")
          .run(config.admin.displayName, config.admin.username, bcrypt.hashSync(config.admin.password, 10));
      } else if (!existingAdmin.password_hash) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .run(bcrypt.hashSync(config.admin.password, 10), existingAdmin.id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    instance = db;
  }
  return instance;
}
function transaction(fn) { return getDb().transaction(fn); }

module.exports = { getDb, transaction };

