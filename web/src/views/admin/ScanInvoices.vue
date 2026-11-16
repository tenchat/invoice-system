<template>
  <div>
    <h3 class="page-title">发票扫描</h3>
    <div class="page-card" v-loading="loading">
      <div class="toolbar mb-12">
        <el-select v-model="filter" style="width:140px" aria-label="扫描状态">
          <el-option label="全部发票" value="all" />
          <el-option label="未扫描" value="unscanned" />
          <el-option label="已扫描" value="scanned" />
        </el-select>
        <span class="muted">已扫描 {{ scannedCount }} / {{ invoices.length }}</span>
        <el-button @click="load">刷新</el-button>
      </div>
      <template v-if="current">
        <div class="toolbar mb-12">
          <el-button :disabled="index === 0 || saving" @click="index--">上一张</el-button>
          <span>{{ index + 1 }} / {{ visible.length }}</span>
          <el-button :disabled="index >= visible.length - 1 || saving" @click="index++">下一张</el-button>
          <el-button :type="current.scanStatus ? 'success' : 'primary'" :loading="saving" @click="mark">
            {{ current.scanStatus ? '撤销已扫描' : '标记已扫描' }}
          </el-button>
        </div>
        <div class="mb-12">
          {{ current.studentName || '—' }} · {{ current.studentId || '—' }} · {{ current.invoiceNumber }} · {{ yuan(current.amountInclTax) }}
          <el-tag :type="current.scanStatus ? 'success' : 'info'">{{ current.scanStatus ? '已扫描' : '未扫描' }}</el-tag>
        </div>
        <div v-if="previewSrc && !previewFailed" class="preview">
          <img :key="previewSrc" :src="previewSrc" alt="发票原件" @error="previewFailed = true" />
        </div>
        <el-alert v-else type="warning" :closable="false" title="该发票无法显示原件，请查看原文件。" />
        <el-button v-if="current.fileId" class="mt-12" @click="api.openRaw(current.fileId, current.detectedType)">查看原文件</el-button>
      </template>
      <el-empty v-else description="没有符合条件的发票" />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../../api';
import { yuan } from '../../utils/format';

const invoices = ref([]), index = ref(0), filter = ref('all');
const loading = ref(false), saving = ref(false), previewFailed = ref(false);
const visible = computed(() => invoices.value.filter((row) =>
  filter.value === 'all' || row.scanStatus === (filter.value === 'scanned')));
const current = computed(() => visible.value[index.value]);
const scannedCount = computed(() => invoices.value.filter((row) => row.scanStatus).length);
const previewSrc = computed(() => {
  const row = current.value;
  if (!row?.fileId || !['pdf', 'jpg', 'png'].includes(row.detectedType)) return null;
  return api.printSourceUrl(row.fileId, row.detectedType, 1);
});
watch(filter, () => { index.value = 0; });
watch(previewSrc, () => { previewFailed.value = false; });

async function load() {
  loading.value = true;
  try {
    const first = await api.adminInvoices({ size: 200 });
    const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / 200) - 1) },
      (_, i) => api.adminInvoices({ size: 200, page: i + 2 })));
    invoices.value = [first, ...rest].flatMap((page) => page.list);
    index.value = Math.min(index.value, Math.max(0, visible.value.length - 1));
  } finally { loading.value = false; }
}

async function mark() {
  const row = current.value;
  if (!row || saving.value) return;
  saving.value = true;
  try {
    const result = await api.setScanStatus(row.id, !row.scanStatus);
    row.scanStatus = result.scanned;
    if (index.value >= visible.value.length) index.value = Math.max(0, visible.value.length - 1);
    ElMessage.success(result.scanned ? '已标记为已扫描' : '已撤销扫描标记');
  } finally { saving.value = false; }
}
onMounted(load);
</script>

<style scoped>
.preview { background: #eef1f5; padding: 12px; overflow: auto; text-align: center; }
.preview img { max-width: 100%; max-height: 68vh; object-fit: contain; }
</style>
