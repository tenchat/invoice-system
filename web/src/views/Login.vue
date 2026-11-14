<template>
  <div class="login-wrap">
    <el-card class="login-card" shadow="always">
      <div style="text-align:center">
        <h2 style="color:#2f5597;margin:4px 0 2px">数电发票收集与拼版打印系统</h2>
        <p class="muted" style="margin:0 0 20px">{{ isAdmin ? '管理员入口' : '请使用管理员登记的姓名和学号登录' }}</p>
      </div>

      <el-form :model="form" label-position="top" @keyup.enter="submit">
        <template v-if="!isAdmin">
          <el-form-item label="姓名"><el-input v-model="form.name" placeholder="请输入真实姓名" size="large" /></el-form-item>
          <el-form-item label="学号"><el-input v-model="form.studentId" placeholder="6-20 位数字学号" size="large" /></el-form-item>
        </template>
        <template v-else>
          <el-form-item label="管理员账号"><el-input v-model="form.username" placeholder="账号" size="large" /></el-form-item>
          <el-form-item label="密码"><el-input v-model="form.password" type="password" show-password placeholder="密码" size="large" /></el-form-item>
        </template>
        <el-button type="primary" size="large" style="width:100%" :loading="loading" @click="submit">登 录</el-button>
      </el-form>

      <div style="text-align:center;margin-top:16px">
        <el-link v-if="!isAdmin" type="info" @click="router.push('/admin/login')">管理员入口 →</el-link>
        <el-link v-else type="info" @click="router.push('/login')">← 返回学生登录</el-link>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '../api';
import { useUserStore } from '../stores/user';

const route = useRoute();
const router = useRouter();
const store = useUserStore();
const isAdmin = computed(() => route.meta.mode === 'admin');
const loading = ref(false);
const form = reactive({ name: '', studentId: '', username: '', password: '' });

async function submit() {
  loading.value = true;
  try {
    const res = isAdmin.value
      ? await api.adminLogin({ username: form.username, password: form.password })
      : await api.studentLogin({ name: form.name, studentId: form.studentId });
    store.setSession(res.token, res.user);
    ElMessage.success(`欢迎，${res.user.name}`);
    router.push(res.user.role === 'admin' ? '/a/invoices' : '/s/upload');
  } catch (e) { /* http 拦截器已提示 */ }
  finally { loading.value = false; }
}
</script>

<style scoped>
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px;
  background: linear-gradient(135deg, #eef3fb 0%, #f7f9fc 60%, #e8eef8 100%); }
.login-card { width: 420px; max-width: 100%; border-radius: 14px; padding: 12px; }
@media (max-width: 480px) { .login-card { padding: 4px; } }
</style>
