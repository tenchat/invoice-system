<template>
  <div>
    <h3 class="page-title"><el-icon><Files /></el-icon> 打印批次历史</h3>
    <div class="page-card">
      <div class="flex-between mb-12">
        <span class="muted">每个批次记录时间、操作人、张数与版式参数；撤销后该批发票恢复到此前的打印状态。</span>
        <el-button size="small" type="primary" plain @click="router.push('/a/print')">新建拼版打印</el-button>
      </div>
      <el-table :data="list" v-loading="loading" border size="small" stripe>
        <el-table-column prop="id" label="批次号" width="90" />
        <el-table-column prop="createdAt" label="打印时间" width="170" />
        <el-table-column prop="operatorName" label="操作人" width="130" />
        <el-table-column prop="count" label="张数" width="80" align="center" />
        <el-table-column label="报销进度" width="110" align="center">
          <template #default="{ row }">{{ row.reimbursedCount }}/{{ row.invoiceCount }} 张</template>
        </el-table-column>
        <el-table-column label="版式" min-width="220"><template #default="{ row }">{{ row.layoutText }}</template></el-table-column>
        <el-table-column label="触发" width="100"><template #default="{ row }"><el-tag size="small" effect="plain">{{ row.action === 'export' ? '导出PDF' : '打印' }}</el-tag></template></el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag :type="row.undone ? 'info' : 'success'" size="small">{{ row.undone ? '已撤销' : '有效' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="undoneAt" label="撤销时间" width="170" />
        <el-table-column label="操作" width="370" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="showItems(row)">查看发票</el-button>
            <el-button link type="primary" size="small" @click="reprint(row)">重新打印该批次</el-button>
            <el-button link :type="isBatchReimbursed(row) ? 'warning' : 'success'" size="small"
              :disabled="row.undone || !row.invoiceCount || reimbursementBatchId === row.id"
              :loading="reimbursementBatchId === row.id" @click="toggleBatchReimbursed(row)">
              {{ isBatchReimbursed(row) ? '取消整批报销' : '整批标记已报销' }}
            </el-button>
            <el-button link type="danger" size="small" :disabled="row.undone" @click="undo(row)">撤销批次</el-button>
          </template>
        </el-table-column>
        <template #empty>暂无打印批次</template>
      </el-table>
    </div>

    <el-dialog v-model="visible" :title="`批次 #${current?.id} 内发票（${items.length}）`" width="900px" destroy-on-close>
      <p v-if="current && items.length < current.count" class="muted">该批次原有 {{ current.count }} 张发票，其中 {{ current.count - items.length }} 张已删除。</p>
      <p v-if="current" class="muted">报销进度：{{ current.reimbursedCount }}/{{ current.invoiceCount }} 张</p>
      <el-table :data="items" border size="small" max-height="520">
        <el-table-column prop="studentName" label="姓名" width="100" />
        <el-table-column prop="studentId" label="学号" width="130" />
        <el-table-column prop="invoiceNumber" label="发票号码" min-width="190" />
        <el-table-column prop="issueDate" label="开票日期" width="112" />
        <el-table-column prop="sellerName" label="销售方" min-width="150" show-overflow-tooltip />
        <el-table-column label="价税合计" width="110" align="right"><template #default="{ row }">{{ yuan(row.amountInclTax) }}</template></el-table-column>
        <el-table-column label="打印状态" width="100" align="center"><template #default="{ row }"><el-tag size="small" :type="row.printStatus ? 'success' : 'info'">{{ row.printStatus ? '已打印' : '未打印' }}</el-tag></template></el-table-column>
        <el-table-column label="报销状态" width="100" align="center"><template #default="{ row }"><el-tag size="small" :type="row.reimbursed ? 'success' : 'info'">{{ row.reimbursed ? '已报销' : '未报销' }}</el-tag></template></el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../../api';
import { yuan } from '../../utils/format';

const router = useRouter();
const list = ref([]), items = ref([]), loading = ref(false);
const visible = ref(false), current = ref(null);
const reimbursementBatchId = ref(null);

async function load() {
  loading.value = true;
  try { list.value = (await api.batches()).list; }
  finally { loading.value = false; }
}
async function showItems(row) {
  current.value = row;
  items.value = (await api.batchInvoices(row.id)).list;
  visible.value = true;
}
function isBatchReimbursed(row) {
  return row.invoiceCount > 0 && row.reimbursedCount === row.invoiceCount;
}
async function toggleBatchReimbursed(row) {
  if (reimbursementBatchId.value || row.undone || !row.invoiceCount) return;
  const reimbursed = !isBatchReimbursed(row);
  try {
    await ElMessageBox.confirm(
      `确定将批次 #${row.id} 中的 ${row.invoiceCount} 张发票${reimbursed ? '标记为已报销' : '取消已报销标记'}吗？`,
      '批量更新报销状态', { type: 'warning' }
    );
  } catch (_error) { return; }
  reimbursementBatchId.value = row.id;
  try {
    const result = await api.setBatchReimbursed(row.id, reimbursed);
    ElMessage.success(`已更新 ${result.updated} 张发票`);
    await load();
    if (visible.value && current.value?.id === row.id) {
      current.value = list.value.find((batch) => batch.id === row.id) || row;
      items.value = (await api.batchInvoices(row.id)).list;
    }
  } catch (_error) { /* API displays the error. */ }
  finally { reimbursementBatchId.value = null; }
}
async function reprint(row) {
  try {
    const { list: available } = await api.batchInvoices(row.id);
    if (!available.length) {
      ElMessage.warning('该批次已无可重新打印的发票');
      return;
    }
    if (available.length < row.count) ElMessage.info(`该批次有 ${row.count - available.length} 张发票已删除`);
    sessionStorage.setItem('print_ids', JSON.stringify(available.map((invoice) => invoice.id)));
    sessionStorage.setItem('print_batch_layout', JSON.stringify({ ...row.layout, sortBy: 'manual' }));
    router.push('/a/print');
  } catch (_error) { /* API displays the error. */ }
}
async function undo(row) {
  await ElMessageBox.confirm(
    `确定撤销批次 #${row.id} 吗？该批次内 ${row.count} 张发票将恢复为此前的打印状态（通常为未打印）。`,
    '撤销批次（二次确认）', { type: 'warning' }
  );
  const r = await api.undoBatch(row.id);
  ElMessage.success(`已撤销，恢复 ${r.restored} 张发票状态`);
  load();
}
onMounted(load);
</script>
