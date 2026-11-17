'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument, PDFName, PDFArray, PDFNumber } = require('pdf-lib');

const tempUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-stamp-test-'));
const config = require('../config');
const prevUploadsDir = config.uploadsDir;
config.uploadsDir = tempUploads;

const { buildPrintDocument } = require('../src/services/printDocument');
const { renderPdfToPng } = require('../src/parse/raster');

test.after(() => {
  config.uploadsDir = prevUploadsDir;
  try { fs.rmSync(tempUploads, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
});

async function createPdfWithRedStampAnnotation() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.drawText('INVOICE', { x: 40, y: 240, size: 18 });

  // 构造带红色印章外观流 (/AP -> /N) 的 /Stamp 注释
  const apForm = doc.context.stream('1 0 0 rg 0 0 80 80 re f', {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, 80, 80]
  });
  const apRef = doc.context.register(apForm);

  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Stamp',
    Rect: [220, 80, 300, 160],
    F: 4, // Print flag
    AP: { N: apRef }
  });
  const annotRef = doc.context.register(annot);
  const annots = PDFArray.withContext(doc.context);
  annots.push(annotRef);
  page.node.set(PDFName.of('Annots'), annots);

  // 确保 PDF 尺寸为正数
  assert.ok(PDFNumber.of(400));
  return Buffer.from(await doc.save());
}

test('拼版生成 PDF 时保留 Annots 印章/电子签章红色外观', async () => {
  const pdfBytes = await createPdfWithRedStampAnnotation();
  const relPath = 'stamp-invoice.pdf';
  fs.writeFileSync(path.join(tempUploads, relPath), pdfBytes);

  const outputPdf = await buildPrintDocument([{
    invoice_number: '25310000000000000099',
    student_name: '测试',
    student_id: '2026001',
    detected_type: 'pdf',
    file_rel_path: relPath
  }], { perPage: 1, orientation: 'portrait', printNameId: false });

  const rendered = await renderPdfToPng(outputPdf, 1.5, 1);
  assert.ok(rendered && rendered.rgba, '输出 PDF 应可正常渲染');

  let redPixels = 0;
  for (let i = 0; i < rendered.rgba.length; i += 4) {
    const r = rendered.rgba[i], g = rendered.rgba[i + 1], b = rendered.rgba[i + 2];
    if (r > 200 && g < 60 && b < 60) redPixels++;
  }
  assert.ok(redPixels > 500, `生成 PDF 中应保留红色印章像素，实际检测到 ${redPixels}`);
});
