<template>
  <div>
    <h3 class="page-title"><el-icon><User /></el-icon> 用户管理与操作日志</h3>
    <el-tabs v-model="tab">
      <el-tab-pane label="用户汇总" name="users">
        <div class="page-card">
          <div class="stat-grid mb-12">
            <div class="stat-card"><div class="k">学生人数</div><div class="v">{{ list.length }}</div></div>
            <div class="stat-card"><div class="k">发票总数</div><div class="v">{{ list.reduce((s, u) => s + u.count, 0) }}</div></div>
            <div class="stat-card"><div class="k">价税合计总额</div><div class="v">{{ yuan(list.reduce((s, u) => s + u.totalAmount, 0)) }}</div></div>
            <div class="stat-card"><div class="k">未打印</div><div class="v">{{ list.reduce((s, u) => s + u.unprinted, 0) }}</div></div>
          </div>
          <el-table :data="list" border size="small" stripe>
            <el-table-column prop="name" label="姓名" width="120" />
            <el-table-column prop="studentId" label="学号" width="150" />
            <el-table-column prop="count" label="发票数量" width="110" align="center" />
            <el-table-column label="价税合计金额" width="160" align="right"><template #default="{ row }"><b>{{ yuan(row.totalAmount) }}</b></template></el-table-column>
            <el-table-column prop="unprinted" label="未打印" width="100" align="center" />
            <el-table-column prop="printed" label="已打印" width="100" align="center" />
            <el-table-column prop="lastAt" label="最近上传" min-width="160" />
            <el-table-column prop="createdAt" label="注册时间" min-width="160" class-name="hide-on-mobile" />
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane label="用户管理" name="accounts">
        <div class="page-card">
          <el-button type="primary" class="mb-12" @click="openUser()">新增用户</el-button>
          <el-table :data="accounts" border size="small">
            <el-table-column prop="name" label="姓名" min-width="120" />
            <el-table-column label="角色" width="100">
              <template #default="{ row }">{{ row.role === 'admin' ? '管理员' : '学生' }}</template>
            </el-table-column>
            <el-table-column label="学号 / 账号" min-width="150">
              <template #default="{ row }">{{ row.studentId || row.username }}</template>
            </el-table-column>
            <el-table-column prop="lastLoginAt" label="最近登录" min-width="160" />
            <el-table-column label="操作" width="140">
              <template #default="{ row }">
                <el-button link type="primary" @click="openUser(row)">编辑</el-button>
                <el-button link type="danger" :disabled="row.id === store.user?.id" @click="removeUser(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane label="金额规则" name="policy">
        <div class="page-card">
          <el-form label-width="155px" :model="policy">
            <el-form-item label="资金用途阈值（元）">
              <el-input-number v-model="policy.purposeThreshold" :min="0" :precision="2" />
              <span class="muted policy-note">价税合计超过此金额时，学生必须填写资金用途。</span>
            </el-form-item>
            <el-form-item label="上传上限（元）">
              <el-input-number v-model="policy.maxAmount" :min="0" :precision="2" placeholder="留空表示不限" />
              <el-button v-if="policy.maxAmount != null" link @click="policy.maxAmount = null">取消上限</el-button>
              <span class="muted policy-note">价税合计超过此金额时，系统拒绝上传和提交。</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingPolicy" @click="savePolicy">保存金额规则</el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>

      <el-tab-pane label="操作日志" name="logs">
        <div class="page-card">
          <div class="muted mb-12" style="font-size:12px">所有打印状态变更、批次创建/撤销、锁定、导出、发票增删改均记录，可追溯。</div>
          <el-table :data="logs" border size="small" stripe max-height="620">
            <el-table-column prop="id" label="#" width="70" />
            <el-table-column prop="createdAt" label="时间" width="170" />
            <el-table-column prop="actorName" label="操作人" width="120" />
            <el-table-column prop="actorRole" label="角色" width="90" />
            <el-table-column prop="action" label="动作" width="180" />
            <el-table-column prop="targetType" label="对象" width="110" />
            <el-table-column label="详情"><template #default="{ row }"><span class="muted">{{ JSON.stringify(row.detail || '').slice(0, 180) }}</span></template></el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="userDialog" :title="form.id ? '编辑用户' : '新增用户'" width="min(440px, 92vw)">
      <el-form :model="form" label-width="85px" @submit.prevent="saveUser">
        <el-form-item label="角色">
          <el-select v-model="form.role" :disabled="!!form.id">
            <el-option label="学生" value="student" /><el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="姓名" required><el-input v-model="form.name" maxlength="30" /></el-form-item>
        <el-form-item v-if="form.role === 'student'" label="学号" required>
          <el-input v-model="form.studentId" maxlength="20" inputmode="numeric" />
        </el-form-item>
        <template v-else>
          <el-form-item label="账号" required><el-input v-model="form.username" maxlength="50" /></el-form-item>
          <el-form-item label="密码" :required="!form.id">
            <el-input v-model="form.password" type="password" show-password autocomplete="new-password"
              :placeholder="form.id ? '留空则保留原密码' : '设置登录密码'" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="userDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingUser" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../../api';
import { useUserStore } from '../../stores/user';
import { yuan } from '../../utils/format';

const tab = ref('accounts');
const list = ref([]), logs = ref([]), logsLoaded = ref(false);
const router = useRouter();
const store = useUserStore();
const accounts = ref([]);
const userDialog = ref(false), savingUser = ref(false), savingPolicy = ref(false);
const form = reactive({ id: null, role: 'student', name: '', studentId: '', username: '', password: '' });
const policy = reactive({ purposeThreshold: 200, maxAmount: null });

async function loadUsers() { list.value = (await api.userSummary()).list; }
async function loadLogs() { if (logsLoaded.value) return; logs.value = (await api.adminLogs()).list; logsLoaded.value = true; }
async function loadAccounts() { accounts.value = (await api.users()).list; }
async function loadPolicy() { Object.assign(policy, await api.getAmountPolicy()); }
watch(tab, (v) => {
  if (v === 'logs') loadLogs();
  if (v === 'accounts') loadAccounts();
  if (v === 'policy') loadPolicy();
});
onMounted(() => Promise.all([loadAccounts(), loadUsers()]));

function openUser(row) {
  Object.assign(form, {
    id: row?.id ?? null, role: row?.role || 'student', name: row?.name || '',
    studentId: row?.studentId || '', username: row?.username || '', password: ''
  });
  userDialog.value = true;
}

async function saveUser() {
  if (savingUser.value) return;
  savingUser.value = true;
  try {
    const original = accounts.value.find((row) => row.id === form.id);
    const data = { role: form.role, name: form.name, studentId: form.studentId, username: form.username, password: form.password };
    const updated = form.id ? await api.updateUser(form.id, data) : await api.createUser(data);
    userDialog.value = false;
    logsLoaded.value = false;
    if (updated.id === store.user?.id &&
      (data.password || updated.name !== original?.name || updated.username !== original?.username)) {
      store.logout();
      await router.push('/admin/login');
      ElMessage.success('登录信息已更新，请重新登录');
      return;
    }
    ElMessage.success('用户已保存');
    await Promise.all([loadAccounts(), loadUsers()]);
  } catch (_error) { /* API displays the error. */ }
  finally { savingUser.value = false; }
}

async function removeUser(row) {
  try {
    await ElMessageBox.confirm(`删除「${row.name}」后，该用户无法登录，历史发票会保留。确定删除吗？`, '删除用户', { type: 'warning' });
    await api.deleteUser(row.id);
    logsLoaded.value = false;
    ElMessage.success('用户已删除');
    await Promise.all([loadAccounts(), loadUsers()]);
  } catch (_error) { /* Cancelled or reported by API. */ }
}

async function savePolicy() {
  savingPolicy.value = true;
  try {
    Object.assign(policy, await api.setAmountPolicy({
      purposeThreshold: policy.purposeThreshold ?? null, maxAmount: policy.maxAmount ?? null
    }));
    logsLoaded.value = false;
    ElMessage.success('金额规则已保存');
  } catch (_error) { /* API displays the error. */ }
  finally { savingPolicy.value = false; }
}
</script>

<style scoped>
.policy-note { margin-left: 10px; }
</style>
