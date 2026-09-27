<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import { api } from '../../composables/useApi.js';
import ModalDialog from '../ui/ModalDialog.vue';

// Shown when MAC filtering is switched on: once it's saved, only approved devices can open the
// displays and the admin panel, so a device that isn't on the list locks itself out.
// "How to find your MAC address" swaps in a second pop-up; its OK button comes back here.
const props = defineProps({
  approved: { type: Array, default: () => [] },   // [{ mac, label }]
});
const emit = defineEmits(['confirm', 'cancel', 'add']);

const view = ref('warn');        // 'warn' | 'howto'
const myDevice = ref(null);      // { local, mac }
const confirmButton = ref(null);
const okButton = ref(null);

const myMacApproved = computed(() => !!myDevice.value?.mac
  && props.approved.some((a) => a.mac.toLowerCase() === myDevice.value.mac.toLowerCase()));

async function showHowTo() {
  view.value = 'howto';
  await nextTick();
  okButton.value?.focus();
}
async function backToWarning() {
  view.value = 'warn';
  await nextTick();
  confirmButton.value?.focus();
}

// Esc or a click outside: back to the warning from the how-to, else cancel
function onClose() {
  if (view.value === 'howto') backToWarning();
  else emit('cancel');
}

onMounted(async () => {
  confirmButton.value?.focus();
  try {
    myDevice.value = await api.get('/settings/my-device');
  } catch {
    // The warning works without it
  }
});
</script>

<template>
  <ModalDialog
    :role="view === 'warn' ? 'alertdialog' : 'dialog'"
    :labelledby="view === 'warn' ? 'mac-warn-title' : 'mac-howto-title'"
    @close="onClose"
  >
    <!-- First pop-up: the warning -->
    <template v-if="view === 'warn'">
      <h2 id="mac-warn-title">Turn on MAC filtering?</h2>
      <p>
        Once this is saved, only the devices on the approved list can open the displays and this admin panel.
        Every other device gets a "Not Found" page. The Pi running the noticeboard is always allowed.
      </p>
      <p class="important">
        <strong>If you're using the admin panel from another computer, tablet or phone, add its MAC address to the
        approved list first</strong>, or you'll lock yourself out. Add the MAC address of every display Pi as well.
      </p>

      <div v-if="myDevice" class="mine">
        <template v-if="myDevice.local">You're using the admin panel on the noticeboard Pi itself, so this device stays allowed.</template>
        <template v-else-if="myDevice.mac && myMacApproved">This device (<code>{{ myDevice.mac }}</code>) is already on the approved list.</template>
        <template v-else-if="myDevice.mac">
          This device's MAC address appears to be <code>{{ myDevice.mac }}</code>, and it isn't on the list yet.
          <button type="button" class="btn-ghost add" @click="emit('add', myDevice.mac)">Add it to the list</button>
        </template>
        <template v-else>The noticeboard couldn't work out this device's MAC address, so check it yourself.</template>
      </div>

      <p><button type="button" class="link" @click="showHowTo">How to find your MAC address</button></p>

      <div class="actions">
        <button type="button" class="btn-ghost" @click="emit('cancel')">Cancel</button>
        <button ref="confirmButton" type="button" class="btn-primary" @click="emit('confirm')">Turn on MAC filtering</button>
      </div>
    </template>

    <!-- Second pop-up: how to find a MAC address -->
    <template v-else>
      <h2 id="mac-howto-title">How to find your MAC address</h2>
      <p>Use the address of the network connection the device uses to reach the noticeboard: Wi-Fi or wired (Ethernet).</p>
      <dl class="howto">
        <dt>Windows</dt>
        <dd>
          Open <em>Command Prompt</em> (search the Start menu for "cmd") and type <code>getmac /v</code>. The
          <em>Physical Address</em> next to your Wi-Fi or Ethernet connection is the MAC address, e.g.
          <code>1A-2B-3C-4D-5E-6F</code>. Dashes are fine: they're changed to colons when it's added.
        </dd>
        <dt>Mac</dt>
        <dd>
          Open <em>System Settings → Wi-Fi</em> (or <em>Network</em>), click <em>Details…</em> next to your network, and
          look for <em>MAC address</em> (under <em>Hardware</em> on some versions). Or in <em>Terminal</em>, type
          <code>ifconfig en0 | grep ether</code>.
        </dd>
        <dt>Linux, including a Raspberry Pi</dt>
        <dd>
          Open a terminal and type <code>ip link</code>. The MAC address follows <code>link/ether</code> under your
          connection, usually <code>wlan0</code> (Wi-Fi) or <code>eth0</code> (wired).
        </dd>
      </dl>
      <p class="note">
        Phones, tablets and some computers use a different "private" Wi-Fi address on each network. Turn that off for
        this network (in its Wi-Fi settings), or the address you add may not be the one it uses.
      </p>
      <div class="actions">
        <button ref="okButton" type="button" class="btn-primary" @click="backToWarning">OK</button>
      </div>
    </template>
  </ModalDialog>
</template>

<style scoped>
/* The overlay and card are ModalDialog's; this pop-up's text is a little more spaced */
:deep(.dialog) { line-height: 1.5; }
.dialog p { margin-bottom: 10px; }
.important { padding: 10px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: var(--radius); color: #92400e; }
.mine { margin-bottom: 10px; padding: 10px 12px; background: var(--surface-2); border-radius: var(--radius); }
.mine .add { margin-left: 6px; font-size: 12px; padding: 4px 10px; }
code { font-size: 12px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
.mine code { background: var(--surface); }
.link { background: none; border: none; padding: 0; color: var(--primary); text-decoration: underline; font-size: 13px; }
.howto dt { font-weight: 600; margin-top: 10px; }
.howto dd { margin: 2px 0 0; }
.note { margin-top: 12px; color: var(--text-muted); }
.actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
</style>
