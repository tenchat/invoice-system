import http, { authToken } from './http';

const qs = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined));

export default {
  // ---- 认证 ----
  studentLogin: (data) => http.post('/auth/student/login', data),
  adminLogin: (data) => http.post('/auth/admin/login', data),
  me: () => http.get('/auth/me'),

  // ---- 文件与解析 ----
  parseFiles: (formData) => http.post('/files/parse', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  reparse: (id) => http.post(`/files/${id}/reparse`),
  // <img> 无法携带 Authorization 头，预览地址附带短会话 token（仅文件读取接口接受）
  previewUrl: (id) => `/api/files/${id}/preview?token=${encodeURIComponent(authToken())}`,
  printSourceUrl: (id, type, page) => type === 'pdf'
    ? `/api/files/${id}/preview?page=${page}&token=${encodeURIComponent(authToken())}`
    : `/api/files/${id}/raw?token=${encodeURIComponent(authToken())}`,
  async openRaw(id, type) {
    const blob = await http.get(`/files/${id}/raw`, { responseType: 'blob' });
    const mime = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', xml: 'application/xml' }[type] || 'application/octet-stream';
    const url = URL.createObjectURL(new Blob([blob], { type: mime }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },

  // ---- 学生发票 ----
  createInvoice: (data) => http.post('/invoices', data),
  getInvoices: (params) => http.get('/invoices', { params: qs(params) }),
  getInvoice: (id) => http.get(`/invoices/${id}`),
  updateInvoice: (id, data) => http.put(`/invoices/${id}`, data),
  deleteInvoice: (id) => http.delete(`/invoices/${id}`),
  getStats: () => http.get('/invoices/stats'),
  getAmountPolicy: () => http.get('/invoices/amount-policy'),
  getBudget: () => http.get('/budget'),
  setBudget: (limit) => http.put('/budget', { limit }),
  setScanStatus: (id, scanned) => http.put(`/admin/invoices/${id}/scan`, { scanned }),
  setInvoiceReimbursed: (id, reimbursed) => http.put(`/admin/invoices/${id}/reimbursement`, { reimbursed }),

  // ---- 管理员：全部发票 / 汇总 / 状态 ----
  adminInvoices: (params) => http.get('/admin/invoices', { params: qs(params) }),
  async exportExcel(params) {
    const blob = await http.get('/admin/invoices/export', { params: qs(params), responseType: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `发票汇总_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  },
  userSummary: () => http.get('/admin/users/summary'),
  users: () => http.get('/admin/users'),
  createUser: (data) => http.post('/admin/users', data),
  updateUser: (id, data) => http.put(`/admin/users/${id}`, data),
  deleteUser: (id) => http.delete(`/admin/users/${id}`),
  setAmountPolicy: (data) => http.put('/admin/amount-policy', data),
  printStatusSummary: () => http.get('/admin/print-status-summary'),
  markPrintStatus: (ids, status) => http.post('/admin/invoices/print-status', { ids, status, confirm: true }),
  setLocked: (ids, locked) => http.post('/admin/invoices/lock', { ids, locked }),
  batchDeleteInvoices: (ids) => http.post('/admin/invoices/batch-delete', { ids, confirm: true }),
  adminLogs: () => http.get('/admin/logs'),

  // ---- 拼版打印与批次 ----
  previewData: (ids, sortBy, order) => http.post('/admin/print/preview-data', { ids, sortBy, order }),
  printDocument: (data) => http.post('/admin/print/document', data, { responseType: 'blob' }),
  unprintedIds: () => http.get('/admin/print/unprinted'),
  createBatch: (data) => http.post('/admin/print/batches', data),
  batches: () => http.get('/admin/print/batches'),
  batch: (id) => http.get(`/admin/print/batches/${id}`),
  batchInvoices: (id) => http.get(`/admin/print/batches/${id}/invoices`),
  setBatchReimbursed: (id, reimbursed) => http.post(`/admin/print/batches/${id}/reimbursement`, { reimbursed, confirm: true }),
  undoBatch: (id) => http.post(`/admin/print/batches/${id}/undo`, { confirm: true })
};
