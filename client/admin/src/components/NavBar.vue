<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { PROJECT_URL } from '@shared/constants.js';
import { api } from '../composables/useApi.js';

const router = useRouter();

// When the installed version was made (its commit date), not when this page loaded
const version = ref(null);
const lastUpdated = computed(() => version.value
  && new Date(version.value.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
const versionTitle = computed(() => version.value
  && `Version ${version.value.commit.slice(0, 7)}${version.value.branch ? ` from ${version.value.branch}` : ''}. Opens the project on GitHub.`);

onMounted(async () => {
  try {
    version.value = (await api.get('/settings/version'))?.version ?? null;
  } catch {
    // Without it the sidebar works as before
  }
});

async function logout() {
  await api.post('/auth/logout').catch(() => {});
  router.push('/login');
}
</script>

<template>
  <nav class="nav">
    <div class="nav__brand">
      Noticeboard
      <div class="nav__by">By <a :href="PROJECT_URL" target="_blank" rel="noopener">Fructus Sum</a></div>
    </div>
    <RouterLink to="/slideshows" class="nav__link">Slideshows</RouterLink>
    <RouterLink to="/settings"   class="nav__link">Settings</RouterLink>
    <!-- The user guide is a separate page served by the server; open it beside the admin -->
    <a href="/admin/help" target="_blank" rel="noopener" class="nav__link">Help ↗</a>
    <div class="nav__spacer" />
    <a v-if="lastUpdated" :href="PROJECT_URL" target="_blank" rel="noopener" class="nav__updated" :title="versionTitle">
      Last updated<br><span>{{ lastUpdated }}</span>
    </a>
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

.nav__by {
  margin-top: 4px;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
  color: var(--nav-text);
}
.nav__by a { color: var(--nav-text); text-decoration: underline; }
.nav__by a:hover { color: var(--nav-active); }

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

.nav__updated {
  display: block;
  margin: 0 12px 10px;
  padding: 0 2px;
  font-size: 11px;
  line-height: 1.5;
  color: #94a3b8;
  text-decoration: none;
}
.nav__updated span { color: var(--nav-text); }
.nav__updated:hover, .nav__updated:hover span { color: var(--nav-active); text-decoration: underline; }

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
