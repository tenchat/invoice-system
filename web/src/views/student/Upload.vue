<template>
  <div>
    <h3 class="page-title"><el-icon><Upload /></el-icon> 上传数电发票</h3>

    <div class="page-card mb-12">
      <el-upload ref="uploadRef" v-model:file-list="fileList" drag multiple :auto-upload="false"
        :limit="10" accept=".xml,.pdf,.jpg,.jpeg,.png" :on-change="onChange" :on-exceed="onExceed">
        <el-icon class="el-icon--upload" :size="40"><UploadFilled /></el-icon>
        <div class="el-upload__text">拖拽文件到此处，或 <em>点击选择</em></div>
        <template #tip>
          <div class="muted" style="font-size:12px">
            仅支持电子发票（XML / PDF / JPG / PNG），可多选，单文件 ≤ 10MB，一次最多 10 个。
          </div>
        </template>
      </el-upload>
      <div class="toolbar mt-12">
        <el-button type="primary" :loading="parsing" :disabled="!fileList.length" @click="doParse">
          解析选中文件（{{ fileList.length }}）
        </el-button>
        <el-button @click="addBlank">手动录入空白发票</el-button>
        <el-button :disabled="!drafts.length" @click="clearAll">清空草稿</el-button>
      </div>
    </div>

    <el-row :gutter="12">
      <el-col :xs="24" :sm="24" :md="6" :lg="5">
        <div class="page-card">
          <div class="flex-between mb-12"><b>待确认草稿 ({{ pendingCount }})</b></div>
          <div v-if="!drafts.length" class="muted" style="padding:12px 0">暂无草稿</div>
          <div v-for="(d, i) in drafts" :key="d.key" class="draft-item" :class="{ active: i === activeIndex, done: d.submitted }"
            @click="activeIndex = i">
            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              {{ d.submitted ? '✅ ' : '' }}{{ d.fileName }}
            </div>
            <div class="muted" style="font-size:12px">
              {{ d.error ? '识别失败 · 手动录入' : `${parseStatusLabel(d.parseStatus)} · ${d.items?.length || 0} 行明细` }}
              <el-tag v-if="d.qrMismatch?.length" type="danger" size="small" effect="plain">待核对</el-tag>
            </div>
          </div>
        </div>
      </el-col>

      <el-col :xs="24" :sm="24" :md="18" :lg="19">
        <div v-if="current" class="page-card">
          <div class="flex-between mb-12">
            <b>识别结果（可逐项修改补填）</b>
            <div class="toolbar">
              <el-button v-if="current.fileId" size="small" :loading="reparsing" @click="reparseCurrent">重新解析</el-button>
              <el-button v-if="current.fileId && current.previewUrl" size="small" @click="openPreview">查看版式图</el-button>
              <el-button size="small" @click="removeDraft(activeIndex)">移除草稿</el-button>
              <el-button type="primary" :loading="submitting" :disabled="current.submitted" @click="submitCurrent">
                {{ current.submitted ? '已提交' : '确认提交' }}
              </el-button>
            </div>
          </div>
          <InvoiceForm :key="current.key" :draft="current" :policy="policy" :readonly="current.submitted" />
        </div>
        <div v-else class="page-card muted">上传文件后在此确认识别结果，或点击「手动录入空白发票」。</div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import InvoiceForm from '../../components/InvoiceForm.vue';
import api from '../../api';
import { parseStatusLabel } from '../../utils/format';

const fileList = ref([]);
const drafts = ref([]);
const activeIndex = ref(0);
const parsing = ref(false);
const submitting = ref(false);
const reparsing = ref(false);
const uploadRef = ref();
const policy = ref({ purposeThreshold: 200, maxAmount: null });
let seq = 0;

const current = computed(() => drafts.value[activeIndex.value] || null);
const pendingCount = computed(() => drafts.value.filter((d) => !d.submitted).length);
onMounted(async () => { policy.value = await api.getAmountPolicy(); });

function onChange(file, list) {
  const f = file.raw;
  if (f && f.size > 10 * 1024 * 1024) {
    ElMessage.error(`${f.name} 超过 10MB，已忽略`);
    fileList.value = list.filter((x) => x.uid !== file.uid);
  }
}
function onExceed() { ElMessage.warning('一次最多上传 10 个文件'); }

function blankDraft(fileName = '手动录入') {
  return {
    key: `d${++seq}`, fileName, fileId: null, parseStatus: 'manual',
    invoice: {}, items: [], sources: { invoice: {}, items: [] },
    qr: null, qrMismatch: [], warnings: [], errors: [], submitted: false, error: null
  };
}
function addBlank() {
  drafts.value.push(blankDraft(`手动录入 #${seq + 1}`));
  activeIndex.value = drafts.value.length - 1;
}

async function doParse() {
  if (!fileList.value.length) return;
  parsing.value = true;
  const fd = new FormData();
  for (const f of fileList.value) if (f.raw) fd.append('files', f.raw);
  try {
    const res = await api.parseFiles(fd);
    for (const r of res.results) {
      if (r.blocked) {
        ElMessage.error({ message: `${r.fileName}：${r.error}`, duration: 6500 });
        continue;
      }
      drafts.value.push({ ...r, key: `d${++seq}`, submitted: false });
      if (r.error) ElMessage.warning(`${r.fileName}：${r.error}（已降级为手动录入）`);
    }
    fileList.value = [];
    uploadRef.value?.clearFiles();
    activeIndex.value = drafts.value.findIndex((d) => !d.submitted);
    if (activeIndex.value < 0) activeIndex.value = 0;
    const accepted = res.results.filter((r) => !r.blocked).length;
    if (accepted) ElMessage.success(`已生成 ${accepted} 份草稿，请确认后提交`);
  } catch (_e) { /* 拦截器已提示 */ }
  finally { parsing.value = false; }
}

/** 用最新解析规则重跑已上传原件；会覆盖当前草稿的手工修改，故二次确认 */
async function reparseCurrent() {
  const d = current.value;
  if (!d?.fileId) return;
  try {
    await ElMessageBox.confirm('将按最新解析规则重新识别该原件，当前草稿中已修改的内容会被覆盖。是否继续？', '重新解析', { type: 'warning' });
  } catch (_e) { return; }
  reparsing.value = true;
  try {
    const r = await api.reparse(d.fileId);
    const idx = drafts.value.findIndex((item) => item.key === d.key);
    if (idx >= 0) drafts.value[idx] = { ...r, key: d.key, submitted: d.submitted, fundPurpose: d.fundPurpose };
    ElMessage.success(r.qrMismatch?.length ? '已重新识别，请核对标记的字段' : '已重新识别');
  } catch (_e) { /* 拦截器已提示 */ }
  finally { reparsing.value = false; }
}

async function submitCurrent() {
  const d = current.value;
  if (!d || d.submitted) return;
  if (!d.invoice?.invoiceNumber) { ElMessage.error('发票号码为必填项，请补填（20 位）'); return; }
  if (d.warnings?.length) {
    try {
      await ElMessageBox.confirm(`存在 ${d.warnings.length} 条校验提示，仍要提交吗？（校验不通过不会阻止提交）`, '提交确认', { type: 'warning' });
    } catch (_e) { return; }
  }
  submitting.value = true;
  try {
    await api.createInvoice({
      fileId: d.fileId, invoice: d.invoice, items: d.items, sources: d.sources,
      warnings: d.warnings, parseStatus: d.parseStatus, fundPurpose: d.fundPurpose
    });
    d.submitted = true;
    ElMessage.success('提交成功');
    const next = drafts.value.findIndex((x) => !x.submitted);
    if (next >= 0) activeIndex.value = next;
  } catch (_e) { /* 拦截器已提示，草稿保留 */ }
  finally { submitting.value = false; }
}

function removeDraft(i) {
  drafts.value.splice(i, 1);
  if (activeIndex.value >= drafts.value.length) activeIndex.value = Math.max(0, drafts.value.length - 1);
}
function clearAll() {
  ElMessageBox.confirm('清空全部未提交草稿？', '提示').then(() => {
    drafts.value = []; activeIndex.value = 0;
  }).catch(() => {});
}
function openPreview() {
  window.open(api.previewUrl(current.value.fileId), '_blank');
}
</script>

<style scoped>
.draft-item { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; cursor: pointer; }
.draft-item:hover { border-color: #9db4dc; }
.draft-item.active { border-color: var(--brand); background: #f2f6fd; }
.draft-item.done { opacity: .6; }
</style>

