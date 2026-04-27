import { createRouter, createWebHistory } from 'vue-router';
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
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  try {
    const res = await fetch('/api/auth/status', { credentials: 'include' });
    const { authenticated } = await res.json();
    if (!authenticated) return '/login';
  } catch {
    return '/login';
  }
  return true;
});

export default router;
