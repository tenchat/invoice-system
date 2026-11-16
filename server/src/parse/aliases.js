'use strict';
/**
 * 数电票字段名别名表 + XML 路径上下文匹配。
 * 设计原则：只接受「明确」的标签名，模糊标签一律留空交给人工补填 —— 不猜测、不编造。
 * normKey 会去掉命名空间前缀、大小写与非字母数字字符，使 <EI:InvoiceNumber> 与 <invoice_number> 都能命中。
 */

const normKey = (k) => String(k || '')
  .replace(/^[^:]+:/, '')                 // 去命名空间
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');

const MAIN_ALIASES = {
  invoiceNumber: ['invoicenumber', 'invoiceno', 'invoicenum', 'billnumber', 'fphm', 'fpdm', '发票号码', '发票号', '电子发票号码', '数电票号码', '全电发票号码'],
  issueDate: ['issuedate', 'invoicedate', 'billingdate', 'kprq', '开票日期'],
  buyerName: ['buyername', 'purchasername', 'gmfmc', '购买方名称', '购方名称', '买方名称'],
  buyerTaxId: ['buyertaxid', 'buyertaxno', 'buyercreditcode', 'gmfshxydm', 'gmfnsrsbh', '购买方统一社会信用代码', '购买方纳税人识别号', '购方税号'],
  sellerName: ['sellername', 'xsfmc', '销售方名称', '销方名称', '开票方名称'],
  sellerTaxId: ['sellertaxid', 'sellertaxno', 'sellercreditcode', 'xsfshxydm', 'xsfnsrsbh', '销售方统一社会信用代码', '销售方纳税人识别号', '销方税号'],
  amountExclTax: ['amountexcltax', 'amountexcludingtax', 'netamount', 'subtotalamount', 'hjje', '合计金额', '不含税金额', '金额合计', '合计不含税金额'],
  totalTax: ['totaltax', 'totaltaxamount', 'hjse', '合计税额', '税额合计'],
  amountInclTax: ['amountincltax', 'totalamountincltax', 'totalinclusive', 'jshj', '价税合计', '含税金额', '价税合计金额'],
  remark: ['remark', 'note', 'remarks', 'bz', '备注', '备注说明']
};

const ITEM_ALIASES = {
  name: ['name', 'itemname', 'goodsname', 'productname', 'xmmc', '项目名称', '货物或应税劳务服务名称', '货物名称', '项目名称规格'],
  spec: ['spec', 'specification', 'model', 'ggxh', '规格型号', '型号', '规格'],
  unit: ['unit', 'unitname', 'dw', '单位', '计量单位'],
  quantity: ['quantity', 'qty', 'count', 'sl', '数量'],
  unitPrice: ['unitprice', 'price', 'dj', '单价', '不含税单价'],
  amount: ['amount', 'lineamount', 'je', '金额', '不含税金额', '明细金额'],
  taxRate: ['taxrate', 'rate', 'slv', '税率', '征收率'],
  taxAmount: ['taxamount', 'tax', 'se', '税额', '明细税额']
};

const TAX_KEYS = ['taxid', 'taxno', 'creditcode', 'shxydm', 'nsrsbh', '统一社会信用代码', '纳税人识别号', '税号', 'nsrdj'];
const NAME_KEYS = ['name', 'mc', '名称', '单位名称', 'buyername', 'sellername', 'partyname'];

const MAIN_LOOKUP = new Map();
for (const [field, list] of Object.entries(MAIN_ALIASES)) for (const a of list) MAIN_LOOKUP.set(normKey(a), field);
const ITEM_LOOKUP = new Map();
for (const [field, list] of Object.entries(ITEM_ALIASES)) for (const a of list) ITEM_LOOKUP.set(normKey(a), field);

/** 由叶子节点的 key + 祖先路径推断主表字段（祖先用于区分购买方/销售方同名 <Name>） */
function matchMainField(leaf) {
  const key = normKey(leaf.key);
  const ctx = (leaf.parentKeys || []).map(normKey).join('|');
  const isBuyer = /buyer|purchaser|gmf|购买方|购方|买方/.test(ctx);
  const isSeller = /seller|xf|销售方|销方|开票方/.test(ctx);

  if ((isBuyer || isSeller) && (NAME_KEYS.includes(key) || key.endsWith('name'))) {
    return isBuyer ? 'buyerName' : 'sellerName';
  }
  if ((isBuyer || isSeller) && TAX_KEYS.some((t) => key === t || key.endsWith(t))) {
    return isBuyer ? 'buyerTaxId' : 'sellerTaxId';
  }
  return MAIN_LOOKUP.get(key) || null;
}

function matchItemField(leaf) {
  return ITEM_LOOKUP.get(normKey(leaf.key)) || null;
}

/** 数组节点是否为「明细行容器」 */
function isItemContainer(key) {
  const k = normKey(key);
  return /^(items?|.*items?|lines?|.*lines?|details?|.*details?|mx|.*mx|明细.*|.*明细|发票明细|货物或应税劳务.*)$/.test(k);
}

/** 把任意对象递归摊平成叶子：{ key, parentKeys, value } */
function flattenLeaves(node, parentKeys = [], out = []) {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const v of node) flattenLeaves(v, parentKeys, out);
    return out;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('@_') || k === '#text') continue;   // 忽略 XML 属性
      if (v !== null && typeof v === 'object') flattenLeaves(v, [...parentKeys, k], out);
      else if (v !== '' && v !== null && v !== undefined) out.push({ key: k, parentKeys, value: String(v).trim() });
    }
    return out;
  }
  if (String(node).trim() !== '') out.push({ key: parentKeys[parentKeys.length - 1] || '', parentKeys: parentKeys.slice(0, -1), value: String(node).trim() });
  return out;
}

/**
 * 展开为「行对象」：兼容 <Items><Item>..</Item><Item>..</Item></Items>
 * 与 <Items><Name>..</Name></Items> 两种结构（parser 已把所有节点转成数组）。
 */
function expandRows(el) {
  if (!el || typeof el !== 'object') return [];
  if (Array.isArray(el)) return el.flatMap(expandRows);
  for (const [k, v] of Object.entries(el)) {
    if (Array.isArray(v) && v.length && /item|line|detail|row|明细|mx/i.test(k) && v.every((x) => x && typeof x === 'object')) {
      return v.flatMap(expandRows);
    }
  }
  return [el];
}

/** 找出所有明细容器数组，把每个元素映射成一行 */
function extractItemRows(root) {
  const rows = [];
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (Array.isArray(v) && isItemContainer(k)) {
        for (const rowObj of v.flatMap(expandRows)) {
          const row = {};
          for (const leaf of flattenLeaves(rowObj)) {
            const f = matchItemField(leaf);
            if (f && (row[f] === undefined || row[f] === '')) row[f] = leaf.value;
          }
          if (Object.keys(row).length) rows.push(row);
        }
      } else if (v && typeof v === 'object') visit(v);
    }
  };
  visit(root);
  return rows;
}

module.exports = { normKey, MAIN_ALIASES, ITEM_ALIASES, matchMainField, matchItemField, isItemContainer, flattenLeaves, extractItemRows };
