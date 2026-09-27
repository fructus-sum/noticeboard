<script setup>
import { onMounted } from 'vue';
import { useSecurity } from '../composables/useSecurity.js';

// Shown on every admin page while the admin password is still the one every installation
// starts with. It goes away once the password has been changed.
const { defaultPassword, refreshSecurity } = useSecurity();

onMounted(refreshSecurity);
</script>

<template>
  <div v-if="defaultPassword" class="warning" role="alert">
    <span class="warning__icon" aria-hidden="true">⚠</span>
    <div>
      <strong>This noticeboard still uses the default admin password.</strong>
      Anyone on your network who knows it can change what's on your screens.
      <RouterLink to="/settings#password">Change the password</RouterLink> in Settings.
    </div>
  </div>
</template>

<style scoped>
.warning {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 16px;
  margin-bottom: 16px;
  border-radius: var(--radius);
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  font-size: 13px;
  line-height: 1.5;
}
.warning__icon { font-size: 16px; line-height: 1.3; }
.warning a { color: #991b1b; font-weight: 600; }
</style>
