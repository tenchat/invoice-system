'use strict';
const fs = require('node:fs/promises');
const { PDFDocument, degrees } = require('pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');
const { ApiError } = require('../middleware/error');
const { safeResolve } = require('../utils/fileGuard');

const PT_PER_MM = 72 / 25.4;
const MAX_SHEETS = 500;

async function readOriginal(row) {
  const file = row.file_rel_path && safeResolve(row.file_rel_path);
  if (!file || !['jpg', 'png', 'pdf'].includes(row.detected_type)) {
    throw new ApiError(422, '缺少 PDF、JPG 或 PNG 版式原件');
  }
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new ApiError(422, '版式原件已丢失');
  }
}

async function originalPdf(bytes) {
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() > 0) return pdf;
  } catch (_error) { /* Report an actionable error to the print page. */ }
  throw new ApiError(422, '原件 PDF 无法读取或已加密');
}

async function originalPageCount(row) {
  const bytes = await readOriginal(row);
  if (row.detected_type !== 'pdf') return 1;
  return (await originalPdf(bytes)).getPageCount();
}

function normalizeLayout(layout = {}) {
  const value = (key, min, max, fallback) => {
    const n = layout[key];
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    perPage: [1, 2, 3, 4].includes(layout.perPage) ? layout.perPage : 2,
    orientation: layout.orientation === 'landscape' ? 'landscape' : 'portrait',
    marginTop: value('marginTop', 0, 50, 10), marginRight: value('marginRight', 0, 50, 10),
    marginBottom: value('marginBottom', 0, 50, 10), marginLeft: value('marginLeft', 0, 50, 10),
    gapX: value('gapX', 0, 30, 5), gapY: value('gapY', 0, 30, 8),
    scale: value('scale', 30, 100, 100), printNameId: layout.printNameId !== false
  };
}

async function sourcePages(doc, row) {
  try {
    const bytes = await readOriginal(row);
    if (row.detected_type !== 'pdf') {
      const image = await (row.detected_type === 'jpg' ? doc.embedJpg(bytes) : doc.embedPng(bytes));
      return [{ width: image.width, height: image.height, draw: (page, bounds) => page.drawImage(image, bounds) }];
    }
    const source = await originalPdf(bytes);
    if (source.getPageCount() > MAX_SHEETS) throw new ApiError(422, 'PDF 原件页数超出单批打印限制');
    const result = [];
    for (const original of source.getPages()) {
      const crop = original.getCropBox();
      const rotation = ((original.getRotation().angle % 360) + 360) % 360;
      const swapped = rotation === 90 || rotation === 270;
      const content = original.node.Contents() && await doc.embedPage(original, {
        left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height
      });
      result.push({
        width: swapped ? crop.height : crop.width,
        height: swapped ? crop.width : crop.height,
        draw(page, { x, y, width, height }) {
          if (!content) return;
          page.drawPage(content, {
            x: x + ([180, 270].includes(rotation) ? width : 0),
            y: y + ([90, 180].includes(rotation) ? height : 0),
            width: swapped ? height : width, height: swapped ? width : height,
            rotate: degrees(-rotation)
          });
        }
      });
    }
    return result;
  } catch (error) {
    throw new ApiError(422, `发票 ${row.invoice_number} 无法拼版：${error.status ? error.message : '原件无法读取'}`);
  }
}

async function drawCaption(doc, page, row, cell) {
  const canvas = createCanvas(Math.ceil(cell.width * 3), 33);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${row.student_name || '—'} · ${row.student_id || '—'} · ${row.invoice_number}`,
    canvas.width / 2, 16.5, canvas.width - 4);
  const image = await doc.embedPng(canvas.toBuffer('image/png'));
  page.drawImage(image, { x: cell.x, y: cell.y, width: cell.width, height: 11 });
}

async function buildPrintDocument(rows, options) {
  const layout = normalizeLayout(options);
  const landscape = layout.orientation === 'landscape';
  const width = (landscape ? 297 : 210) * PT_PER_MM;
  const height = (landscape ? 210 : 297) * PT_PER_MM;
  const columns = layout.perPage === 4 ? 2 : landscape ? layout.perPage : 1;
  const gridRows = Math.ceil(layout.perPage / columns);
  const cellWidth = (width - (layout.marginLeft + layout.marginRight + (columns - 1) * layout.gapX) * PT_PER_MM) / columns;
  const cellHeight = (height - (layout.marginTop + layout.marginBottom + (gridRows - 1) * layout.gapY) * PT_PER_MM) / gridRows;
  const captionHeight = layout.printNameId ? 14 : 0;
  if (cellWidth <= 0 || cellHeight <= captionHeight) throw new ApiError(400, '页边距或间距过大，无法排版');

  const doc = await PDFDocument.create();
  let index = 0;
  let page;
  for (const row of rows) {
    for (const source of await sourcePages(doc, row)) {
      const slot = index % layout.perPage;
      if (index >= MAX_SHEETS * layout.perPage) throw new ApiError(422, '本批拼版超过 500 页，请分批生成');
      if (slot === 0) page = doc.addPage([width, height]);
      const x = layout.marginLeft * PT_PER_MM + (slot % columns) * (cellWidth + layout.gapX * PT_PER_MM);
      const top = height - layout.marginTop * PT_PER_MM - Math.floor(slot / columns) * (cellHeight + layout.gapY * PT_PER_MM);
      const scale = Math.min(cellWidth * layout.scale / 100 / source.width, (cellHeight - captionHeight) / source.height);
      const imageWidth = source.width * scale;
      const imageHeight = source.height * scale;
      const bottom = top - imageHeight;
      source.draw(page, { x: x + (cellWidth - imageWidth) / 2, y: bottom, width: imageWidth, height: imageHeight });
      if (layout.printNameId) await drawCaption(doc, page, row, { x, y: top - cellHeight, width: cellWidth });
      index++;
    }
  }
  return Buffer.from(await doc.save());
}

module.exports = { buildPrintDocument, originalPageCount };

