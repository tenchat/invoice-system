'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('../../config');
const { parsePdfTextItems } = require('./pdfText');

// OCR is CPU-bound. Serialize work so concurrent uploads don't start competing model processes.
let pending = Promise.resolve();

function recognize(buffer) {
  const task = pending.then(() => new Promise((resolve, reject) => {
    if (!fs.existsSync(config.ocr.python)) {
      reject(new Error('本地 OCR 尚未安装，请运行 npm run setup:ocr'));
      return;
    }
    const worker = spawn(config.ocr.python, ['-X', 'utf8', path.join(__dirname, 'rapidocr_worker.py')], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const output = [];
    let diagnostic = '';
    const timeout = setTimeout(() => {
      worker.kill();
      reject(new Error('本地 OCR 识别超时'));
    }, 45_000);
    worker.stdout.on('data', (chunk) => output.push(chunk));
    worker.stderr.setEncoding('utf8').on('data', (chunk) => { diagnostic = (diagnostic + chunk).slice(-4000); });
    worker.stdin.on('error', () => {});
    worker.once('error', reject);
    worker.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        console.warn('[ocr] RapidOCR 退出:', diagnostic.trim().split(/\r?\n/).at(-1));
        reject(new Error('本地 OCR 识别失败，请核对安装及模型'));
        return;
      }
      try { resolve(JSON.parse(Buffer.concat(output).toString('utf8'))); }
      catch (error) { reject(error); }
    });
    worker.stdin.end(buffer);
  }));
  pending = task.catch(() => {});
  return task;
}

async function parseOcrImage(buffer) {
  const items = await recognize(buffer);
  const heights = items.map((item) => item.height).sort((a, b) => a - b);
  const yTolerance = Math.max(3, (heights[Math.floor(heights.length / 2)] || 0) * 0.45);
  return parsePdfTextItems(items, { layer: 'ocr', yTolerance });
}

module.exports = { parseOcrImage };
