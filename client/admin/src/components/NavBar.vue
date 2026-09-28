<script setup>
// client/admin/src/components/NavBar.vue — the sidebar
//
// The logo and title, the pages, Help (the user guide at /admin/help), the project on GitHub, the
// version (on main, the Release's: "Version 0.8.0") with when this noticeboard installed it ("Last
// updated"), and Log out. Collapsible to icons, each named in its tooltip.
//
// Used by: App.vue
// Uses: useApi (GET /settings/version, POST /auth/logout), useBranding, useNav, NavIcon,
//   PROJECT_URL from @shared
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { PROJECT_URL } from '@shared/index.js';
import { api } from '../composables/useApi.js';
import { useBranding } from '../composables/useBranding.js';
import { useNav } from '../composables/useNav.js';
import NavIcon from './NavIcon.vue';

const router = useRouter();
const { logo, refreshLogo } = useBranding();
// Collapsed: icons only, each named in its tooltip
const { collapsed, toggle } = useNav();

// When this noticeboard installed the version it runs (the same time as "Last update" in
// Software updates), not when this page loaded. Without that, when the version was made.
const version = ref(null);
const dateTime = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const lastUpdated = computed(() => version.value && dateTime(version.value.installedAt || version.value.date));
// On main, the Release's version (SYSTEM_DESIGN §18.6) with its commit; else the commit
const versionTitle = computed(() => {
  const v = version.value;
  if (!v) return '';
  const commit = v.commit.slice(0, 7);
  return `Version ${v.version ? `${v.version} (${commit})` : commit}${v.branch ? ` from ${v.branch}` : ''}, made ${dateTime(v.date)}. Opens the project on GitHub.`;
});

onMounted(async () => {
  refreshLogo();
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
  <nav class="nav" :class="{ 'nav--collapsed': collapsed }">
    <button
      type="button"
      class="nav__toggle"
      :aria-label="collapsed ? 'Expand the menu' : 'Collapse the menu to icons'"
      :title="collapsed ? 'Expand the menu' : 'Collapse the menu to icons'"
      :aria-expanded="!collapsed"
      @click="toggle"
    >
      <NavIcon :name="collapsed ? 'expand' : 'collapse'" />
    </button>

    <div class="nav__brand">
      <img v-if="logo?.enabled" :src="logo.url" alt="" class="nav__logo" />
      <template v-if="!collapsed">
        Noticeboard
        <div class="nav__by">By <a :href="PROJECT_URL" target="_blank" rel="noopener">Fructus Sum</a></div>
      </template>
    </div>

    <RouterLink to="/slideshows" class="nav__link" title="Slideshows" aria-label="Slideshows">
      <NavIcon name="slideshows" /><span class="nav__label">Slideshows</span>
    </RouterLink>
    <RouterLink to="/audio" class="nav__link" title="Audio" aria-label="Audio">
      <NavIcon name="audio" /><span class="nav__label">Audio</span>
    </RouterLink>
    <RouterLink to="/settings" class="nav__link" title="Settings" aria-label="Settings">
      <NavIcon name="settings" /><span class="nav__label">Settings</span>
    </RouterLink>
    <!-- The user guide is a separate page served by the server; open it beside the admin -->
    <a href="/admin/help" target="_blank" rel="noopener" class="nav__link" title="Help (opens in a new tab)" aria-label="Help, opens in a new tab">
      <NavIcon name="help" /><span class="nav__label">Help ↗</span>
    </a>
    <!-- The slideshow viewer, as the screens show it; the admin stays open in this tab -->
    <a href="/" target="_blank" rel="noopener" class="nav__link" title="Open the slideshow viewer (display) in a new tab" aria-label="Open viewer, in a new tab">
      <NavIcon name="viewer" /><span class="nav__label">Open viewer ↗</span>
    </a>

    <div class="nav__spacer" />
    <a
      v-if="lastUpdated"
      :href="PROJECT_URL"
      target="_blank"
      rel="noopener"
      class="nav__updated"
      :title="collapsed ? `Last updated ${lastUpdated}. ${versionTitle}` : versionTitle"
      :aria-label="`${version.version ? `Version ${version.version}. ` : ''}Last updated ${lastUpdated}`"
    >
      <NavIcon v-if="collapsed" name="updated" />
      <template v-else><template v-if="version.version">Version {{ version.version }}<br></template>Last updated<br><span>{{ lastUpdated }}</span></template>
    </a>
    <button class="nav__logout" title="Log out" aria-label="Log out" @click="logout">
      <NavIcon name="logout" /><span class="nav__label">Log out</span>
    </button>
  </nav>
</template>

<style scoped>
.nav {
  background: var(--nav-bg);
  display: flex;
  flex-direction: column;
  padding: 8px 0 16px;
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  position: sticky;
  top: 0;
}

/* Expand / collapse, at the top of the menu */
.nav__toggle {
  align-self: flex-end;
  margin: 0 8px 4px;
  width: 36px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--nav-text);
  border-radius: var(--radius);
}
.nav__toggle:hover { background: #334155; color: var(--nav-active); }

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

.nav__logo {
  display: block;
  max-width: 100%;
  max-height: 96px;
  object-fit: contain;
  margin-bottom: 10px;
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
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 16px;
  color: var(--nav-text);
  text-decoration: none;
  font-size: 13px;
  border-radius: 0;
  white-space: nowrap;
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
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 7px 12px;
  background: transparent;
  color: var(--nav-text);
  border: 1px solid #334155;
  border-radius: var(--radius);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
}
.nav__logout:hover { background: #334155; color: var(--nav-active); }

/* Collapsed: a narrow column of icons, centred */
.nav--collapsed .nav__toggle { align-self: center; margin: 0 0 4px; }
.nav--collapsed .nav__brand { padding: 0 8px 12px; }
.nav--collapsed .nav__logo { max-height: 40px; margin: 0 auto; }
.nav--collapsed .nav__label { display: none; }
.nav--collapsed .nav__link { justify-content: center; padding: 10px 0; }
.nav--collapsed .nav__updated { display: flex; justify-content: center; margin: 0 0 10px; padding: 6px 0; color: var(--nav-text); }
.nav--collapsed .nav__logout { justify-content: center; margin: 0 8px 8px; padding: 7px 0; }
</style>
