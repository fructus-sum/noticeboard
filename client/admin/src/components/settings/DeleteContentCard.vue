<script setup>
// client/admin/src/components/settings/DeleteContentCard.vue — the Settings card "Delete content"
//
// Responsibilities
//   Delete All: every slideshow except the sample, with its slides and files. The warning lists
//   exactly what goes (each slideshow and its slides) and what stays, then the admin password and
//   a last chance (ConfirmDangerDialogs); POST /settings/maintenance/delete-all does it.
//
// Used by: views/SettingsView
// Uses: useApi (GET /slideshows, /settings/maintenance/…), useFlash, FlashMessage, CollapsibleCard,
//   ConfirmDangerDialogs
import { ref, computed } from 'vue';
import { api } from '../../composables/useApi.js';
import { useFlash } from '../../composables/useFlash.js';
import FlashMessage from '../ui/FlashMessage.vue';
import CollapsibleCard from '../ui/CollapsibleCard.vue';
import ConfirmDangerDialogs from '../ui/ConfirmDangerDialogs.vue';

const msg = useFlash();
const loading = ref(false);
const toDelete = ref([]);          // the slideshows Delete All would delete: { name, slideCount }
const confirmSteps = ref(null);

const slideTotal = computed(() => toDelete.value.reduce((n, s) => n + (s.slideCount ?? 0), 0));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function startDeleteAll() {
  msg.clear();
  loading.value = true;
  try {
    const all = await api.get('/slideshows');
    toDelete.value = all.filter((s) => !s.sample);
    if (!toDelete.value.length) {
      msg.ok('There is nothing to delete: only the sample slideshow is left.', 4000);
      return;
    }
    confirmSteps.value.open();
  } catch (e) {
    msg.error(e.message);
  } finally {
    loading.value = false;
  }
}

const verify = async (password) =>
  (await api.post('/settings/maintenance/verify-password', { password, action: 'delete-all' })).token;
const deleteAll = (token) => api.post('/settings/maintenance/delete-all', { token });

function deleted({ deleted: names }) {
  msg.ok(`Deleted ${plural(names.length, 'slideshow')}. The sample slideshow and your settings are unchanged.`, 6000);
}
</script>

<template>
  <CollapsibleCard title="Delete content" name="settings-delete">
    <p class="muted">
      <strong>Delete All</strong> deletes every slideshow except the sample, with all their slides and files.
      The sample slideshow, your settings, logo and background colour are kept. It can't be undone.
    </p>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <button class="btn-danger" :disabled="loading" @click="startDeleteAll">{{ loading ? 'Checking…' : 'Delete All…' }}</button>
      <FlashMessage :flash="msg" />
    </div>
  </CollapsibleCard>

  <ConfirmDangerDialogs
    ref="confirmSteps"
    id-prefix="delete-all"
    title="Delete all your slideshows?"
    :verify="verify"
    :confirm="deleteAll"
    cancel-label="Cancel, keep them"
    confirm-label="Confirm, delete them all"
    busy-label="Deleting…"
    @cancelled="(note) => msg.ok(note, 4000)"
    @failed="(message) => msg.error(message)"
    @done="deleted"
  >
    <p>
      These {{ plural(toDelete.length, 'slideshow') }}, with {{ plural(slideTotal, 'slide') }} and their files,
      will be deleted:
    </p>
    <ul class="warnings">
      <li v-for="s in toDelete" :key="s.folder"><strong>{{ s.name }}</strong> ({{ plural(s.slideCount ?? 0, 'slide') }})</li>
    </ul>
    <p>
      <strong>This can't be undone.</strong> Kept: the sample slideshow, your settings, the logo and the background
      colour. Screens stop showing the deleted slideshows straight away.
    </p>

    <template #final>
      <p>
        Your password checked out, so the only thing between your {{ plural(toDelete.length, 'slideshow') }} and the
        bin is you and this button.
      </p>
      <p>This is your last chance to back out:</p>
      <ul class="choices">
        <li><strong>Cancel</strong> leaves everything exactly as it is.</li>
        <li><strong>Confirm</strong> deletes them and their files now. There's no way to get them back.</li>
      </ul>
    </template>
  </ConfirmDangerDialogs>
</template>

<style scoped>
.muted { color: var(--text-muted); font-size: 13px; margin-bottom: 12px; line-height: 1.5; }
</style>
