'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('../../config');

/** Recover positioned text fragments that some embedded PDF fonts hide from PDF.js. */
function extractPypdfTextItems(buffer) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(config.ocr.python)) {
      reject(new Error('Python runtime is not installed'));
      return;
    }

    const worker = spawn(config.ocr.python, ['-X', 'utf8', path.join(__dirname, 'pypdf_text_worker.py')], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const output = [];
    let outputSize = 0;
    let diagnostic = '';
    let settled = false;
    const timeout = setTimeout(() => {
      worker.kill();
      if (!settled) {
        settled = true;
        reject(new Error('PDF text recovery timed out'));
      }
    }, 20_000);

    worker.stdout.on('data', (chunk) => {
      outputSize += chunk.length;
      if (outputSize > 8 * 1024 * 1024) {
        worker.kill();
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('PDF text recovery output exceeded the limit'));
        }
        return;
      }
      output.push(chunk);
    });
    worker.stderr.setEncoding('utf8').on('data', (chunk) => { diagnostic = (diagnostic + chunk).slice(-4000); });
    worker.stdin.on('error', () => {});
    worker.once('error', (error) => {
      clearTimeout(timeout);
      if (!settled) { settled = true; reject(error); }
    });
    worker.once('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(diagnostic.trim().split(/\r?\n/).at(-1) || 'pypdf text recovery failed'));
        return;
      }
      try {
        const items = JSON.parse(Buffer.concat(output).toString('utf8'));
        resolve(Array.isArray(items) ? items : []);
      } catch (error) { reject(error); }
    });
    worker.stdin.end(buffer);
  });
}

module.exports = { extractPypdfTextItems };
