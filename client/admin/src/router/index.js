import { createRouter, createWebHistory } from 'vue-router';
import { api } from '../composables/useApi.js';
import LoginView from '../views/LoginView.vue';
import SlideshowsView from '../views/SlideshowsView.vue';
import SlideshowDetailView from '../views/SlideshowDetailView.vue';
import SettingsView from '../views/SettingsView.vue';

const routes = [
  { path: '/login', component: LoginView, meta: { public: true } },
  { path: '/', redirect: '/slideshows' },
  { path: '/slideshows', component: SlideshowsView },
  { path: '/slideshows/:folder', component: SlideshowDetailView },
  { path: '/settings', component: SettingsView },
];

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes,
  // e.g. /settings#password (from the default-password warning) scrolls to that card
  scrollBehavior(to) {
    if (to.hash) return new Promise((resolve) => setTimeout(() => resolve({ el: to.hash, top: 16 }), 100));
    return { top: 0 };
  },
});

// Every page but the login page needs a login. The check never redirects by itself, so it can't
// loop: it only answers where to go.
router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  try {
    const status = await api.get('/auth/status', { redirectOn401: false });
    if (!status?.authenticated) return '/login';
  } catch {
    return '/login';
  }
  return true;
});

export default router;
