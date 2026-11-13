<template>
  <div>
    <header class="app-header no-print">
      <div class="brand">
        <el-icon><Document /></el-icon>
        <span>数电发票系统</span>
        <el-tag size="small" :type="isAdmin ? 'danger' : 'primary'" effect="plain">{{ isAdmin ? '管理员端' : '学生端' }}</el-tag>
      </div>
      <div class="app-user">
        <span class="hide-on-mobile">{{ store.displayName }}<span v-if="!isAdmin" class="muted"> ({{ store.user?.studentId }})</span></span>
        <el-button size="small" @click="doLogout">退出登录</el-button>
      </div>
    </header>

    <div class="app-body">
      <aside class="app-aside no-print">
        <el-menu :default-active="route.path" router :mode="isMobile ? 'horizontal' : 'vertical'">
          <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
            <el-icon><component :is="m.icon" /></el-icon>
            <span>{{ m.title }}</span>
          </el-menu-item>
        </el-menu>
      </aside>
      <main class="app-main"><router-view /></main>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '../stores/user';

const route = useRoute();
const router = useRouter();
const store = useUserStore();
const isAdmin = computed(() => store.isAdmin);
const isMobile = ref(window.innerWidth <= 768);
const onResize = () => { isMobile.value = window.innerWidth <= 768; };
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));

const menus = computed(() => isAdmin.value ? [
  { path: '/a/invoices', title: '全部发票', icon: 'Tickets' },
  { path: '/a/scan', title: '发票扫描', icon: 'View' },
  { path: '/a/budget', title: '预算使用', icon: 'PieChart' },
  { path: '/a/print', title: '拼版打印', icon: 'Printer' },
  { path: '/a/batches', title: '打印批次', icon: 'Files' },
  { path: '/a/users', title: '用户管理', icon: 'User' }
] : [
  { path: '/s/upload', title: '上传发票', icon: 'Upload' },
  { path: '/s/invoices', title: '我的发票', icon: 'List' },
  { path: '/s/budget', title: '预算使用', icon: 'PieChart' },
  { path: '/s/dashboard', title: '统计', icon: 'DataLine' }
]);

function doLogout() {
  const wasAdmin = store.isAdmin;
  store.logout();
  router.push(wasAdmin ? '/admin/login' : '/login');
}
</script>

