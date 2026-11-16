'use strict';
/**
 * 第 1 优先级：数电票标准 XML。
 * 全部节点强制成数组，配合 aliases.js 的路径上下文 + 别名表提取主表与明细；
 * 任何匹配不到的字段保持 null（没有获取渠道就留空，绝不猜测）。
 */
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { flattenLeaves, extractItemRows, matchMainField } = require('./aliases');

function parser() {
  return new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: false,       // 一律保留字符串，交给 normalizeDraft 统一转数字
    parseAttributeValue: false,
    isArray: () => true         // 统一数组结构，明细只有 1 行时也能正确识别为数组
  });
}

/**
 * @param {Buffer} buffer
 * @returns {{ layer:string, ok:boolean, invoice:object, items:object[], sources:object, meta:object, error?:string }}
 */
function parseXml(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const valid = XMLValidator.validate(text);
  if (valid !== true) return empty(`XML 格式非法: ${valid?.err?.msg || 'unknown'}`);

  let root;
  try {
    root = parser().parse(text);
  } catch (e) {
    return empty(`XML 解析失败: ${e.message}`);
  }

  const leaves = flattenLeaves(root);
  const invoice = {};
  const invoiceSources = {};
  for (const leaf of leaves) {
    const field = matchMainField(leaf);
    if (!field || invoice[field]) continue;   // 首个命中优先，不覆盖已有值
    invoice[field] = leaf.value;
    invoiceSources[field] = 'xml';
  }

  const rows = extractItemRows(root);
  const items = rows.map((r) => ({ ...r }));
  const itemSources = rows.map((r) => {
    const s = {};
    for (const k of Object.keys(r)) if (r[k] !== undefined && r[k] !== '') s[k] = 'xml';
    return s;
  });

  return {
    layer: 'xml', ok: true, invoice, items,
    sources: { invoice: invoiceSources, items: itemSources },
    meta: { leafCount: leaves.length, itemCount: items.length, rootKeys: Object.keys(root || {}) }
  };
}

function empty(error) {
  return { layer: 'xml', ok: false, invoice: {}, items: [], sources: { invoice: {}, items: [] }, meta: {}, error };
}

module.exports = { parseXml };
