<script setup>
// client/admin/src/App.vue — the admin panel's frame: the sidebar (not on the login page), the default-password warning, the page
// Used by: main.js
// Uses: NavBar, DefaultPasswordWarning, useNav (the collapsed sidebar), the router's page
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import NavBar from './components/NavBar.vue';
import DefaultPasswordWarning from './components/DefaultPasswordWarning.vue';
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
      <RouterView />
    </main>
  </div>
</template>
