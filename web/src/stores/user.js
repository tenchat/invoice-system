import { defineStore } from 'pinia';

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('inv_token') || '',
    user: (() => { try { return JSON.parse(localStorage.getItem('inv_user') || 'null'); } catch (_e) { return null; } })()
  }),
  getters: {
    isAdmin: (s) => s.user?.role === 'admin',
    displayName: (s) => s.user?.name || '未登录'
  },
  actions: {
    setSession(token, user) {
      this.token = token; this.user = user;
      localStorage.setItem('inv_token', token);
      localStorage.setItem('inv_user', JSON.stringify(user));
    },
    logout() {
      this.token = ''; this.user = null;
      localStorage.removeItem('inv_token');
      localStorage.removeItem('inv_user');
    }
  }
});
