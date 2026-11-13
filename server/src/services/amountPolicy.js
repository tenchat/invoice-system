'use strict';
const { getDb } = require('../db');
const { ApiError } = require('../middleware/error');

function getAmountPolicy() {
  const row = getDb().prepare('SELECT purpose_threshold, max_amount FROM invoice_amount_policy WHERE id = 1').get();
  return { purposeThreshold: row?.purpose_threshold ?? 200, maxAmount: row?.max_amount ?? null };
}

function setAmountPolicy({ purposeThreshold, maxAmount } = {}) {
  const valid = (value) => Number.isFinite(value) && value >= 0 && Number(value.toFixed(2)) === value;
  if (!valid(purposeThreshold) || (maxAmount !== null && !valid(maxAmount))) {
    throw new ApiError(400, '金额阈值须为非负数字，最多两位小数');
  }
  getDb().prepare(`INSERT INTO invoice_amount_policy (id, purpose_threshold, max_amount) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET purpose_threshold = excluded.purpose_threshold, max_amount = excluded.max_amount`)
    .run(purposeThreshold, maxAmount);
  return getAmountPolicy();
}

function assertWithinLimit(amount, policy) {
  if (policy.maxAmount !== null && amount !== null && amount > policy.maxAmount) {
    throw new ApiError(422, `发票价税合计 ${amount.toFixed(2)} 元，超过上传上限 ${policy.maxAmount.toFixed(2)} 元`,
      { reason: 'invoice_amount_limit' });
  }
}

function validateSubmission(invoice, recognizedTotal, fundPurpose) {
  const total = invoice.amountInclTax;
  if (total === null || Number(total.toFixed(2)) !== total) {
    throw new ApiError(400, '请填写有效的价税合计，最多两位小数');
  }
  const policy = getAmountPolicy();
  const amount = recognizedTotal === null ? total : Math.max(total, recognizedTotal);
  assertWithinLimit(amount, policy);
  if (amount > policy.purposeThreshold && !fundPurpose) {
    throw new ApiError(422, `发票价税合计超过 ${policy.purposeThreshold.toFixed(2)} 元，请填写资金用途`);
  }
}

module.exports = { getAmountPolicy, setAmountPolicy, assertWithinLimit, validateSubmission };

