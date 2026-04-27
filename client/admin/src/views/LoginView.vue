<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const password = ref('');
const error = ref('');
const loading = ref(false);

async function login() {
  error.value = '';
  loading.value = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    });
    const data = await res.json();
    if (!res.ok) {
      error.value = data.error || 'Login failed';
    } else {
      router.push('/slideshows');
    }
  } catch {
    error.value = 'Could not reach server';
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
