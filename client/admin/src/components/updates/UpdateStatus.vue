<script setup>
// client/admin/src/components/updates/UpdateStatus.vue — what runs and how updates went
//
// The facts (the version running, how updates are checked and the last check, the last update and
// its outcome) and, while an update runs or the server restarts, the progress box. No wrapper
// element: the parts sit directly in the Software updates card.
//
// Props: info (GET /settings/updates), restarting
// Used by: SoftwareUpdates
// Uses: the helpers in useUpdateInfo
import { computed } from 'vue';
import { short, when, runningName, canSwitch } from '../../composables/useUpdateInfo.js';

const props = defineProps({
  info: { type: Object, required: true },
  restarting: Boolean,
});

const running = computed(() => runningName(props.info));

// How updates are installed (the schedule, SYSTEM_DESIGN §14 D41)
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const scheduleText = computed(() => {
  const s = props.info.schedule ?? { every: '15min' };
  switch (s.every) {
    case '2h': return 'Checked every 15 minutes; installed every 2 hours.';
    case 'daily': return `Checked every 15 minutes; installed daily at ${s.time}.`;
    case 'weekly': return `Checked every 15 minutes; installed every ${DAYS[s.day]} at ${s.time}.`;
    case 'manual': return 'Checked once a day; installed only when you choose.';
    default: return 'Checked every 15 minutes.';
  }
});

const STATES = {
  requested:     { label: 'Waiting to start', tone: 'info' },
  updating:      { label: 'In progress',      tone: 'info' },
  updated:       { label: 'Done',             tone: 'ok' },
  'rolled-back': { label: 'Rolled back',      tone: 'warn' },
  cancelled:     { label: 'Cancelled',        tone: 'warn' },
  failed:        { label: 'Failed',           tone: 'bad' },
};
const CHECKS = {
  'up-to-date': 'ok', available: 'info', waiting: 'info', skipped: 'warn', offline: 'warn', error: 'bad',
};
const statusView = computed(() => {
  const s = props.info.status;
  if (!s) return null;
  // Requested or running for over an hour: it never finished (e.g. the Pi lost power)
  if (!props.info.busy && (s.state === 'requested' || s.state === 'updating')) {
    return { label: "Didn't finish", tone: 'bad', note: 'The update log on the Pi may say why: journalctl -u noticeboard-update' };
  }
  return STATES[s.state] ?? { label: s.state, tone: 'info' };
});
</script>

<template>
  <dl class="facts">
    <dt>Running</dt>
    <dd>
      <strong>{{ running }}</strong> <code>{{ short(info.commit) }}</code>
      <span v-if="canSwitch(info) && info.configuredBranch !== info.branch" class="muted">
        · updates now come from <strong>{{ info.configuredBranch }}</strong>
      </span>
    </dd>

    <dt>Updates</dt>
    <dd>
      <template v-if="info.autoUpdates">{{ scheduleText }}</template>
      <template v-else-if="info.instant">Only when you switch branch (the 15-minute check is turned off).</template>
      <template v-else>Automatic updates aren't set up on this noticeboard. Run the installer on the Pi to set them up.</template>
      <div v-if="info.lastCheck" class="muted">
        Last check {{ when(info.lastCheck.time) }}:
        <span :class="`tone-${CHECKS[info.lastCheck.result] ?? 'info'}`">{{ info.lastCheck.message }}</span>
      </div>
    </dd>

    <template v-if="info.status">
      <dt>Last update</dt>
      <dd>
        <span class="pill" :class="`pill--${statusView.tone}`">{{ statusView.label }}</span>
        {{ when(info.status.time) }}
        <div>{{ info.status.message }}</div>
        <div v-if="statusView.note" class="muted">{{ statusView.note }}</div>
      </dd>
    </template>
  </dl>

  <!-- A switch or update is running -->
  <div v-if="info.busy || restarting" class="progress">
    <span class="spinner" aria-hidden="true"></span>
    <div>
      <strong>{{ restarting ? 'The noticeboard is restarting…' : info.status?.state === 'requested' ? 'Waiting for the update to start…' : 'Updating…' }}</strong>
      <div class="muted">
        {{ restarting
          ? "This page reconnects by itself. The screens go blank for a few seconds, then reload by themselves."
          : 'You can leave this page; the update carries on. Branch switching is available again once it finishes.' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.muted { color: var(--text-muted); font-size: 13px; }
code { font-size: 12px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }

.facts { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; font-size: 13px; }
.facts dt { color: var(--text-muted); font-weight: 500; }
.facts dd div { margin-top: 2px; }

.pill { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; margin-right: 6px; }
.pill--ok   { background: #dcfce7; color: #166534; }
.pill--info { background: #dbeafe; color: #1e40af; }
.pill--warn { background: #fef3c7; color: #92400e; }
.pill--bad  { background: #fee2e2; color: #991b1b; }
.tone-ok   { color: var(--success); }
.tone-info { color: var(--text-muted); }
.tone-warn { color: #b45309; }
.tone-bad  { color: var(--danger); }

.progress { display: flex; gap: 12px; align-items: flex-start; margin-top: 16px; padding: 12px; background: #eff6ff; border-radius: var(--radius); font-size: 13px; }
.spinner { flex: none; width: 16px; height: 16px; margin-top: 2px; border: 2px solid #93c5fd; border-top-color: var(--primary); border-radius: 50%; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
