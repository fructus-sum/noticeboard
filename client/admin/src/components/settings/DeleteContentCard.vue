<script setup>
// client/admin/src/components/settings/DeleteContentCard.vue — the Settings card "Delete content"
//
// Responsibilities
//   Delete All: every slideshow except the sample, with its slides and files. The warning lists
//   exactly what goes (each slideshow and its slides) and what stays, then the admin password and
//   a last chance (ConfirmDangerDialogs); POST /settings/maintenance/delete-all does it.
//   Restore Defaults (SYSTEM_DESIGN §14 D42): as if newly installed on the branch this noticeboard
//   follows. The warning lists everything that's reset and kept, the port and password going back
//   to their defaults, and recommends running the installer afterwards (with its command);
//   POST /settings/maintenance/restore-defaults asks for it. The page then waits for the server to
//   come back and goes to the login page (the restore logs everyone out). It needs the updater
//   (GET /settings/updates): without it the button says why it can't.
//
// Used by: views/SettingsView
// Uses: useApi (GET /slideshows, /settings/updates, /auth/status, /settings/maintenance/…),
//   useFlash, FlashMessage, CollapsibleCard, ConfirmDangerDialogs; installerCommand from @shared
import { ref, computed, onUnmounted } from 'vue';
import { installerCommand } from '@shared/index.js';
import { api } from '../../composables/useApi.js';
import { useFlash } from '../../composables/useFlash.js';
import FlashMessage from '../ui/FlashMessage.vue';
import CollapsibleCard from '../ui/CollapsibleCard.vue';
import ConfirmDangerDialogs from '../ui/ConfirmDangerDialogs.vue';

const msg = useFlash();
const loading = ref(false);
const toDelete = ref([]);          // the slideshows Delete All would delete: { name, slideCount }
const confirmDelete = ref(null);
const confirmRestore = ref(null);
const updates = ref(null);         // GET /settings/updates, for Restore Defaults
const restoring = ref(false);

const slideTotal = computed(() => toDelete.value.reduce((n, s) => n + (s.slideCount ?? 0), 0));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const branch = computed(() => updates.value?.configuredBranch || 'main');

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
    confirmDelete.value.open();
  } catch (e) {
    msg.error(e.message);
  } finally {
    loading.value = false;
  }
}

const verifyFor = (action) => async (password) =>
  (await api.post('/settings/maintenance/verify-password', { password, action })).token;
const deleteAll = (token) => api.post('/settings/maintenance/delete-all', { token });

function deleted({ deleted: names }) {
  msg.ok(`Deleted ${plural(names.length, 'slideshow')}. The sample slideshow and your settings are unchanged.`, 6000);
}

// Restore Defaults
async function startRestore() {
  msg.clear();
  loading.value = true;
  try {
    updates.value = await api.get('/settings/updates');
    if (!updates.value.available || !(updates.value.autoUpdates || updates.value.instant)) {
      msg.error(updates.value.reason || "Restore Defaults reinstalls the software through the updater, which isn't set up on this noticeboard. Run the installer on the Pi to set it up.");
      return;
    }
    if (updates.value.busy) {
      msg.error('An update is in progress. Wait for it to finish, then try again.');
      return;
    }
    confirmRestore.value.open();
  } catch (e) {
    msg.error(e.message);
  } finally {
    loading.value = false;
  }
}

const restore = (token) => api.post('/settings/maintenance/restore-defaults', { token });

// The server restarts, resets everything and logs everyone out: wait for it, then log in again
let pollTimer = null;
function restoreStarted() {
  restoring.value = true;
  let seenDown = false;
  pollTimer = setInterval(async () => {
    try {
      const status = await api.get('/auth/status', { redirectOn401: false });
      if (seenDown || status?.authenticated === false) {
        clearInterval(pollTimer);
        window.location.href = '/admin/login';
      }
    } catch {
      seenDown = true;   // restarting
    }
  }, 3000);
}
onUnmounted(() => clearInterval(pollTimer));
</script>

<template>
  <CollapsibleCard title="Delete content" name="settings-delete" :attention="restoring">
    <div v-if="restoring" class="restoring" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <div>
        <strong>Restoring defaults…</strong>
        <div class="muted">
          The noticeboard is reinstalling {{ branch }} and will restart as if newly installed. This takes a few
          minutes; this page goes to the login page by itself when it's done (the password is Admin@12345 again).
        </div>
      </div>
    </div>
    <template v-else>
      <p class="muted">
        <strong>Delete All</strong> deletes every slideshow except the sample, with all their slides and files.
        The sample slideshow, your settings, logo and background colour are kept. It can't be undone.
      </p>
      <p class="muted">
        <strong>Restore Defaults</strong> makes this noticeboard as if it had just been installed: every slideshow,
        setting, the logo and the update history are deleted, and the software is reinstalled. It can't be undone.
      </p>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button class="btn-danger" :disabled="loading" @click="startDeleteAll">Delete All…</button>
        <button class="btn-danger" :disabled="loading" @click="startRestore">Restore Defaults…</button>
        <FlashMessage :flash="msg" />
      </div>
    </template>
  </CollapsibleCard>

  <ConfirmDangerDialogs
    ref="confirmDelete"
    id-prefix="delete-all"
    title="Delete all your slideshows?"
    :verify="verifyFor('delete-all')"
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

  <ConfirmDangerDialogs
    ref="confirmRestore"
    id-prefix="restore-defaults"
    title="Restore this noticeboard to its defaults?"
    :verify="verifyFor('restore-defaults')"
    :confirm="restore"
    cancel-label="Cancel, keep everything"
    confirm-label="Confirm, restore defaults"
    busy-label="Starting…"
    @cancelled="(note) => msg.ok(note, 4000)"
    @failed="(message) => msg.error(message)"
    @done="restoreStarted"
  >
    <p>It will be as if this noticeboard had just been installed on <strong>{{ branch }}</strong>:</p>
    <ul class="warnings">
      <li><strong>Every slideshow is deleted</strong>, with its slides and files. The sample slideshow comes back as new.</li>
      <li><strong>Every setting goes back to its default:</strong> the admin password becomes <code>Admin@12345</code> and everyone is logged out, MAC filtering is turned off, the display settings and the background colour are reset.</li>
      <li><strong>The port goes back to 3000.</strong> You can set a custom port again in Settings afterwards.</li>
      <li><strong>The logo, the update schedule, the update history, the settings backups and the logs are deleted.</strong></li>
      <li><strong>The software is reinstalled</strong> from the latest version of {{ branch }}, into a clean folder. The noticeboard restarts; screens go blank for a few seconds, then reload by themselves.</li>
    </ul>
    <p>
      Kept: the branch this noticeboard follows, and what the installer set up on the Pi (the kiosk, the services,
      sudo and the firewall).
    </p>
    <p class="tone-warn">
      <strong>Running the installer again afterwards is recommended.</strong> There will be no more reminders about it
      once the restore is complete. In a terminal on this Pi, or over SSH:
    </p>
    <p><code class="command">{{ installerCommand(branch) }}</code></p>

    <template #final>
      <p>
        Your password checked out, so the only thing between this noticeboard and a fresh start is you and this button.
      </p>
      <p>This is your last chance to back out:</p>
      <ul class="choices">
        <li><strong>Cancel</strong> leaves everything exactly as it is.</li>
        <li>
          <strong>Confirm</strong> deletes all your content and settings and reinstalls the software. There's no way to
          get them back.
        </li>
      </ul>
    </template>
  </ConfirmDangerDialogs>
</template>

<style scoped>
.muted { color: var(--text-muted); font-size: 13px; margin-bottom: 12px; line-height: 1.5; }
code { font-size: 12px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
.command { display: block; overflow-wrap: anywhere; padding: 6px 8px; }
.restoring { display: flex; gap: 12px; align-items: flex-start; font-size: 13px; }
.spinner {
  width: 18px;
  height: 18px;
  flex: none;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
