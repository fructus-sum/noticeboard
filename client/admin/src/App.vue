<script setup>
// client/admin/src/App.vue — the admin panel's frame: the sidebar, the warnings, the page
//
// On every page but the login page: the sidebar, the default-password warning and the updater's
// notices ("back on main", "Run the installer again on the Server"). The frame stays while moving
// between pages, so a notice is the same on every page, and closing one closes it everywhere.
// Used by: main.js
// Uses: NavBar, DefaultPasswordWarning, updates/UpdateNotice, updates/InstallerNotice, settings/RestartNotice,
//   updates/UpdateAvailableNotice, useNav (the
//   collapsed sidebar), the router's page
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import NavBar from './components/NavBar.vue';
import DefaultPasswordWarning from './components/DefaultPasswordWarning.vue';
import UpdateNotice from './components/updates/UpdateNotice.vue';
import InstallerNotice from './components/updates/InstallerNotice.vue';
import RestartNotice from './components/settings/RestartNotice.vue';
import UpdateAvailableNotice from './components/updates/UpdateAvailableNotice.vue';
import { useNav } from './composables/useNav.js';

const route = useRoute();
const { collapsed } = useNav();
const showNav = computed(() => route.path !== '/login');
</script>

<template>
  <div class="layout" :class="{ 'layout--with-nav': showNav, 'layout--nav-collapsed': showNav && collapsed }">
    <NavBar v-if="showNav" />
    <main class="main">
      <DefaultPasswordWarning v-if="showNav" />
      <div v-if="showNav" class="page-notices">
        <UpdateNotice />
        <InstallerNotice />
        <RestartNotice />
        <UpdateAvailableNotice />
      </div>
      <RouterView />
    </main>
  </div>
</template>
