<template>
  <div>
    <el-alert v-if="draft.parseStatus === 'failed'" type="warning" :closable="false" show-icon class="mb-12"
      title="自动识别失败，请手动录入" description="请填写发票号码和价税合计，并按票面补充其余字段。" />
    <el-alert v-else type="info" :closable="false" show-icon class="mb-12"
      :title="`识别方式：${layerText}｜每个字段右下角标签为数据来源，修改后自动标记为「手工」`" />

    <!-- 警告：只提示，不禁止提交 -->
    <div v-if="warnings.length" class="mb-12">
      <el-alert v-for="(w, i) in warnings" :key="i" :type="w.level === 'error' ? 'error' : 'warning'"
        :title="warningText(w)" :closable="false" show-icon style="margin-bottom:6px" />
    </div>

    <h4 class="page-title" style="font-size:15px">发票主信息</h4>
    <el-form label-position="top" size="small">
      <el-row :gutter="10">
        <el-col v-for="f in mainFields" :key="f" :xs="24" :sm="12" :md="8" :lg="8">
          <el-form-item>
            <template #label>
              <span class="field-label">
                <span>{{ MAIN_LABELS[f] }}<span v-if="['invoiceNumber', 'amountInclTax'].includes(f)" style="color:#f56c6c"> *</span></span>
                <el-tag v-if="draft.sources.invoice[f]" size="small" effect="plain"
                  :type="SOURCE_META[draft.sources.invoice[f]]?.type || 'info'">
                  {{ SOURCE_META[draft.sources.invoice[f]]?.label || '自动识别' }}
                </el-tag>
              </span>
            </template>
            <el-input v-model="draft.invoice[f]" :aria-label="MAIN_LABELS[f]" :disabled="readonly" :class="{ 'qr-conflict': !!conflicts[f] }"
              :placeholder="f === 'invoiceNumber' ? '20 位数电票号码' : '无获取渠道时留空'"
              @input="markMain(f)" />
            <div v-if="conflicts[f]" class="qr-conflict-tip">
              ⚠ 校验值：{{ conflicts[f].qr }}，请核对票面。
              <el-button v-if="!readonly" link type="danger" size="small" @click="applyQr(f)">采用校验值</el-button>
            </div>
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item v-if="showPurpose || requiresPurpose || draft.fundPurpose" label="资金用途" :required="requiresPurpose">
        <el-input v-model="draft.fundPurpose" type="textarea" :rows="2" :maxlength="500" :disabled="readonly" show-word-limit
          :placeholder="requiresPurpose ? `价税合计超过 ${policy.purposeThreshold} 元，请填写资金用途` : '填写资金用途（选填）'" />
      </el-form-item>
      <el-alert v-if="overLimit" class="mb-12" type="error" :closable="false" show-icon
        :title="`价税合计超过 ${policy.maxAmount} 元，无法提交`" />
    </el-form>

    <div class="flex-between mb-12" style="margin-top:4px">
      <h4 class="page-title" style="font-size:15px;margin:0">明细行（{{ draft.items.length }} 行）</h4>
      <el-button v-if="!readonly" size="small" type="primary" plain @click="addItem">+ 新增明细行</el-button>
    </div>

    <el-table :data="draft.items" border size="small" style="width:100%" :scrollbar-always-on="true">
      <el-table-column type="index" label="#" width="46" fixed />
      <el-table-column v-for="f in itemFields" :key="f" :label="ITEM_LABELS[f]" :min-width="colWidth(f)">
        <template #default="{ row, $index }">
          <div>
            <el-input v-model="row[f]" :disabled="readonly" size="small" @input="markItem($index, f)" />
            <span v-if="draft.sources.items[$index]?.[f]" class="src-tag">
              {{ SOURCE_META[draft.sources.items[$index][f]]?.label || '自动识别' }}
            </span>
          </div>
        </template>
      </el-table-column>
      <el-table-column v-if="!readonly" label="操作" width="70" fixed="right">
        <template #default="{ $index }">
          <el-button link type="danger" size="small" @click="removeItem($index)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty><span class="muted">暂无明细行，可手动新增</span></template>
    </el-table>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { MAIN_LABELS, ITEM_LABELS, SOURCE_META, parseStatusLabel, warningText } from '../utils/format';

const props = defineProps({
  draft: { type: Object, required: true },
  policy: { type: Object, required: true },
  showPurpose: Boolean,
  readonly: { type: Boolean, default: false }
});

const mainFields = Object.keys(MAIN_LABELS);
const itemFields = Object.keys(ITEM_LABELS);

// 补齐结构：解析失败 / 手动录入时也能直接编辑
if (!props.draft.invoice) props.draft.invoice = {};
if (!Array.isArray(props.draft.items)) props.draft.items = [];
if (!props.draft.sources) props.draft.sources = { invoice: {}, items: [] };
if (!props.draft.sources.invoice) props.draft.sources.invoice = {};
if (!Array.isArray(props.draft.sources.items)) props.draft.sources.items = [];
for (const f of mainFields) if (!(f in props.draft.invoice)) props.draft.invoice[f] = null;
props.draft.items.forEach((r, i) => {
  for (const f of itemFields) if (!(f in r)) r[f] = null;
  if (!props.draft.sources.items[i]) props.draft.sources.items[i] = {};
});

const warnings = computed(() => props.draft.warnings || []);
const checkedAmount = computed(() => {
  const raw = String(props.draft.invoice.amountInclTax ?? '').replace(/[¥￥,，\s]/g, '');
  return Math.max(raw ? Number(raw) || 0 : 0, props.draft.recognizedTotal ?? -Infinity);
});
const requiresPurpose = computed(() => checkedAmount.value > props.policy.purposeThreshold);
const overLimit = computed(() => props.policy.maxAmount != null && checkedAmount.value > props.policy.maxAmount);
const conflicts = computed(() => Object.fromEntries((props.draft.qrMismatch || []).map((m) => [m.field, m])));
const layerText = computed(() => parseStatusLabel(props.draft.parseStatus));

/** 一键采用二维码校验值：值来自真实二维码，来源标为 qr，不是猜测 */
function applyQr(f) {
  const c = conflicts.value[f];
  if (!c) return;
  props.draft.invoice[f] = c.qr;
  props.draft.sources.invoice[f] = 'qr';
  props.draft.qrMismatch = (props.draft.qrMismatch || []).filter((m) => m.field !== f);
  props.draft.warnings = (props.draft.warnings || []).filter((w) => !(w.type === 'qr_mismatch' && w.field === f));
}

function markMain(f) { props.draft.sources.invoice[f] = 'manual'; }
function markItem(i, f) { if (!props.draft.sources.items[i]) props.draft.sources.items[i] = {}; props.draft.sources.items[i][f] = 'manual'; }
function emptyRow() { return Object.fromEntries(itemFields.map((f) => [f, null])); }
function addItem() { props.draft.items.push(emptyRow()); props.draft.sources.items.push({}); }
function removeItem(i) { props.draft.items.splice(i, 1); props.draft.sources.items.splice(i, 1); }
function colWidth(f) { return f === 'name' ? 200 : f === 'spec' ? 120 : 100; }
</script>

