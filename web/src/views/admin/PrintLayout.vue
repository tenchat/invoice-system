<template>
  <div>
    <h3 class="page-title no-print"><el-icon><Printer /></el-icon> 拼版打印</h3>

    <!-- 已打印项醒目提示 -->
    <el-alert v-if="printedCount > 0" type="warning" show-icon :closable="false" class="mb-12 no-print"
      :title="`所选 ${selectedIds.length} 张发票中有 ${printedCount} 张「已打印」，重复打印请确认`">
      <template #default>
        <el-button size="small" type="danger" plain :disabled="outputBusy" @click="dropPrinted">一键剔除已打印项（{{ printedCount }}）</el-button>
      </template>
    </el-alert>

    <el-row :gutter="12">
      <!-- 参数面板 -->
      <el-col :xs="24" :sm="24" :md="8" :lg="7" class="no-print">
        <div class="page-card">
          <h4 style="margin:0 0 12px">选择发票</h4>
          <div class="toolbar mb-12">
            <el-button size="small" type="primary" plain :disabled="outputBusy" @click="pickUnprinted">仅选择未打印发票</el-button>
            <el-button size="small" :loading="optionsLoading" :disabled="outputBusy || selectionLoading" @click="pickAll">加载全部发票</el-button>
          </div>
          <el-select v-model="selectedIds" multiple filterable collapse-tags collapse-tags-tooltip
            :loading="optionsLoading" :disabled="outputBusy" placeholder="可搜索勾选发票" style="width:100%" @change="selectionChanged">
            <el-option v-for="o in allOptions" :key="o.id" :label="`${o.studentName || ''} ${o.invoiceNumber} ${yuan(o.amountInclTax)}`" :value="o.id" />
          </el-select>
          <div class="muted mt-8" style="font-size:12px">已选 {{ selectedIds.length }} 张</div>

          <div v-if="previewList.length" class="order-panel mt-12">
            <div class="flex-between mb-12">
              <b>打印顺序</b><span class="muted">拖动调整</span>
            </div>
            <ol ref="orderList" class="order-list">
              <li v-for="(row, index) in previewList" :key="row.id" class="order-row">
                <span class="drag-handle" aria-hidden="true">⠿</span>
                <div class="order-label">
                  <div>{{ index + 1 }}. {{ row.studentName || '—' }} · {{ yuan(row.amountInclTax) }}</div>
                  <small>{{ row.invoiceNumber }}</small>
                  <small v-if="row.printError" class="source-error">{{ row.printError }}</small>
                </div>
                <div class="order-actions">
                  <el-button link :aria-label="`上移发票 ${row.invoiceNumber}`" :disabled="index === 0 || outputBusy" @click="moveInvoice(index, index - 1)">↑</el-button>
                  <el-button link :aria-label="`下移发票 ${row.invoiceNumber}`" :disabled="index === previewList.length - 1 || outputBusy" @click="moveInvoice(index, index + 1)">↓</el-button>
                </div>
              </li>
            </ol>
            <el-button v-if="unprintableCount" link type="danger" :disabled="outputBusy" @click="dropUnavailable">
              移除缺少版式原件的发票（{{ unprintableCount }}）
            </el-button>
          </div>

          <el-divider />
          <h4 style="margin:0 0 12px">版式参数</h4>
          <el-form :model="layout" :disabled="outputBusy" size="small" label-width="86px">
            <el-form-item label="每页张数">
              <el-radio-group v-model="layout.perPage">
                <el-radio-button v-for="n in [1, 2, 3, 4]" :key="n" :value="n">{{ n }}</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="纸张方向">
              <el-radio-group v-model="layout.orientation">
                <el-radio-button value="portrait">纵向</el-radio-button><el-radio-button value="landscape">横向</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="页边距(mm)">
              <div class="toolbar">
                <el-input-number v-model="layout.marginTop" :min="0" :max="50" controls-position="right" style="width:88px" />
                <el-input-number v-model="layout.marginRight" :min="0" :max="50" controls-position="right" style="width:88px" />
                <el-input-number v-model="layout.marginBottom" :min="0" :max="50" controls-position="right" style="width:88px" />
                <el-input-number v-model="layout.marginLeft" :min="0" :max="50" controls-position="right" style="width:88px" />
              </div>
              <div class="muted" style="font-size:11px">上 / 右 / 下 / 左</div>
            </el-form-item>
            <el-form-item label="间距(mm)">
              <el-input-number v-model="layout.gapX" :min="0" :max="30" controls-position="right" style="width:88px" />
              <el-input-number v-model="layout.gapY" :min="0" :max="30" controls-position="right" style="width:88px" />
              <span class="muted" style="font-size:11px">横向 / 纵向</span>
            </el-form-item>
            <el-form-item label="缩放(%)"><el-input-number v-model="layout.scale" :min="30" :max="100" controls-position="right" /></el-form-item>
            <el-form-item label="排序">
              <el-select v-model="layout.sortBy" style="width:130px" @change="loadSelection">
                <el-option label="上传时间" value="uploadedAt" /><el-option label="开票日期" value="issueDate" />
                <el-option label="金额" value="amount" /><el-option label="学号" value="studentId" /><el-option label="手动" value="manual" />
              </el-select>
              <el-select v-if="layout.sortBy !== 'manual'" v-model="layout.order" style="width:88px;margin-left:6px" @change="loadSelection">
                <el-option label="升序" value="asc" /><el-option label="降序" value="desc" />
              </el-select>
            </el-form-item>
            <el-form-item label="姓名学号"><el-switch v-model="layout.printNameId" active-text="每张下方打印" /></el-form-item>
          </el-form>

          <el-divider />
          <div class="toolbar">
            <el-button type="primary" :disabled="!canPreview || outputBusy" @click="showPreview">预览拼版</el-button>
            <el-button :disabled="!previewReady || outputBusy" :loading="outputBusy" @click="outputDocument('print')">生成打印 PDF</el-button>
            <el-button :disabled="!previewReady || outputBusy" @click="outputDocument('export')">导出 PDF</el-button>
          </div>
          <div class="muted mt-8" style="font-size:12px">
            确认拼版后打开打印 PDF，在 PDF 查看器中打印。
          </div>
        </div>
      </el-col>

      <!-- A4 预览 -->
      <el-col :xs="24" :sm="24" :md="16" :lg="17">
        <div class="mb-12 no-print flex-between">
          <b>A4 预览<span v-if="showing">（{{ Math.ceil(previewPages.length / layout.perPage) }} 页）</span></b>
          <span v-if="showing && !previewReady && !failedSources.size" class="muted">正在加载原件</span>
        </div>
        <el-alert v-if="failedSources.size" class="mb-12" type="error" :closable="false"
          title="部分原件预览加载失败，请重新预览或移除相关发票。" />
        <PrintSheet v-if="showing" :key="previewVersion" :list="previewPages" :layout="layout"
          @source-ready="sourceReady" @source-error="sourceError" />
        <div v-else class="page-card muted">选择发票并调整顺序后，点击「预览拼版」。</div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import Sortable from 'sortablejs';
import PrintSheet from '../../components/PrintSheet.vue';
import api from '../../api';
import { yuan } from '../../utils/format';

const layout = reactive({
  perPage: 2, orientation: 'portrait',
  marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10,
  gapX: 5, gapY: 8, scale: 100,
  sortBy: 'uploadedAt', order: 'asc', printNameId: true
});
const selectedIds = ref([]);
const allOptions = ref([]);
const optionsLoading = ref(false);
const previewList = ref([]);
const orderList = ref();
const outputBusy = ref(false);
const selectionLoading = ref(false);
const showing = ref(false);
const previewVersion = ref(0);
const loadedSources = ref(new Set());
const failedSources = ref(new Set());
let requestId = 0;

const printedCount = computed(() => previewList.value.filter((row) => row.printStatus).length);
const unprintableCount = computed(() => previewList.value.filter((row) => row.printError).length);
const canPreview = computed(() => !selectionLoading.value && previewList.value.length > 0 && !unprintableCount.value);
const previewPages = computed(() => previewList.value.flatMap((row) =>
  Array.from({ length: row.pageCount }, (_, index) => ({
    ...row, page: index + 1, previewSrc: api.printSourceUrl(row.fileId, row.detectedType, index + 1)
  }))
));
const previewReady = computed(() => canPreview.value && showing.value && !failedSources.value.size &&
  previewPages.value.every((row) => loadedSources.value.has(row.previewSrc)));

function showPreview() {
  loadedSources.value = new Set();
  failedSources.value = new Set();
  previewVersion.value++;
  showing.value = true;
}
function sourceReady(url) { loadedSources.value.add(url); }
function sourceError(url) { failedSources.value.add(url); }

async function loadSelection() {
  const current = ++requestId;
  showing.value = false;
  failedSources.value = new Set();
  if (!selectedIds.value.length) {
    previewList.value = [];
    selectionLoading.value = false;
    return;
  }
  selectionLoading.value = true;
  try {
    const result = await api.previewData(selectedIds.value, layout.sortBy, layout.order);
    if (current !== requestId) return;
    previewList.value = result.list;
    selectedIds.value = result.list.map((row) => row.id);
    const known = new Set(allOptions.value.map((row) => row.id));
    allOptions.value.push(...result.list.filter((row) => !known.has(row.id)));
  } catch (_error) {
    if (current === requestId) previewList.value = [];
  } finally {
    if (current === requestId) selectionLoading.value = false;
  }
}

function selectionChanged(ids) {
  if (layout.sortBy === 'manual') {
    const chosen = new Set(ids);
    const previous = previewList.value.map((row) => row.id);
    const existing = new Set(previous);
    selectedIds.value = [...previous.filter((id) => chosen.has(id)), ...ids.filter((id) => !existing.has(id))];
  }
  loadSelection();
}

async function loadAllOptions() {
  if (optionsLoading.value) return;
  optionsLoading.value = true;
  try {
    const size = 200;
    const first = await api.adminInvoices({ size });
    const results = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / size) - 1) }, (_, index) =>
      api.adminInvoices({ size, page: index + 2 })
    ));
    allOptions.value = [first, ...results].flatMap((result) => result.list);
    return allOptions.value;
  } catch (_error) { return null; }
  finally { optionsLoading.value = false; }
}

async function pickAll() {
  const options = await loadAllOptions();
  if (!options) return;
  selectedIds.value = options.slice(0, 500).map((row) => row.id);
  await loadSelection();
  if (options.length > 500) ElMessage.info('已选择前 500 张，请分批打印');
  else if (options.length) ElMessage.success(`已选择 ${options.length} 张发票`);
  else ElMessage.info('暂无发票');
}

async function pickUnprinted() {
  if (outputBusy.value) return;
  const result = await api.unprintedIds();
  selectedIds.value = result.ids.slice(0, 500);
  if (result.ids.length > 500) ElMessage.info('已选择前 500 张，请分批打印');
  await loadSelection();
}
function dropPrinted() {
  selectedIds.value = previewList.value.filter((row) => !row.printStatus).map((row) => row.id);
  loadSelection();
}
function dropUnavailable() {
  selectedIds.value = previewList.value.filter((row) => !row.printError).map((row) => row.id);
  loadSelection();
}

function moveInvoice(from, to) {
  if (outputBusy.value || from === to || !previewList.value[from] || !previewList.value[to]) return;
  const rows = [...previewList.value];
  const [row] = rows.splice(from, 1);
  rows.splice(to, 0, row);
  layout.sortBy = 'manual';
  previewList.value = rows;
  selectedIds.value = rows.map((item) => item.id);
  if (showing.value) showPreview();
}

watch(orderList, (element, _old, onCleanup) => {
  if (!element) return;
  const sortable = Sortable.create(element, {
    handle: '.drag-handle', animation: 120, disabled: outputBusy.value,
    onEnd({ item, oldIndex, newIndex }) {
      // Restore the DOM before Vue reconciles the reordered list.
      item.remove();
      element.insertBefore(item, element.children[oldIndex] || null);
      moveInvoice(oldIndex, newIndex);
    }
  });
  const stop = watch(outputBusy, (busy) => sortable.option('disabled', busy));
  onCleanup(() => { stop(); sortable.destroy(); });
}, { flush: 'post' });

onMounted(async () => {
  try {
    const ids = JSON.parse(sessionStorage.getItem('print_ids') || '[]');
    const saved = JSON.parse(sessionStorage.getItem('print_batch_layout') || 'null');
    if (Array.isArray(ids)) selectedIds.value = ids;
    if (saved) {
      delete saved.ids;
      Object.assign(layout, saved);
    }
  } catch (_error) { /* Ignore invalid navigation state. */ }
  sessionStorage.removeItem('print_batch_layout');
  await Promise.all([loadAllOptions(), loadSelection()]);
});

async function outputDocument(action) {
  if (!previewReady.value || outputBusy.value) return;
  const tab = action === 'print' ? window.open('about:blank', '_blank') : null;
  if (action === 'print' && !tab) {
    ElMessage.warning('请允许弹出窗口，或使用「导出 PDF」后打开打印');
    return;
  }
  if (tab) {
    tab.opener = null;
    tab.document.body.textContent = '正在生成打印 PDF…';
  }
  const ids = previewList.value.map((row) => row.id);
  const snapshot = { ...layout, sortBy: 'manual' };
  let opened = false;
  outputBusy.value = true;
  try {
    const pdf = await api.printDocument({ ids, layout: snapshot });
    const url = URL.createObjectURL(pdf);
    if (tab && !tab.closed) {
      tab.location.replace(url);
      opened = true;
    } else if (action === 'export') {
      const link = document.createElement('a');
      link.href = url;
      link.download = '发票拼版.pdf';
      link.click();
    } else {
      URL.revokeObjectURL(url);
      return;
    }
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
    await afterAction(action, ids, snapshot);
  } catch (_error) {
    if (tab && !tab.closed && !opened) tab.close();
  } finally {
    outputBusy.value = false;
  }
}

async function afterAction(action, ids, snapshot) {
  let mark = false;
  try {
    await ElMessageBox.confirm(
      action === 'print' ? '请在 PDF 查看器中完成打印，再选择「标记为已打印」。'
        : 'PDF 已导出。需要将这批发票标记为已打印吗？',
      '记录打印批次',
      { type: 'info', confirmButtonText: '标记为已打印', cancelButtonText: '仅记录批次' }
    );
    mark = true;
  } catch (_error) { /* Record the batch without changing invoice status. */ }
  const batch = await api.createBatch({ ids, layout: snapshot, action, markPrinted: mark });
  ElMessage.success('已记录打印批次 #' + batch.id);
  if (mark) previewList.value = previewList.value.map((row) => ({ ...row, printStatus: true }));
}
</script>

<style scoped>
.order-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; max-height: 300px; overflow: auto; }
.order-row { display: flex; align-items: center; gap: 8px; padding: 6px; border: 1px solid var(--border); border-radius: 6px; }
.drag-handle { font-size: 21px; cursor: grab; touch-action: none; user-select: none; }
.order-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.order-label small { display: block; color: var(--muted); }
.order-label .source-error { color: #b42318; }
.order-actions { display: flex; gap: 6px; }
</style>


