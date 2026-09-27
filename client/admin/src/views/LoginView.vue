<script setup>
// client/admin/src/views/LoginView.vue — the login page (/admin/login)
//
// A wrong password or "too many tries" shows on the page, never as a redirect; with no answer from
// the server, "Could not reach server". Once logged in: the slideshows.
// Used by: router/index.js
// Uses: useApi (POST /auth/login with redirectOn401: false)
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../composables/useApi.js';

const router = useRouter();
const password = ref('');
const error = ref('');
const loading = ref(false);

async function login() {
  error.value = '';
  loading.value = true;
  try {
    // A wrong password is a 401 here: shown on this page, never a redirect
    await api.post('/auth/login', { password: password.value }, { redirectOn401: false });
    router.push('/slideshows');
  } catch (e) {
    // An answer from the server (wrong password, too many tries), or no answer at all
    error.value = e.status ? (e.serverMessage || 'Login failed') : 'Could not reach server';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card">
      <h1>Noticeboard Admin</h1>
      <form @submit.prevent="login">
        <div class="field">
          <label for="pw">Password</label>
          <input
            id="pw"
            v-model="password"
            type="password"
            autocomplete="current-password"
            autofocus
            required
          />
        </div>
        <p v-if="error" class="error-msg">{{ error }}</p>
        <button type="submit" class="btn-primary" :disabled="loading" style="width:100%;margin-top:4px">
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2);
}
.login-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 32px;
  width: 100%;
  max-width: 340px;
}
h1 { font-size: 1.1rem; margin-bottom: 20px; }
</style>
