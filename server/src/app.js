'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('../config');
const { getDb } = require('./db');
const { errorHandler, notFound, ApiError } = require('./middleware/error');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors({ origin: config.corsOrigin, exposedHeaders: ['Content-Disposition'] }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

// uploads 目录不做静态暴露：原件/预览图统一经 /api/files/:id 做权限校验后输出
app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'digital-invoice-system', time: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/budget', require('./routes/budget'));
app.use('/api/admin/print', require('./routes/print'));   // 必须放在 /api/admin 之前
app.use('/api/admin', require('./routes/admin'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/files', require('./routes/files'));

// 生产模式：前端 build 后由 Express 一并托管。
// 这里在「请求时」判断 dist/index.html 是否存在，因此先启动后端再执行 npm run build 也无需重启服务。
const dist = path.resolve(__dirname, '../../web/dist');
app.use(express.static(dist, { index: false }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next(new ApiError(404, '接口不存在'));
  const indexHtml = path.join(dist, 'index.html');
  if (!fs.existsSync(indexHtml)) return res.status(404).send('前端尚未构建：请执行 npm run build，或使用 Vite 开发服务器 http://localhost:5173');
  res.sendFile(indexHtml);
});

app.use(notFound);
app.use(errorHandler);

getDb();
app.listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port}  (health: /api/health)`);
});

module.exports = app;

