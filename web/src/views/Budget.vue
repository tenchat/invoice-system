<template>
  <div>
    <h3 class="page-title">预算使用情况</h3>
    <div class="page-card mb-12" v-loading="loading">
      <div v-if="store.isAdmin" class="toolbar mb-12">
        <span>预算上限</span>
        <el-input-number v-model="limitInput" :min="0" :precision="2" aria-label="预算上限" />
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="k">预算上限</div><div class="v">{{ data.limit === null ? '未设置' : yuan(data.limit) }}</div></div>
        <div class="stat-card"><div class="k">已使用</div><div class="v">{{ yuan(data.spent) }}</div></div>
        <div class="stat-card"><div class="k">{{ data.remaining !== null && data.remaining < 0 ? '超出预算' : '剩余预算' }}</div>
          <div class="v">{{ data.remaining === null ? '—' : yuan(Math.abs(data.remaining)) }}</div></div>
      </div>
      <p class="muted">按已提交发票的价税合计统计。</p>
    </div>
    <div class="page-card">
      <h4>预算分布</h4>
      <div ref="chartEl" style="height:360px;width:100%"></div>
      <el-table :data="data.users" border size="small">
        <el-table-column prop="name" label="姓名" min-width="120" />
        <el-table-column prop="studentId" label="学号" min-width="130" />
        <el-table-column prop="count" label="发票数" width="100" />
        <el-table-column label="已使用金额" min-width="140"><template #default="{ row }">{{ yuan(row.amount) }}</template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import api from '../api';
import { useUserStore } from '../stores/user';
import { yuan } from '../utils/format';

const store = useUserStore();
const data = ref({ limit: null, spent: 0, remaining: null, users: [] });
const limitInput = ref(null), loading = ref(false), saving = ref(false), chartEl = ref();
let chart;
const resize = () => chart?.resize();

function renderChart() {
  const segments = data.value.users.filter((user) => user.amount > 0).map((user) => ({
    name: `${user.name}（${user.studentId || user.id}）`, value: user.amount
  }));
  if (data.value.remaining > 0) segments.push({ name: '剩余预算', value: data.value.remaining });
  chart.setOption({
    tooltip: { trigger: 'item', valueFormatter: (value) => yuan(value) },
    legend: { type: 'scroll', bottom: 0 },
    series: [{ type: 'pie', radius: ['40%', '68%'], center: ['50%', '45%'], data: segments,
      label: { formatter: '{b}: {d}%' }, stillShowZeroSum: false }]
  });
}
async function load() {
  loading.value = true;
  try {
    data.value = await api.getBudget();
    limitInput.value = data.value.limit;
    await nextTick();
    renderChart();
  } finally { loading.value = false; }
}
async function save() {
  if (limitInput.value === null || limitInput.value === undefined) { ElMessage.warning('请输入预算上限'); return; }
  saving.value = true;
  try { await api.setBudget(limitInput.value); await load(); ElMessage.success('预算上限已保存'); }
  finally { saving.value = false; }
}
onMounted(async () => {
  chart = echarts.init(chartEl.value);
  window.addEventListener('resize', resize);
  await load();
});
onUnmounted(() => { window.removeEventListener('resize', resize); chart?.dispose(); });
</script>

