<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import NavBar from './components/NavBar.vue';

const route = useRoute();
const showNav = computed(() => route.path !== '/login');
</script>

<template>
  <div class="layout" :class="{ 'layout--with-nav': showNav }">
    <NavBar v-if="showNav" />
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style>
:root {
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --danger: #dc2626;
  --danger-hover: #b91c1c;
  --success: #16a34a;
  --surface: #ffffff;
  --surface-2: #f3f4f6;
  --border: #e5e7eb;
  --text: #111827;
  --text-muted: #6b7280;
  --nav-bg: #1e293b;
  --nav-text: #cbd5e1;
  --nav-active: #ffffff;
  --radius: 6px;
  --font: system-ui, -apple-system, sans-serif;
}

*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font);
  font-size: 14px;
  color: var(--text);
  background: var(--surface-2);
}

.layout {
  min-height: 100vh;
}

.layout--with-nav {
  display: grid;
  grid-template-columns: 200px 1fr;
}

.main {
  padding: 24px;
  min-height: 100vh;
  overflow-y: auto;
}

h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 20px; }
h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 12px; }

button {
  cursor: pointer;
  border: none;
  border-radius: var(--radius);
  padding: 7px 14px;
  font-size: 13px;
  font-family: var(--font);
  font-weight: 500;
  transition: background 0.15s;
}

.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { background: var(--primary-hover); }
.btn-danger  { background: var(--danger);  color: #fff; }
.btn-danger:hover  { background: var(--danger-hover); }
.btn-ghost   { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
.btn-ghost:hover { background: var(--surface-2); }

input, select {
  font-family: var(--font);
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 7px 10px;
  width: 100%;
  background: var(--surface);
  color: var(--text);
}
input:focus, select:focus { outline: 2px solid var(--primary); outline-offset: -1px; }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  margin-bottom: 16px;
}

.error-msg { color: var(--danger); font-size: 13px; margin-top: 6px; }
.success-msg { color: var(--success); font-size: 13px; margin-top: 6px; }

label { display: block; font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 4px; }

.field { margin-bottom: 14px; }

.badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  font-weight: 500;
}
.badge--processing { background: #fef3c7; color: #92400e; }
.badge--error      { background: #fee2e2; color: #991b1b; }
.badge--ready      { background: #dcfce7; color: #166534; }
</style>
