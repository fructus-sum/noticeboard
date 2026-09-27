<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const AUTO_CLOSE_MS = 90 * 1000;

const open = ref(false);
const info = ref(null);   // { port, addresses: [{ name, ip }] }
const error = ref('');
let closeTimer = null;

async function show() {
  open.value = true;
  info.value = null;
  error.value = '';
  clearTimeout(closeTimer);
  closeTimer = setTimeout(close, AUTO_CLOSE_MS);
  try {
    const res = await fetch('/api/device');
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    info.value = await res.json();
  } catch {
    error.value = "Couldn't load the device address.";
  }
}

function close() {
  open.value = false;
  clearTimeout(closeTimer);
  closeTimer = null;
}

function toggle() {
  if (open.value) close();
  else show();
}

function onKeydown(e) {
  if (e.key === 'Escape' && open.value) close();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(closeTimer);
});
</script>

<template>
  <button
    type="button"
    class="info-button"
    aria-label="Show the Noticeboard server's address"
    title="Show the Noticeboard server's address"
    @click="toggle"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  </button>

  <div v-if="open" class="info-popup" role="dialog" aria-labelledby="info-title">
    <button type="button" class="info-close" aria-label="Close" @click="close">×</button>
    <h2 id="info-title" class="info-title">Noticeboard server</h2>

    <p v-if="error" class="info-message">{{ error }}</p>
    <p v-else-if="!info" class="info-message">Loading…</p>
    <template v-else>
      <p v-if="!info.addresses.length" class="info-message">No network connection found.</p>
      <dl class="info-list">
        <template v-for="a in info.addresses" :key="a.name + a.ip">
          <dt>IP address<span v-if="info.addresses.length > 1"> ({{ a.name }})</span></dt>
          <dd>{{ a.ip }}</dd>
        </template>
        <dt>Port</dt>
        <dd>{{ info.port }}</dd>
      </dl>
      <p v-if="info.addresses.length" class="info-hint">
        From another device on this network, open <strong>http://{{ info.addresses[0].ip }}:{{ info.port }}</strong>
        (add <strong>/admin</strong> for the admin panel).
      </p>
    </template>
  </div>
</template>

<style scoped>
/* Faint pin fixed 5px in from the top-left corner, above every slide */
.info-button {
  position: fixed;
  top: 5px;
  left: 5px;
  z-index: 1000;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  opacity: 0.3;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s;
}
.info-button:hover,
.info-button:focus-visible { opacity: 0.8; }
.info-button svg { width: 14px; height: 14px; fill: currentColor; }

/* Solid card so it stays readable whatever slide is behind it */
.info-popup {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1001;
  min-width: min(420px, 90vw);
  max-width: 90vw;
  padding: clamp(20px, 3vw, 40px) clamp(24px, 4vw, 56px);
  background: #111827;
  color: #f9fafb;
  border: 1px solid #374151;
  border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  font-family: system-ui, -apple-system, sans-serif;
}

.info-close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 44px;
  height: 44px;
  border: none;
  background: transparent;
  color: #d1d5db;
  font-size: 32px;
  line-height: 1;
  cursor: pointer;
}
.info-close:hover { color: #fff; }

.info-title {
  font-size: clamp(18px, 2.2vw, 28px);
  font-weight: 600;
  margin-bottom: clamp(12px, 2vw, 24px);
  padding-right: 40px;
}

.info-list dt {
  font-size: clamp(13px, 1.5vw, 18px);
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.info-list dd {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: clamp(28px, 4.5vw, 56px);
  font-weight: 600;
  margin-bottom: clamp(10px, 1.6vw, 20px);
}
.info-list dd:last-child { margin-bottom: 0; }

.info-hint {
  margin-top: clamp(12px, 2vw, 24px);
  font-size: clamp(14px, 1.6vw, 20px);
  color: #d1d5db;
  line-height: 1.5;
}
.info-hint strong { color: #fff; font-weight: 600; }

.info-message {
  font-size: clamp(16px, 2vw, 24px);
  color: #d1d5db;
  margin-bottom: 12px;
}
</style>
