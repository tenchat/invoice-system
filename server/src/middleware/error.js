'use strict';

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** 包裹 async 路由，异常统一交给 errorHandler */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFound(req, res, next) {
  next(new ApiError(404, `接口不存在: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.status || (err.code && err.code.startsWith('SQLITE_CONSTRAINT') ? 409 : 500);
  if (status >= 500) console.error('[ERROR]', err);
  res.status(status).json({
    message: err.message || '服务器内部错误',
    code: status,
    details: err.details || undefined
  });
}

module.exports = { ApiError, wrap, notFound, errorHandler };
