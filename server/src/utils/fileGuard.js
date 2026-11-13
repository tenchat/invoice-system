'use strict';
/**
 * 文件真实性校验：一律以「文件头 magic number」判定真实类型，扩展名/Content-Type 仅作参考。
 * 这样即便把 EXE 改名为 .pdf，也不会被当成 PDF 交给解析器或返回给浏览器。
 */
const { XMLValidator } = require('fast-xml-parser');
const config = require('../../config');

const ApiError = require('../middleware/error').ApiError;

function isXmlText(buf) {
  if (buf.length < 5) return false;
  const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('utf8');
  if (head.includes('\uFFFD')) return false;               // 非法 UTF-8，不是文本
  const t = head.replace(/^\uFEFF/, '').trimStart();
  if (!/^<\?xml|^</i.test(t)) return false;
  return XMLValidator.validate(head.length >= buf.length ? head : buf.toString('utf8')) === true;
}

/** 返回真实类型 xml | pdf | png | jpg | null */
function detectByMagic(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (isXmlText(buf)) return 'xml';
  return null;
}

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : '';
}

/**
 * @returns {{detectedType:string, ext:string, warning?:string}}
 * @throws ApiError 400 当大小/扩展名/真实类型不合法
 */
function assertFile({ buffer, originalName, mimetype }) {
  if (!buffer || buffer.length === 0) throw new ApiError(400, '空文件');
  if (buffer.length > config.upload.maxFileSize) throw new ApiError(400, `${originalName} 超过 10MB 限制`);

  const ext = extOf(originalName);
  if (!config.upload.allowedTypes.includes(ext)) {
    throw new ApiError(400, `不支持的扩展名 .${ext || '?'}（仅支持 XML/PDF/JPG/PNG）`);
  }

  // 目录穿越 / 控制字符：存盘时另用随机名，这里也直接拒绝异常文件名
  if (/[\\/\x00-\x1f]/.test(pathBasename(originalName))) {
    throw new ApiError(400, '文件名包含非法字符');
  }

  const detectedType = detectByMagic(buffer);
  if (!detectedType) throw new ApiError(400, `${originalName} 文件头无法识别（可能为伪造文件）`);
  if (!config.upload.allowedTypes.includes(detectedType)) {
    throw new ApiError(400, `${originalName} 真实类型不被允许`);
  }

  let warning;
  if (detectedType !== ext) {
    // 不按扩展名处理，仅提示；后续解析/渲染全部按 detectedType 走
    warning = `文件声明为 .${ext}，实际文件头为 ${detectedType.toUpperCase()}，已按真实类型处理`;
  }
  return { detectedType, ext, warning };
}

function pathBasename(p) {
  return String(p).replace(/^.*[\\/]/, '').replace(/[\\/]/g, '');
}

/** 安全地把相对路径拼接回 uploads 目录，越界返回 null */
function safeResolve(relPath) {
  const path = require('path');
  const root = path.resolve(config.uploadsDir);
  const full = path.resolve(root, relPath || '');
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

module.exports = { detectByMagic, assertFile, extOf, safeResolve };

