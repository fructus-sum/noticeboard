// client/admin/src/router/index.js — the admin panel's pages and its login check
//
// Provides
//   the router, under /admin/: /login, /slideshows (/ goes there), /slideshows/:folder, /audio,
//   /audio/:folder, /settings.
//   Every page but /login needs a login (GET /auth/status, which never redirects by itself, so it
//   can't loop). A link with #id (e.g. /settings#password) scrolls to that element.
//
// Used by: main.js
// Uses: useApi, the views
import { createRouter, createWebHistory } from 'vue-router';
import { api } from '../composables/useApi.js';
import LoginView from '../views/LoginView.vue';
import SlideshowsView from '../views/SlideshowsView.vue';
import SlideshowDetailView from '../views/SlideshowDetailView.vue';
import SettingsView from '../views/SettingsView.vue';
import AudioShowsView from '../views/AudioShowsView.vue';
import AudioShowDetailView from '../views/AudioShowDetailView.vue';

const routes = [
  { path: '/login', component: LoginView, meta: { public: true } },
  { path: '/', redirect: '/slideshows' },
  { path: '/slideshows', component: SlideshowsView },
  { path: '/slideshows/:folder', component: SlideshowDetailView },
  { path: '/audio', component: AudioShowsView },
  { path: '/audio/:folder', component: AudioShowDetailView },
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
