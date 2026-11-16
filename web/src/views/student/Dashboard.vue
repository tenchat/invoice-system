<template>
  <div>
    <h3 class="page-title"><el-icon><DataLine /></el-icon> 我的发票统计</h3>
    <div class="stat-grid mb-12">
      <div class="stat-card"><div class="k">发票总数</div><div class="v">{{ stats.total }}</div></div>
      <div class="stat-card"><div class="k">价税合计总额</div><div class="v">{{ yuan(stats.totalAmount) }}</div></div>
      <div class="stat-card"><div class="k">本月新增</div><div class="v">{{ stats.thisMonth }}</div></div>
      <div class="stat-card"><div class="k">覆盖月份</div><div class="v">{{ (stats.monthly || []).length }}</div></div>
    </div>
    <div class="page-card">
      <h4 style="margin:0 0 10px">按月金额（价税合计）</h4>
      <div ref="chartEl" style="width:100%;height:340px"></div>
      <div v-if="!(stats.monthly || []).length" class="muted" style="text-align:center;margin-top:-200px">暂无数据</div>
      <el-table :data="stats.monthly || []" size="small" border class="mt-12" style="max-width:520px">
        <el-table-column prop="m" label="月份" /><el-table-column prop="c" label="发票数" />
        <el-table-column label="金额"><template #default="{ row }">{{ yuan(row.amount) }}</template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, nextTick } from 'vue';
import * as echarts from 'echarts';
import api from '../../api';
import { yuan } from '../../utils/format';

const stats = ref({ total: 0, totalAmount: 0, thisMonth: 0, monthly: [] });
const chartEl = ref();
let chart = null;
const onResize = () => chart?.resize();

onMounted(async () => {
  stats.value = await api.getStats();
  await nextTick();
  chart = echarts.init(chartEl.value);
  const monthly = stats.value.monthly || [];
  chart.setOption({
    tooltip: { trigger: 'axis', valueFormatter: (v) => `¥${Number(v).toFixed(2)}` },
    grid: { left: 60, right: 24, top: 30, bottom: 40 },
    xAxis: { type: 'category', data: monthly.map((m) => m.m), axisLabel: { color: '#606266' } },
    yAxis: { type: 'value', name: '金额(¥)', splitLine: { lineStyle: { color: '#eef0f4' } } },
    series: [{
      name: '价税合计', type: 'line', smooth: true, symbolSize: 8, data: monthly.map((m) => Number(m.amount || 0)),
      itemStyle: { color: '#2f5597' }, lineStyle: { width: 3 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(47,85,151,.28)' }, { offset: 1, color: 'rgba(47,85,151,.02)' }]) },
      label: { show: true, formatter: (p) => `¥${Number(p.value).toFixed(0)}`, fontSize: 11 }
    }]
  });
  window.addEventListener('resize', onResize);
});
onUnmounted(() => { window.removeEventListener('resize', onResize); chart?.dispose(); });
</script>
