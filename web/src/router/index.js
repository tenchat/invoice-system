import { createRouter, createWebHistory } from 'vue-router';
import AppLayout from '../layouts/AppLayout.vue';
import Login from '../views/Login.vue';
import Upload from '../views/student/Upload.vue';
import MyInvoices from '../views/student/MyInvoices.vue';
import Dashboard from '../views/student/Dashboard.vue';
import AllInvoices from '../views/admin/AllInvoices.vue';
import UserSummary from '../views/admin/UserSummary.vue';
import PrintLayout from '../views/admin/PrintLayout.vue';
import PrintBatches from '../views/admin/PrintBatches.vue';
import ScanInvoices from '../views/admin/ScanInvoices.vue';
import Budget from '../views/Budget.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login, meta: { public: true, mode: 'student' } },
    { path: '/admin/login', component: Login, meta: { public: true, mode: 'admin' } }, // 管理员独立入口
    {
      path: '/', component: AppLayout, redirect: '/s/upload',
      children: [
        { path: '/s/upload', component: Upload, meta: { role: 'student', title: '上传发票' } },
        { path: '/s/invoices', component: MyInvoices, meta: { role: 'student', title: '我的发票' } },
        { path: '/s/dashboard', component: Dashboard, meta: { role: 'student', title: '统计' } },
        { path: '/s/budget', component: Budget, meta: { role: 'student', title: '预算使用' } },
        { path: '/a/invoices', component: AllInvoices, meta: { role: 'admin', title: '全部发票' } },
        { path: '/a/users', component: UserSummary, meta: { role: 'admin', title: '用户管理' } },
        { path: '/a/print', component: PrintLayout, meta: { role: 'admin', title: '拼版打印' } },
        { path: '/a/batches', component: PrintBatches, meta: { role: 'admin', title: '打印批次' } },
        { path: '/a/scan', component: ScanInvoices, meta: { role: 'admin', title: '发票扫描' } },
        { path: '/a/budget', component: Budget, meta: { role: 'admin', title: '预算使用' } }
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
});

router.beforeEach((to) => {
  if (to.meta.public) return true;
  let user = null;
  try { user = JSON.parse(localStorage.getItem('inv_user') || 'null'); } catch (_e) { /* ignore */ }
  const token = localStorage.getItem('inv_token');
  if (!token || !user) return '/login';
  if (to.meta.role && user.role !== to.meta.role) return user.role === 'admin' ? '/a/invoices' : '/s/upload';
  return true;
});

export default router;

