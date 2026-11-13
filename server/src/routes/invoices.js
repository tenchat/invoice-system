'use strict';
/** 发票接口。学生提交发票，管理员可查看、修改和删除全部发票。 */
const router = require('express').Router();
const { auth, requireStudent } = require('../middleware/auth');
const { wrap } = require('../middleware/error');
const { writeLog } = require('../utils/log');
const svc = require('../services/invoiceService');
const { getAmountPolicy } = require('../services/amountPolicy');

router.use(auth);

router.get('/amount-policy', wrap(async (_req, res) => res.json(getAmountPolicy())));

// 创建：草稿确认后提交；服务端检查查重及金额规则。
router.post('/', requireStudent, wrap(async (req, res) => {
  const dto = svc.createInvoice(req.user, req.body || {});
  writeLog(req, { action: 'create_invoice', targetType: 'invoice', targetId: dto.id, detail: { invoiceNumber: dto.invoiceNumber } });
  res.status(201).json(dto);
}));

// 我的发票列表（学生强制只看自己）
router.get('/', wrap(async (req, res) => {
  res.json(svc.listInvoices(req.user, {
    ...req.query,
    q: req.query.q,
    from: req.query.from, to: req.query.to,
    page: req.query.page, size: req.query.size
  }));
}));

// 统计：总数 / 总额 / 本月新增 / 按月金额
router.get('/stats', wrap(async (req, res) => {
  res.json(svc.stats(req.user));
}));

router.get('/:id', wrap(async (req, res) => {
  res.json(svc.getInvoice(Number(req.params.id) || 0, req.user));
}));

router.put('/:id', wrap(async (req, res) => {
  const dto = svc.updateInvoice(Number(req.params.id) || 0, req.user, req.body || {});
  writeLog(req, { action: 'update_invoice', targetType: 'invoice', targetId: dto.id, detail: { invoiceNumber: dto.invoiceNumber } });
  res.json(dto);
}));

router.delete('/:id', wrap(async (req, res) => {
  const r = svc.deleteInvoice(Number(req.params.id) || 0, req.user);
  writeLog(req, { action: 'delete_invoice', targetType: 'invoice', targetId: r.id });
  res.json(r);
}));

module.exports = router;

