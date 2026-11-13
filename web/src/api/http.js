import axios from 'axios';
import { ElMessage } from 'element-plus';

const http = axios.create({ baseURL: '/api', timeout: 120000 });

http.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('inv_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

http.interceptors.response.use(
  (res) => res.data,
  async (err) => {
    let msg = err.response?.data?.message || err.message || '请求失败';
    if (err.response?.data instanceof Blob) {
      try { msg = JSON.parse(await err.response.data.text()).message || msg; }
      catch (_error) { msg = '文件下载失败，请重试'; }
    }
    if (err.response?.status === 401 && !/\/auth\/(?:admin|student)\/login$/.test(err.config?.url || '')) {
      const loginPath = location.pathname.startsWith('/a/') ? '/admin/login' : '/login';
      localStorage.removeItem('inv_token');
      localStorage.removeItem('inv_user');
      msg = '登录已失效，请重新登录';
      if (location.pathname !== loginPath) {
        setTimeout(() => { location.href = loginPath; }, 800);
      }
    }
    ElMessage.error(msg);
    return Promise.reject(new Error(msg));
  }
);

export default http;
export const authToken = () => localStorage.getItem('inv_token') || '';

