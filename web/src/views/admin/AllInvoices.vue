<template>
  <div>
    <h3 class="page-title"><el-icon><Tickets /></el-icon> 全部发票</h3>

    <div class="page-card mb-12">
      <div class="flex-between mb-12">
        <div class="toolbar">
          <el-tag type="info" effect="dark" size="large">未打印 {{ summary.unprinted }}</el-tag>
          <el-tag type="success" effect="dark" size="large">已打印 {{ summary.printed }}</el-tag>
          <el-tag effect="plain" size="large">合计 {{ summary.total }}</el-tag>
        </div>
        <div class="toolbar">
          <el-button size="small" @click="quickUnprinted">仅看未打印</el-button>
          <el-button size="small" type="success" plain @click="exportExcel">导出 Excel（含明细）</el-button>
        </div>
      </div>

      <el-form :model="query" size="small" label-width="62px" inline>
        <el-form-item label="姓名"><el-input v-model="query.name" placeholder="学生姓名" style="width:130px" clearable /></el-form-item>
        <el-form-item label="学号"><el-input v-model="query.studentId" placeholder="学号" style="width:140px" clearable /></el-form-item>
        <el-form-item label="关键词"><el-input v-model="query.q" placeholder="发票号/销售方" style="width:160px" clearable /></el-form-item>
        <el-form-item label="销售方"><el-input v-model="query.seller" placeholder="销售方名称" style="width:150px" clearable /></el-form-item>
        <el-form-item label="日期"><el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="起" end-placeholder="止" style="width:230px" /></el-form-item>
        <el-form-item label="金额"><el-input v-model="query.minAmount" placeholder="最低" style="width:88px" /><span style="margin:0 4px">-</span><el-input v-model="query.maxAmount" placeholder="最高" style="width:88px" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable placeholder="全部" style="width:120px">
            <el-option label="未打印" value="unprinted" /><el-option label="已打印" value="printed" />
          </el-select>
        </el-form-item>
        <el-form-item><el-button type="primary" @click="load(1)">查询</el-button><el-button @click="reset">重置</el-button></el-form-item>
      </el-form>
    </div>

    <div class="page-card mb-12 no-print">
      <div class="toolbar">
        <span class="muted">已选 {{ selection.length }} 张：</span>
        <el-button size="small" type="success" :disabled="!selection.length || deleting" @click="mark(true)">标记为已打印</el-button>
        <el-button size="small" :disabled="!selection.length || deleting" @click="mark(false)">标记为未打印</el-button>
        <el-button size="small" type="warning" plain :disabled="!selection.length || deleting" @click="lock(true)">锁定</el-button>
        <el-button size="small" plain :disabled="!selection.length || deleting" @click="lock(false)">解锁</el-button>
        <el-button size="small" type="danger" plain :disabled="!selection.length || deleting || !!openingId || loading"
          :loading="batchDeleting" @click="removeSelected">批量删除</el-button>
        <el-button size="small" type="primary" :disabled="!selection.length || deleting" @click="goPrint">去拼版打印</el-button>
      </div>
    </div>

    <div class="page-card">
      <el-table ref="invoiceTable" :data="list" v-loading="loading" border size="small" stripe @selection-change="(v) => selection = v">
        <el-table-column type="selection" width="44" />
        <el-table-column type="expand">
          <template #default="{ row }">
            <div style="padding:8px 16px">
              <div class="muted mb-12">购买方：{{ row.buyerName || '—' }} ｜ 税号 {{ row.buyerTaxId || '—' }} ｜ 备注 {{ row.remark || '—' }} ｜ 解析来源 {{ parseStatusLabel(row.parseStatus) }}</div>
              <div v-if="row.fundPurpose" class="mb-12">资金用途：{{ row.fundPurpose }}</div>
              <el-table :data="itemsMap[row.id] || []" size="small" border>
                <el-table-column type="index" label="#" width="46" />
                <el-table-column prop="name" label="项目名称" min-width="180" />
                <el-table-column prop="spec" label="规格" width="90" /><el-table-column prop="unit" label="单位" width="70" />
                <el-table-column prop="quantity" label="数量" width="80" /><el-table-column prop="unitPrice" label="单价" width="100" />
                <el-table-column prop="amount" label="金额" width="100" /><el-table-column prop="taxRate" label="税率" width="80" />
                <el-table-column prop="taxAmount" label="税额" width="100" />
                <template #empty>无明细行</template>
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="studentName" label="姓名" width="90" />
        <el-table-column prop="studentId" label="学号" width="120" />
        <el-table-column prop="invoiceNumber" label="发票号码" min-width="190" />
        <el-table-column prop="issueDate" label="开票日期" width="112" />
        <el-table-column prop="sellerName" label="销售方" min-width="160" show-overflow-tooltip />
        <el-table-column label="价税合计" width="112" align="right"><template #default="{ row }">{{ yuan(row.amountInclTax) }}</template></el-table-column>
        <el-table-column label="打印状态" width="100" align="center">
          <template #default="{ row }"><el-tag :type="row.printStatus ? 'success' : 'info'" size="small" effect="dark">{{ row.printStatus ? '已打印' : '未打印' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="报销状态" width="100" align="center">
          <template #default="{ row }"><el-tag :type="row.reimbursed ? 'success' : 'info'" size="small">{{ row.reimbursed ? '已报销' : '未报销' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="锁定" width="70" align="center"><template #default="{ row }"><span v-if="row.locked" style="color:#e6a23c">已锁定</span><span v-else class="muted">—</span></template></el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :disabled="!row.fileId" @click="api.openRaw(row.fileId, row.detectedType)">原件</el-button>
            <el-button link :type="row.reimbursed ? 'warning' : 'success'" size="small"
              :loading="reimbursementId === row.id" @click="toggleReimbursed(row)">{{ row.reimbursed ? '取消报销' : '标记报销' }}</el-button>
            <el-button link type="primary" size="small" :disabled="deleting" :loading="openingId === row.id" @click="openEdit(row)">修改</el-button>
            <el-button link type="danger" size="small" :disabled="!!openingId || deleting" :loading="deletingId === row.id" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination class="mt-12" background layout="total, prev, pager, next, sizes" :total="total"
        v-model:current-page="query.page" v-model:page-size="query.size" :page-sizes="[10, 20, 50, 100]" @change="load()" />
    </div>
    <el-dialog v-model="editVisible" title="修改发票" width="min(900px, 94vw)" destroy-on-close
      :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
      <InvoiceForm v-if="editDraft" :draft="editDraft" :policy="policy" show-purpose :readonly="saving" />
      <template #footer>
        <el-button :disabled="saving" @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import InvoiceForm from '../../components/InvoiceForm.vue';
import api from '../../api';
import { invoiceEditDraft, parseStatusLabel, yuan } from '../../utils/format';

const router = useRouter();
const list = ref([]), itemsMap = ref({}), total = ref(0);
const selection = ref([]), loading = ref(false), range = ref([]);
const summary = ref({ unprinted: 0, printed: 0, total: 0 });
const query = reactive({ q: '', name: '', studentId: '', seller: '', from: '', to: '', minAmount: '', maxAmount: '', status: '', page: 1, size: 20 });
const editVisible = ref(false), editDraft = ref(null), editId = ref(null);
const openingId = ref(null), deletingId = ref(null), saving = ref(false);
const batchDeleting = ref(false), invoiceTable = ref(null);
const reimbursementId = ref(null);
const deleting = computed(() => !!deletingId.value || batchDeleting.value);
const policy = ref(null);

async function load(page) {
  if (page) query.page = page;
  query.from = range.value?.[0] || ''; query.to = range.value?.[1] || '';
  loading.value = true;
  try {
    let r = await api.adminInvoices({ ...query, withItems: '1' });
    const lastPage = Math.max(1, Math.ceil(r.total / query.size));
    if (query.page > lastPage) {
      query.page = lastPage;
      r = await api.adminInvoices({ ...query, withItems: '1' });
    }
    list.value = r.list; itemsMap.value = r.items || {}; total.value = r.total;
    summary.value = await api.printStatusSummary();
  } finally { loading.value = false; }
}
function reset() {
  Object.assign(query, { q: '', name: '', studentId: '', seller: '', from: '', to: '', minAmount: '', maxAmount: '', status: '', page: 1, size: 20 });
  range.value = []; load();
}
function quickUnprinted() { query.status = 'unprinted'; load(1); }

async function openEdit(row) {
  if (openingId.value || deleting.value) return;
  openingId.value = row.id;
  try {
    const [detail, rule] = await Promise.all([api.getInvoice(row.id), api.getAmountPolicy()]);
    editDraft.value = invoiceEditDraft(detail);
    editId.value = detail.id;
    policy.value = rule;
    editVisible.value = true;
  } catch (_error) { /* API displays the error. */ }
  finally { openingId.value = null; }
}

async function saveEdit() {
  if (saving.value) return;
  const { invoice, items, sources, fundPurpose } = editDraft.value;
  saving.value = true;
  try {
    await api.updateInvoice(editId.value, { invoice, items, sources, fundPurpose });
    editVisible.value = false;
    ElMessage.success('发票已修改');
    await load();
  } catch (_error) { /* API displays the error. */ }
  finally { saving.value = false; }
}

async function remove(row) {
  if (deleting.value) return;
  deletingId.value = row.id;
  try {
    await ElMessageBox.confirm(`确定删除发票 ${row.invoiceNumber} 吗？删除后无法恢复。`, '删除发票', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    });
    await api.deleteInvoice(row.id);
    selection.value = selection.value.filter((item) => item.id !== row.id);
    ElMessage.success('发票已删除');
    await load();
  } catch (_error) { /* Cancelled or reported by API. */ }
  finally { deletingId.value = null; }
}

async function removeSelected() {
  if (deleting.value || !selection.value.length) return;
  const ids = selection.value.map((row) => row.id);
  batchDeleting.value = true;
  try {
    await ElMessageBox.confirm(`确定删除所选的 ${ids.length} 张发票吗？删除后无法恢复。`, '批量删除发票', {
      type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消'
    });
    const result = await api.batchDeleteInvoices(ids);
    invoiceTable.value?.clearSelection();
    ElMessage.success(`已删除 ${result.deleted} 张发票`);
    await load();
  } catch (_error) { /* Cancelled or reported by API. */ }
  finally { batchDeleting.value = false; }
}

async function toggleReimbursed(row) {
  if (reimbursementId.value) return;
  reimbursementId.value = row.id;
  try {
    const reimbursed = !row.reimbursed;
    await api.setInvoiceReimbursed(row.id, reimbursed);
    row.reimbursed = reimbursed;
    ElMessage.success(reimbursed ? '已标记为已报销' : '已取消报销标记');
  } catch (_error) { /* API displays the error. */ }
  finally { reimbursementId.value = null; }
}

async function mark(status) {
  const ids = selection.value.map((r) => r.id);
  await ElMessageBox.confirm(`确定将选中的 ${ids.length} 张发票标记为「${status ? '已打印' : '未打印'}」吗？此操作会写入操作日志。`, '二次确认', { type: 'warning' });
  const r = await api.markPrintStatus(ids, status);
  ElMessage.success(`已更新 ${r.updated} 张发票`);
  load();
}
async function lock(locked) {
  const ids = selection.value.map((r) => r.id);
  await ElMessageBox.confirm(`确定${locked ? '锁定' : '解锁'}选中的 ${ids.length} 张发票吗？锁定后学生不能修改或删除。`, '二次确认', { type: 'warning' });
  await api.setLocked(ids, locked); ElMessage.success('操作成功'); load();
}
function goPrint() {
  sessionStorage.setItem('print_ids', JSON.stringify(selection.value.map((r) => r.id)));
  sessionStorage.removeItem('print_batch_layout');
  router.push('/a/print');
}
function exportExcel() { api.exportExcel({ ...query }); }
onMounted(() => load());
</script>
