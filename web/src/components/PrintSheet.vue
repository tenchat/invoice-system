<template>
  <div class="print-stage">
    <div v-for="(page, pi) in pages" :key="pi" class="a4-page" :style="pageStyle">
      <div v-for="row in page" :key="`${row.id}-${row.page}`" class="inv-cell">
        <div class="inv-img" :style="{ width: (layout.scale || 100) + '%' }">
          <img :src="row.previewSrc" :alt="`发票 ${row.invoiceNumber} 第 ${row.page} 页`"
            @load="$emit('source-ready', row.previewSrc)" @error="$emit('source-error', row.previewSrc)" />
        </div>
        <div v-if="layout.printNameId" class="inv-caption">
          {{ row.studentName || '—' }} · {{ row.studentId || '—' }} · {{ row.invoiceNumber }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

defineEmits(['source-ready', 'source-error']);

const props = defineProps({
  list: { type: Array, default: () => [] },
  layout: { type: Object, required: true }
});

const landscape = computed(() => props.layout.orientation === 'landscape');
const pageW = computed(() => (landscape.value ? 297 : 210));
const pageH = computed(() => (landscape.value ? 210 : 297));

/** 每页 1/2/3/4 张：纵向按行叠放，横向按列排开，4 张用 2×2 */
const grid = computed(() => {
  const n = Number(props.layout.perPage) || 2;
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return landscape.value ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  if (n === 3) return landscape.value ? { cols: 3, rows: 1 } : { cols: 1, rows: 3 };
  return { cols: 2, rows: 2 };
});

const pages = computed(() => {
  const size = Math.max(1, Number(props.layout.perPage) || 2);
  const out = [];
  for (let i = 0; i < props.list.length; i += size) out.push(props.list.slice(i, i + size));
  return out;
});

const pageStyle = computed(() => ({
  width: `${pageW.value}mm`,
  height: `${pageH.value}mm`,
  padding: `${Number(props.layout.marginTop) || 0}mm ${Number(props.layout.marginRight) || 0}mm ${Number(props.layout.marginBottom) || 0}mm ${Number(props.layout.marginLeft) || 0}mm`,
  gridTemplateColumns: `repeat(${grid.value.cols}, minmax(0, 1fr))`,
  gridTemplateRows: `repeat(${grid.value.rows}, minmax(0, 1fr))`,
  columnGap: `${Number(props.layout.gapX) || 0}mm`,
  rowGap: `${Number(props.layout.gapY) || 0}mm`
}));

</script>

<style scoped>
.inv-img { min-height: 0; flex: 1; margin: 0 auto; }
.inv-img img { width: 100%; height: 100%; object-fit: contain; object-position: top center; }
.inv-caption { flex: 0 0 14pt; margin: 0; font-size: 7.33pt; line-height: 14pt; white-space: nowrap; }
</style>

