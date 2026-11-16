'use strict';
/**
 * pdf.js 在 Node 环境渲染/解析时可能引用浏览器 Web API。
 * 统一在加载 pdfjs 之前注入 polyfill（@napi-rs/canvas 预编译二进制，无系统依赖）。
 */
const canvas = require('@napi-rs/canvas');
for (const k of ['DOMMatrix', 'ImageData', 'Path2D', 'Image']) {
  if (!globalThis[k] && canvas[k]) globalThis[k] = canvas[k];
}
module.exports = canvas;
