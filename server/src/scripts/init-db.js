'use strict';
/** 数据库初始化：幂等，可重复执行。npm run init-db */
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { getDb } = require('../db');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });
fs.mkdirSync(config.previewDir, { recursive: true });

const db = getDb();
db.exec(fs.readFileSync(config.schemaFile, 'utf8'));
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
console.log('✅ 数据库初始化完成:', config.dbFile);
console.log('   表:', tables.join(', '));
