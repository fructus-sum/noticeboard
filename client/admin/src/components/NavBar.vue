<script setup>
import { useRouter } from 'vue-router';
import { api } from '../composables/useApi.js';

const router = useRouter();

async function logout() {
  await api.post('/auth/logout').catch(() => {});
  router.push('/login');
}
</script>

<template>
  <nav class="nav">
    <div class="nav__brand">Noticeboard</div>
    <RouterLink to="/slideshows" class="nav__link">Slideshows</RouterLink>
    <RouterLink to="/settings"   class="nav__link">Settings</RouterLink>
    <div class="nav__spacer" />
    <button class="nav__logout" @click="logout">Log out</button>
  </nav>
</template>

<style scoped>
.nav {
  background: var(--nav-bg);
  display: flex;
  flex-direction: column;
  padding: 16px 0;
  min-height: 100vh;
  position: sticky;
  top: 0;
}

.nav__brand {
  font-size: 13px;
  font-weight: 700;
  color: var(--nav-active);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 0 16px 20px;
  border-bottom: 1px solid #334155;
  margin-bottom: 8px;
}

.nav__link {
  display: block;
  padding: 9px 16px;
  color: var(--nav-text);
  text-decoration: none;
  font-size: 13px;
  border-radius: 0;
  transition: background 0.1s, color 0.1s;
}
.nav__link:hover          { background: #334155; color: var(--nav-active); }
.nav__link.router-link-active { background: #334155; color: var(--nav-active); font-weight: 600; }

.nav__spacer { flex: 1; }

.nav__logout {
  margin: 0 12px 8px;
  padding: 7px 12px;
  background: transparent;
  color: var(--nav-text);
  border: 1px solid #334155;
  border-radius: var(--radius);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.nav__logout:hover { background: #334155; color: var(--nav-active); }
</style>
