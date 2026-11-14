'use strict';
/**
 * 文件：上传 + 解析（一次多文件）、原件查看、预览图输出。
 * 所有文件经文件头校验后以随机名落盘，且访问必须过权限校验（uploads 目录不静态暴露）。
 */
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../../config');
const { getDb, transaction } = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError, wrap } = require('../middleware/error');
const { assertFile, safeResolve } = require('../utils/fileGuard');
const { parseFile } = require('../parse');
const { renderPdfToPng } = require('../parse/raster');
const { writeLog } = require('../utils/log');
const { getAmountPolicy, assertWithinLimit } = require('../services/amountPolicy');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxFileSize, files: config.upload.maxFilesPerRequest }
});
const parseUpload = (req, res, next) => upload.array('files', config.upload.maxFilesPerRequest)(req, res, (err) => {
  if (err) return next(new ApiError(400, `上传失败：${err.message}`));
  next();
});

/** <img src> 无法带 Authorization 头，仅对文件读取接口允许 ?token= */
function allowQueryToken(req, _res, next) {
  if (!req.headers.authorization && req.query.token) req.headers.authorization = `Bearer ${String(req.query.token)}`;
  next();
}

const MIME = { pdf: 'application/pdf', xml: 'application/xml', jpg: 'image/jpeg', png: 'image/png' };

/** multer/busboy 默认用 latin1 解析 filename，中文名会变成 mojibake，这里还原为 UTF-8 */
function decodeFilename(name) {
  const raw = String(name || '');
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw;                 // 已是中文，无需转换
  const fixed = Buffer.from(raw, 'latin1').toString('utf8');
  return fixed.includes('\uFFFD') ? raw : fixed;                // 非法 UTF-8 时保留原值
}

function assertCanRead(file, user) {
  if (!file) throw new ApiError(404, '文件不存在');
  if (user.role !== 'admin' && file.uploaded_by !== user.uid) throw new ApiError(403, '无权访问该文件');
}

/**
 * POST /api/files/parse  multipart(files)
 * 返回每个文件一份「可编辑草稿」；单文件解析失败只在该文件上返回 error，不影响其余文件。
 */
router.post('/parse', auth, parseUpload, wrap(async (req, res) => {
  if (!req.files?.length) throw new ApiError(400, '未收到文件');
  const db = getDb();
  const results = [];

  for (const f of req.files) {
    const fileName = decodeFilename(path.basename(String(f.originalname || ''))).slice(0, 200);
    try {
      const guard = assertFile({ buffer: f.buffer, originalName: fileName, mimetype: f.mimetype });
      const draft = await parseFile({ buffer: f.buffer, detectedType: guard.detectedType, originalName: fileName });
      const recognizedTotal = draft.invoice.amountInclTax ?? null;
      assertWithinLimit(recognizedTotal, getAmountPolicy());
      const previewBuffer = draft._previewBuffer;
      delete draft._previewBuffer;

      const monthDir = new Date().toISOString().slice(0, 7).replace('-', '');
      const storedName = `${crypto.randomBytes(16).toString('hex')}.${guard.detectedType}`;
      const relPath = path.join(monthDir, storedName);
      const fullPath = path.join(config.uploadsDir, relPath);
      const storedRel = relPath.replace(/\\/g, '/');
      const previewRel = previewBuffer ? path.posix.join('_previews', `${storedName}.png`) :
        ['jpg', 'png'].includes(guard.detectedType) ? storedRel : null;
      const writtenPaths = [];
      const write = (target, bytes) => {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const fd = fs.openSync(target, 'wx');
        writtenPaths.push(target);
        try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
      };
      let fileId;
      try {
        fileId = transaction(() => {
          write(fullPath, f.buffer);
          if (previewBuffer) write(path.join(config.uploadsDir, previewRel), previewBuffer);
          const info = db.prepare(`INSERT INTO files
            (original_name, stored_name, rel_path, mime, detected_type, size, sha256, uploaded_by, recognized_total, preview_rel_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            fileName, storedName, storedRel, MIME[guard.detectedType], guard.detectedType, f.size,
            crypto.createHash('sha256').update(f.buffer).digest('hex'), req.user.uid, recognizedTotal, previewRel
          );
          return Number(info.lastInsertRowid);
        })();
      } catch (error) {
        for (const target of writtenPaths) fs.rmSync(target, { force: true });
        throw error;
      }

      const warnings = [...draft.warnings];
      if (guard.warning) warnings.unshift({ level: 'warn', type: 'filetype', message: guard.warning });
      results.push({
        fileId, fileName, size: f.size, detectedType: guard.detectedType, recognizedTotal,
        previewUrl: previewRel ? `/api/files/${fileId}/preview` : null,
        ...draft, warnings
      });
    } catch (e) {
      if (e.details?.reason === 'invoice_amount_limit') {
        results.push({ fileName, fileId: null, blocked: true, error: e.message });
        continue;
      }
      // 降级：识别失败仍返回一份空草稿，前端可手动录入，不阻塞流程
      results.push({
        fileId: null, fileName, error: e.message,
        detectedType: null, parseStatus: 'failed',
        invoice: {}, items: [], sources: { invoice: {}, items: [] },
        qr: null, qrMismatch: [], warnings: [{ level: 'warn', type: 'parse', message: e.message }], errors: [e.message],
        meta: { layers: [], extractableFields: 0, itemCount: 0 }
      });
    }
  }
  writeLog(req, { action: 'upload_parse', targetType: 'file', detail: { count: results.length, names: results.map((r) => r.fileName) } });
  res.json({ results });
}));

/**
 * POST /api/files/:id/reparse
 * 用最新解析规则重新识别已上传的原件（不重复存文件、不新增 files 记录）。
 * 用于解析器升级后修正草稿，避免用户为一张票重新走一遍上传流程。
 */
/** 重解析核心逻辑（独立函数，便于单元测试与复用） */
async function reparseFileRecord(f) {
  const full = safeResolve(f.rel_path);
  if (!full || !fs.existsSync(full)) throw new ApiError(404, '原件文件已丢失，请重新上传');

  const draft = await parseFile({ buffer: fs.readFileSync(full), detectedType: f.detected_type, originalName: f.original_name });
  const previewBuffer = draft._previewBuffer;
  delete draft._previewBuffer;
  const recognizedTotal = draft.invoice.amountInclTax ?? f.recognized_total ?? null;

  let previewRel = f.preview_rel_path;
  if (previewBuffer) {
    fs.mkdirSync(config.previewDir, { recursive: true });
    previewRel = path.posix.join('_previews', `${f.id}.png`);
    fs.writeFileSync(path.join(config.uploadsDir, previewRel), previewBuffer);
  }
  getDb().prepare('UPDATE files SET preview_rel_path = ?, recognized_total = ? WHERE id = ?')
    .run(previewRel, recognizedTotal, f.id);
  return {
    fileId: f.id, fileName: f.original_name, size: f.size, detectedType: f.detected_type, recognizedTotal,
    previewUrl: previewRel ? `/api/files/${f.id}/preview` : null,
    ...draft
  };
}

router.post('/:id/reparse', auth, wrap(async (req, res) => {
  const f = getDb().prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id) || 0);
  assertCanRead(f, req.user);
  const result = await reparseFileRecord(f);
  writeLog(req, { action: 'reparse_file', targetType: 'file', targetId: f.id, detail: { fileName: f.original_name } });
  res.json(result);
}));

/** 原件（inline 查看 / 下载） */
router.get('/:id/raw', allowQueryToken, auth, wrap(async (req, res) => {
  const f = getDb().prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id) || 0);
  assertCanRead(f, req.user);
  const full = safeResolve(f.rel_path);
  if (!full || !fs.existsSync(full)) throw new ApiError(404, '原件文件已丢失');
  res.setHeader('Content-Type', MIME[f.detected_type] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  res.sendFile(full);
}));

/** 版式预览：PDF 从原件渲染，其余格式保留既有查看入口。 */
router.get('/:id/preview', allowQueryToken, auth, wrap(async (req, res) => {
  const f = getDb().prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id) || 0);
  assertCanRead(f, req.user);
  if (f.detected_type === 'pdf') {
    const pageNumber = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new ApiError(400, 'PDF 页码不合法');
    const rawPath = safeResolve(f.rel_path);
    if (!rawPath || !fs.existsSync(rawPath)) throw new ApiError(404, '原件文件已丢失');
    const page = await renderPdfToPng(fs.readFileSync(rawPath), 1.4, pageNumber);
    if (!page) throw new ApiError(422, '无法预览原件 PDF 页面');
    res.type('png').set('Cache-Control', 'private, no-store').send(page.png);
    return;
  }
  if (!f.preview_rel_path) throw new ApiError(404, '该文件没有版式预览图');
  const full = safeResolve(f.preview_rel_path);
  if (!full || !fs.existsSync(full)) throw new ApiError(404, '预览图不存在');
  res.setHeader('Content-Type', f.preview_rel_path.endsWith('.png') ? 'image/png' : (MIME[f.detected_type] || 'image/png'));
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.sendFile(full);
}));

module.exports = router;
module.exports.reparseFileRecord = reparseFileRecord;
module.exports.decodeFilename = decodeFilename;
