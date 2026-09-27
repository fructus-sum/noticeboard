<script setup>
import { ref, computed, onMounted } from 'vue';
import { installerCommand } from '@shared/index.js';
import { api } from '../composables/useApi.js';

// Updates can't change what only the installer sets up (kiosk scripts, system services, desktop
// shortcuts), so when this version needs a newer installer run than the Pi had, say so here.
// It stays until the installer has been run: there's nothing to close.
const status = ref(null);
const copied = ref(false);

const command = computed(() => installerCommand(status.value?.branch));

onMounted(async () => {
  try {
    status.value = await api.get('/settings/updates/installer');
  } catch {
    // Optional: the page works without it
  }
});

async function copy() {
  try {
    await navigator.clipboard.writeText(command.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // No clipboard (e.g. not https): the command can still be selected and copied by hand
  }
}
</script>

<template>
  <div v-if="status?.needed" class="installer" role="alert">
    <strong>Run the installer again on this Pi</strong>
    <p>
      This version of the noticeboard needs something that only the installer sets up, and updates can't do that
      by themselves. Until it's run, what's listed here stays as it was:
    </p>
    <ul v-if="status.changes.length">
      <li v-for="c in status.changes" :key="c">{{ c }}</li>
    </ul>
    <p>
      In a terminal on the server Pi, or over SSH, run the command below. It keeps your answers, slideshows and
      settings, and offers to restart at the end.
    </p>
    <div class="installer__command">
      <code>{{ command }}</code>
      <button type="button" class="btn-ghost" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
    </div>
    <p v-if="status.displays">Run it on each remote display Pi as well (choose "Remote display" there).</p>
    <p class="installer__more">
      This goes away once the installer has run.
      <a href="/admin/help#installer-needed" target="_blank" rel="noopener">More in Help ↗</a>
    </p>
  </div>
</template>

<style scoped>
.installer {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 16px;
  font-size: 13px;
  color: #92400e;
}
.installer p { margin-top: 6px; line-height: 1.5; }
.installer ul { margin: 6px 0 0 18px; line-height: 1.5; }
.installer__command {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.installer__command code {
  flex: 1 1 260px;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
  background: #fff;
  border: 1px solid #fde68a;
  border-radius: 4px;
  padding: 6px 8px;
  color: #422006;
}
.installer__command button { flex: none; font-size: 12px; padding: 5px 12px; }
.installer__more { font-size: 12px; }
.installer__more a { color: inherit; }
</style>
