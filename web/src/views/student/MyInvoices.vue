<template>
  <div>
    <h3 class="page-title"><el-icon><List /></el-icon> 我的发票</h3>

    <div class="page-card mb-12">
      <div class="toolbar">
        <el-input v-model="query.q" placeholder="发票号码 / 销售方 / 购买方" clearable style="width:230px" @keyup.enter="load" />
        <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width:250px" />
        <el-select v-model="query.status" placeholder="打印状态" clearable style="width:130px">
          <el-option label="未打印" value="unprinted" /><el-option label="已打印" value="printed" />
        </el-select>
        <el-button type="primary" @click="load(1)">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
    </div>

    <div class="page-card">
      <el-table :data="list" v-loading="loading" border size="small" stripe
        :default-sort="{ prop: 'createdAt', order: 'descending' }" @sort-change="changeSort">
        <el-table-column prop="invoiceNumber" label="发票号码" min-width="190" sortable="custom" :sort-orders="sortOrders" />
        <el-table-column prop="issueDate" label="开票日期" width="115" sortable="custom" :sort-orders="sortOrders" />
        <el-table-column prop="sellerName" label="销售方" min-width="170" show-overflow-tooltip sortable="custom" :sort-orders="sortOrders" />
        <el-table-column prop="amountInclTax" label="价税合计" width="115" align="right" sortable="custom" :sort-orders="sortOrders">
          <template #default="{ row }"><b>{{ yuan(row.amountInclTax) }}</b></template>
        </el-table-column>
        <el-table-column prop="printStatus" label="打印状态" width="100" align="center" sortable="custom" :sort-orders="sortOrders">
          <template #default="{ row }">
            <el-tag :type="row.printStatus ? 'success' : 'info'" size="small" effect="dark">{{ row.printStatus ? '已打印' : '未打印' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="locked" label="锁定" width="70" align="center" sortable="custom" :sort-orders="sortOrders">
          <template #default="{ row }"><el-tag v-if="row.locked" type="warning" size="small">已锁定</el-tag><span v-else class="muted">—</span></template>
        </el-table-column>
        <el-table-column prop="createdAt" label="上传时间" width="160" class-name="hide-on-mobile" sortable="custom" :sort-orders="sortOrders" />
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="showDetail(row)">明细</el-button>
            <el-button link type="primary" size="small" :disabled="!row.fileId" @click="api.openRaw(row.fileId, row.detectedType)">原件</el-button>
            <el-button link type="primary" size="small" :disabled="!canEdit(row)" @click="openEdit(row)">修改</el-button>
            <el-button link type="danger" size="small" :disabled="!canEdit(row)" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>暂无发票，去「上传发票」添加吧</template>
      </el-table>
      <el-pagination class="mt-12" background layout="total, prev, pager, next, sizes" :total="total"
        v-model:current-page="query.page" v-model:page-size="query.size" :page-sizes="[10, 20, 50]" @change="load()" />
      <div class="muted mt-8" style="font-size:12px">已打印或被管理员锁定的发票禁止修改 / 删除；打印状态为学生端只读。</div>
    </div>

    <!-- 明细查看 -->
    <el-dialog v-model="detailVisible" title="发票明细" width="780px" destroy-on-close>
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="发票号码">{{ detail.invoiceNumber }}</el-descriptions-item>
          <el-descriptions-item label="开票日期">{{ detail.issueDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="购买方">{{ detail.buyerName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="购买方税号">{{ detail.buyerTaxId || '—' }}</el-descriptions-item>
          <el-descriptions-item label="销售方">{{ detail.sellerName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="销售方税号">{{ detail.sellerTaxId || '—' }}</el-descriptions-item>
          <el-descriptions-item label="合计金额(不含税)">{{ yuan(detail.amountExclTax) }}</el-descriptions-item>
          <el-descriptions-item label="合计税额">{{ yuan(detail.totalTax) }}</el-descriptions-item>
          <el-descriptions-item label="价税合计"><b>{{ yuan(detail.amountInclTax) }}</b></el-descriptions-item>
          <el-descriptions-item label="备注">{{ detail.remark || '—' }}</el-descriptions-item>
          <el-descriptions-item label="资金用途">{{ detail.fundPurpose || '—' }}</el-descriptions-item>
        </el-descriptions>
        <h4 style="margin:14px 0 8px">明细行</h4>
        <el-table :data="detail.items || []" border size="small">
          <el-table-column type="index" label="#" width="46" />
          <el-table-column prop="name" label="项目名称" min-width="180" />
          <el-table-column prop="spec" label="规格" width="90" /><el-table-column prop="unit" label="单位" width="70" />
          <el-table-column prop="quantity" label="数量" width="80" /><el-table-column prop="unitPrice" label="单价" width="100" />
          <el-table-column prop="amount" label="金额" width="100" /><el-table-column prop="taxRate" label="税率" width="80" />
          <el-table-column prop="taxAmount" label="税额" width="100" />
        </el-table>
        <div v-if="detail.warnings?.length" class="mt-12">
          <el-alert v-for="(w, i) in detail.warnings" :key="i" :title="warningText(w)" :type="w.level === 'error' ? 'error' : 'warning'" :closable="false" />
        </div>
      </template>
    </el-dialog>

    <!-- 修改（已打印/锁定不可进入） -->
    <el-dialog v-model="editVisible" title="修改发票" width="900px" destroy-on-close>
      <InvoiceForm v-if="editDraft" :draft="editDraft" :policy="policy" />
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button v-if="editFileId" :loading="reparsing" @click="reparseInEdit">按原件重新识别</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import InvoiceForm from '../../components/InvoiceForm.vue';
import api from '../../api';
import { invoiceEditDraft, warningText, yuan } from '../../utils/format';

const list = ref([]);
const total = ref(0);
const loading = ref(false);
const saving = ref(false);
const reparsing = ref(false);
const range = ref([]);
const query = reactive({ q: '', from: '', to: '', status: '', page: 1, size: 20, sortBy: 'createdAt', sortOrder: 'descending' });
const sortOrders = ['ascending', 'descending'];
const detailVisible = ref(false), detail = ref(null);
const editVisible = ref(false), editDraft = ref(null), editId = ref(null), editFileId = ref(null);
const policy = ref({ purposeThreshold: 200, maxAmount: null });

const canEdit = (row) => !row.printStatus && !row.locked;

async function load(page) {
  if (page) query.page = page;
  query.from = range.value?.[0] || '';
  query.to = range.value?.[1] || '';
  loading.value = true;
  try {
    const res = await api.getInvoices(query);
    list.value = res.list; total.value = res.total;
  } finally { loading.value = false; }
}
function changeSort({ prop, order }) {
  if (!prop || !order) return;
  query.sortBy = prop;
  query.sortOrder = order;
  load(1);
}
function reset() {
  Object.assign(query, { q: '', from: '', to: '', status: '', page: 1, size: 20 });
  range.value = []; load();
}
async function showDetail(row) {
  detail.value = await api.getInvoice(row.id);
  detailVisible.value = true;
}
async function openEdit(row) {
  const [d, rule] = await Promise.all([api.getInvoice(row.id), api.getAmountPolicy()]);
  policy.value = rule;
  editId.value = row.id;
  editFileId.value = d.fileId;
  editDraft.value = invoiceEditDraft(d);
  editVisible.value = true;
}
/** 已提交的发票也能用最新解析规则重识别原件，然后一键保存修正 */
async function reparseInEdit() {
  reparsing.value = true;
  try {
    const r = await api.reparse(editFileId.value);
    editDraft.value = {
      parseStatus: r.parseStatus, invoice: r.invoice, items: r.items,
      sources: r.sources, warnings: r.warnings, qrMismatch: r.qrMismatch,
      fundPurpose: editDraft.value.fundPurpose, recognizedTotal: r.recognizedTotal
    };
    ElMessage.success('已按原件重新识别，请核对后点「保存修改」');
  } catch (_e) { /* 拦截器已提示 */ }
  finally { reparsing.value = false; }
}
async function saveEdit() {
  if (!editDraft.value.invoice.invoiceNumber) { ElMessage.error('发票号码必填'); return; }
  saving.value = true;
  try {
    await api.updateInvoice(editId.value, {
      invoice: editDraft.value.invoice, items: editDraft.value.items,
      sources: editDraft.value.sources, warnings: editDraft.value.warnings, fundPurpose: editDraft.value.fundPurpose
    });
    ElMessage.success('保存成功'); editVisible.value = false; load();
  } catch (_e) { /* 拦截器已提示 */ }
  finally { saving.value = false; }
}
async function remove(row) {
  await ElMessageBox.confirm(`确定删除发票 ${row.invoiceNumber} 吗？此操作不可恢复。`, '删除确认', { type: 'warning' });
  await api.deleteInvoice(row.id);
  ElMessage.success('已删除'); load();
}
onMounted(() => load());
</script>
