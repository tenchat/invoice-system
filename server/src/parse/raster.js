'use strict';
/**
 * 栅格化：PDF 页面渲染成 PNG，供识别及浏览器预览，
 * 并把图片解码成 RGBA 供 jsQR 识别二维码。
 * 用 @napi-rs/canvas（预编译二进制，无 node-gyp / 系统字体依赖）。
 */
const napiCanvas = require('./env');   // 注入 Web API polyfill 后再加载 pdfjs
const { createCanvas, loadImage } = napiCanvas;
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const config = require('../../config');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function renderWithPdfium(buffer, scale, pageNumber) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(config.ocr.python)) return reject(new Error('PDF 渲染依赖未安装'));
    const child = spawn(config.ocr.python, ['-X', 'utf8', path.join(__dirname, 'pdfium_worker.py'), String(pageNumber), String(scale)], { windowsHide: true });
    const chunks = [];
    let size = 0, diagnostic = '', settled = false;
    const finish = (error, png) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(png);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('PDF 渲染超时')); }, 30000);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) { child.kill(); finish(new Error('PDF 预览图过大')); }
      else chunks.push(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { diagnostic = (diagnostic + chunk).slice(-2000); });
    child.stdin.on('error', () => {});
    child.once('error', (error) => finish(error));
    child.once('close', (code) => code === 0 ? finish(null, Buffer.concat(chunks)) : finish(new Error(diagnostic.trim().split(/\r?\n/).at(-1) || 'PDF 渲染失败')));
    child.stdin.end(buffer);
  });
}

/** pdf.js 需要的 canvas 工厂 */
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(cc, width, height) {
    cc.canvas.width = Math.max(1, Math.ceil(width));
    cc.canvas.height = Math.max(1, Math.ceil(height));
  }
  destroy(cc) {
    cc.canvas.width = 0;
    cc.canvas.height = 0;
  }
}

/**
 * 渲染指定 PDF 页面，默认第一页。
 * @returns {Promise<{png:Buffer,width:number,height:number,rgba:Uint8ClampedArray}|null>}
 */
async function renderPdfToPng(buffer, scale = config.pdf.renderScale, pageNumber = 1) {
  try {
    const png = await renderWithPdfium(buffer, scale, pageNumber);
    const decoded = await decodeImageToRgba(png);
    if (decoded) return { png, ...decoded };
  } catch (e) {
    console.warn('[raster] PDFium 不可用，使用备用渲染器:', e.message);
  }
  const factory = new NodeCanvasFactory();
  let doc;
  try {
    doc = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      canvasFactory: factory,
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0
    }).promise;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const w = Math.ceil(viewport.width), h = Math.ceil(viewport.height);
    const cc = factory.create(w, h);
    await page.render({ canvasContext: cc.context, viewport, background: 'white' }).promise;
    const rgba = cc.context.getImageData(0, 0, w, h).data;
    return { png: cc.canvas.toBuffer('image/png'), width: w, height: h, rgba };
  } catch (e) {
    console.warn('[raster] PDF 渲染失败:', e.message);
    return null;
  } finally {
    if (doc) { try { await doc.destroy(); } catch (_e) { /* ignore */ } }
  }
}

/** 图片 Buffer → RGBA（jsQR 输入） */
async function decodeImageToRgba(buffer) {
  try {
    const img = await loadImage(buffer);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, img.width, img.height);
    ctx.drawImage(img, 0, 0);
    return { rgba: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height };
  } catch (e) {
    console.warn('[raster] 图片解码失败:', e.message);
    return null;
  }
}

/** 大图等比缩小，避免 jsQR 在大图上过慢 / 漏检 */
async function shrinkForQr(rgba, width, height, maxSide = 1600) {
  const ratio = Math.min(1, maxSide / Math.max(width, height));
  if (ratio >= 1) return { data: rgba, width, height };
  const w = Math.round(width * ratio), h = Math.round(height * ratio);
  const src = createCanvas(width, height);
  const sctx = src.getContext('2d');
  sctx.putImageData(new napiCanvas.ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const dst = createCanvas(w, h);
  const dctx = dst.getContext('2d');
  dctx.drawImage(src, 0, 0, w, h);
  const d = dctx.getImageData(0, 0, w, h);
  return { data: d.data, width: w, height: h };
}

/** 统一入口：按真实文件类型产出预览图 + 二维码识别用的像素 */
async function buildRaster(buffer, detectedType) {
  if (detectedType === 'pdf') {
    const r = await renderPdfToPng(buffer);
    if (!r) return { preview: null, rgba: null, width: 0, height: 0, error: 'PDF 渲染失败，无法生成打印预览图' };
    return { preview: r.png, rgba: r.rgba, width: r.width, height: r.height };
  }
  if (detectedType === 'jpg' || detectedType === 'png') {
    const r = await decodeImageToRgba(buffer);
    return r ? { preview: null, rgba: r.rgba, width: r.width, height: r.height } : { preview: null, rgba: null, width: 0, height: 0, error: '图片解码失败' };
  }
  return { preview: null, rgba: null, width: 0, height: 0 };
}

module.exports = { renderPdfToPng, decodeImageToRgba, shrinkForQr, buildRaster, NodeCanvasFactory };
