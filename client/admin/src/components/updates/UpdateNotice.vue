<script setup>
// client/admin/src/components/updates/UpdateNotice.vue — a notice from the updater
//
// E.g. the branch this noticeboard followed was merged into main, so it went back to main
// (data/update-notice.json). It stays, for every admin, until someone closes it.
// Used by: views/SlideshowsView
// Uses: useApi (GET and DELETE /settings/updates/notice)
import { ref, onMounted } from 'vue';
import { api } from '../../composables/useApi.js';

const notice = ref(null);
const closing = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    notice.value = (await api.get('/settings/updates/notice'))?.notice ?? null;
  } catch {
    // Optional: the page works without it
  }
});

async function close() {
  closing.value = true;
  error.value = '';
  try {
    await api.del('/settings/updates/notice');
    notice.value = null;
  } catch (e) {
    error.value = `Couldn't close the notice: ${e.message}`;
  } finally {
    closing.value = false;
  }
}
</script>

<template>
  <div v-if="notice" class="notice" role="status">
    <div class="notice__body">
      <strong>{{ notice.type === 'branch-merged' ? 'This noticeboard is back on main' : 'Software update' }}</strong>
      <p>{{ notice.message }}</p>
      <p class="notice__when">{{ new Date(notice.time).toLocaleString() }} · details in Settings → Software updates</p>
      <p v-if="error" class="error-msg">{{ error }}</p>
    </div>
    <button class="notice__close" :disabled="closing" aria-label="Close this notice" title="Close" @click="close">✕</button>
  </div>
</template>

<style scoped>
.notice {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 16px;
  font-size: 13px;
  color: #1e3a8a;
}
.notice__body { flex: 1; }
.notice__body p { margin-top: 4px; line-height: 1.5; }
.notice__when { color: #3b5bab; font-size: 12px; }
.notice__close {
  flex: none;
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  color: #1e3a8a;
  font-size: 15px;
}
.notice__close:hover { background: #dbeafe; }
</style>
