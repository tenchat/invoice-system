'use strict';
/** 挂载于 /api/admin/print：拼版预览数据、未打印票快捷列表、批次历史/详情/撤销。 */
const router = require('express').Router();
const { auth, requireAdmin } = require('../middleware/auth');
const { wrap, ApiError } = require('../middleware/error');
const { writeLog } = require('../utils/log');
const svc = require('../services/printService');
const invSvc = require('../services/invoiceService');
const { buildPrintDocument } = require('../services/printDocument');

router.use(auth, requireAdmin);

/** 按一串发票号码顺序解析出对应的发票 ID 列表 */
router.post('/resolve-numbers', wrap(async (req, res) => {
  res.json(svc.resolveByNumbers(req.body?.numbers));
}));

/** 拼版预览数据：按指定排序返回票信息及原件页数。 */
router.post('/preview-data', wrap(async (req, res) => {
  const { ids, sortBy, order } = req.body || {};
  res.json({ list: await svc.previewData(ids, sortBy, order) });
}));

router.post('/document', wrap(async (req, res) => {
  const { ids, layout } = req.body || {};
  const buffer = await buildPrintDocument(svc.printRows(ids), layout || {});
  res.type('pdf').set('Cache-Control', 'no-store').send(buffer);
}));

/** 快捷按钮「仅选择未打印发票」 */
router.get('/unprinted', wrap(async (req, res) => {
  const r = invSvc.listInvoices(req.user, { status: 'unprinted', page: 1, size: 100000 });
  res.json({ ids: r.list.map((i) => i.id), total: r.total });
}));

/** 打印或导出 PDF 后创建批次（可选同时标记为已打印） */
router.post('/batches', wrap(async (req, res) => {
  const { ids, layout, action, markPrinted } = req.body || {};
  const batch = svc.createBatch({ ids, layout, action: action || 'print', markPrinted: !!markPrinted, req });
  res.status(201).json(batch);
}));

router.get('/batches', wrap(async (_req, res) => {
  res.json({ list: svc.listBatches() });
}));

router.get('/batches/:id', wrap(async (req, res) => {
  res.json(svc.getBatch(Number(req.params.id) || 0));
}));

router.get('/batches/:id/invoices', wrap(async (req, res) => {
  res.json({ list: svc.getBatchInvoices(Number(req.params.id) || 0) });
}));

router.post('/batches/:id/reimbursement', wrap(async (req, res) => {
  if (typeof req.body?.reimbursed !== 'boolean') throw new ApiError(400, '报销状态不合法');
  if (req.body?.confirm !== true) throw new ApiError(400, '批量标记报销需要二次确认');
  const r = svc.setBatchReimbursed(Number(req.params.id) || 0, req.body.reimbursed, req);
  res.json(r);
}));

router.post('/batches/:id/undo', wrap(async (req, res) => {
  if (req.body?.confirm !== true) throw new ApiError(400, '撤销需要二次确认');
  const r = svc.undoBatch(Number(req.params.id) || 0, req);
  writeLog(req, { action: 'undo_print_batch_api', targetType: 'print_batch', targetId: r.id, detail: { restored: r.restored } });
  res.json(r);
}));

module.exports = router;
