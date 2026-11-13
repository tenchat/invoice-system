export const SOURCE_META = {
  xml: { label: 'XML', type: 'success' },
  pdf: { label: 'PDF文本', type: 'primary' },
  qr: { label: '自动校验', type: 'warning' },
  ocr: { label: '自动识别', type: 'info' },
  manual: { label: '手工', type: 'info' }
};

export function parseStatusLabel(status) {
  if (status === 'failed') return '未识别';
  if (status === 'manual') return '手动录入';
  return SOURCE_META[status]?.label || '混合来源';
}

export function warningText(warning) {
  // 历史发票可能保存了旧版识别提示。
  if (warning.type === 'qr') return '未能自动校验，请核对票面';
  if (warning.type === 'ocr' && /ocr/i.test(warning.message)) return '部分内容未能自动识别，请按票面补填';
  return warning.message?.replace(/^二维码/, '校验结果：').replace(/二维码/g, '校验信息') || '';
}

export function money(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
}
export const yuan = (v) => (v === null || v === undefined || v === '' ? '—' : `¥${money(v)}`);
export const dateShort = (v) => (v ? String(v).slice(0, 10) : '—');

export const MAIN_LABELS = {
  invoiceNumber: '发票号码', issueDate: '开票日期', buyerName: '购买方名称', buyerTaxId: '购买方统一社会信用代码',
  sellerName: '销售方名称', sellerTaxId: '销售方统一社会信用代码', amountExclTax: '合计金额(不含税)',
  totalTax: '合计税额', amountInclTax: '价税合计', remark: '备注'
};
export const ITEM_LABELS = {
  name: '项目名称', spec: '规格型号', unit: '单位', quantity: '数量',
  unitPrice: '单价', amount: '金额', taxRate: '税率', taxAmount: '税额'
};

export function invoiceEditDraft(detail) {
  return {
    parseStatus: detail.parseStatus,
    fundPurpose: detail.fundPurpose,
    recognizedTotal: detail.recognizedTotal,
    invoice: Object.fromEntries(Object.keys(MAIN_LABELS).map((field) => [field, detail[field]])),
    items: detail.items || [],
    sources: detail.fieldSources || { invoice: {}, items: [] },
    warnings: detail.warnings || [],
    qrMismatch: []
  };
}

