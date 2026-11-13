'use strict';
/**
 * 全局配置。admin 用于数据库首次初始化或补齐历史管理员的密码哈希。
 */
const path = require('path');

const SERVER_ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(SERVER_ROOT, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(SERVER_ROOT, 'uploads');

module.exports = {
  port: Number(process.env.PORT || 3001),
  serverRoot: SERVER_ROOT,

  jwt: {
    secret: process.env.JWT_SECRET || 'CHANGE-ME-in-production-invoice-2026',
    expiresIn: '12h'
  },

  // 初始管理员凭据。初始化后由用户管理维护。
  admin: {
    username: 'admin',
    password: 'Admin@123456',
    displayName: '系统管理员'
  },

  dbFile: path.join(DATA_DIR, 'invoice.db'),
  schemaFile: path.join(SERVER_ROOT, 'src', 'db', 'schema.sql'),
  uploadsDir: UPLOADS_DIR,
  previewDir: path.join(UPLOADS_DIR, '_previews'),

  upload: {
    maxFileSize: 10 * 1024 * 1024,   // 单文件 10MB
    maxFilesPerRequest: 10,           // 一次最多 10 个文件
    allowedTypes: ['xml', 'pdf', 'jpg', 'png'],
    allowedMime: [
      'text/xml', 'application/xml', 'application/pdf',
      'image/jpeg', 'image/png', 'application/octet-stream'
    ]
  },

  ocr: {
    enabled: process.env.INVOICE_OCR !== '0',
    python: process.env.INVOICE_OCR_PYTHON || path.join(
      SERVER_ROOT, '.venv-ocr', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
    )
  },

  // PDF 渲染成识别用预览图的倍率。
  pdf: { renderScale: 2.6 },

  corsOrigin: process.env.CORS_ORIGIN || true
};

