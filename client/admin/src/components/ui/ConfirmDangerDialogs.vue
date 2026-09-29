<script setup>
// client/admin/src/components/ui/ConfirmDangerDialogs.vue — the confirmations before something
// that can't easily be undone
//
// Responsibilities
//   The two steps every such action asks for (SYSTEM_DESIGN §14 D40), each a ModalDialog: the
//   warnings and the admin password (the caller's `verify` checks it and gives a one-time token),
//   then the final "last chance" (the caller's `confirm` does the action with that token). Esc, a
//   click outside or Cancel ends it with nothing changed; while an answer is on its way it can't
//   be cancelled. The password field, then the final Cancel button, get the focus (the safe
//   choice is the default).
//
// Props: idPrefix (the dialogs' element ids: <prefix>-title, <prefix>-password, …), title (the
//        first dialog's), finalTitle, verify(password) → Promise<token>,
//        confirm(token) → Promise<result>, cancelLabel and confirmLabel (the final buttons),
//        busyLabel (the confirm button while it runs)
// Slots: default (the first dialog's text and warnings, above the password), final (the last
//        chance's text)
// Exposes: open(), which starts at the password step
// Emits: cancelled(note), failed(message) (a wrong password, too many tries, or the action
//        refused), done(result)
// The texts in the slots use the global .danger-dialog styles (styles/base.css): .warnings,
// .choices, .tone-warn, and paragraph spacing.
//
// Used by: updates/SwitchDialogs (after its own Missing software step), updates/FullUpdate,
//   settings/DeleteContentCard
// Uses: ModalDialog
import { ref, nextTick } from 'vue';
import ModalDialog from './ModalDialog.vue';

const props = defineProps({
  idPrefix: { type: String, required: true },
  title: { type: String, required: true },
  finalTitle: { type: String, default: 'Last chance to avoid doing something stupid!' },
  verify: { type: Function, required: true },
  confirm: { type: Function, required: true },
  cancelLabel: { type: String, default: 'Cancel' },
  confirmLabel: { type: String, required: true },
  busyLabel: { type: String, default: 'Starting…' },
});
const emit = defineEmits(['cancelled', 'failed', 'done']);

const CANCELLED = 'Cancelled. Nothing was changed.';

const step = ref('');   // '' | 'password' | 'final'
const password = ref('');
const verifying = ref(false);
const token = ref('');
const confirming = ref(false);
const passwordInput = ref(null);
const cancelFinal = ref(null);

async function open() {
  password.value = '';
  token.value = '';
  step.value = 'password';
  await nextTick();
  passwordInput.value?.focus();
}
defineExpose({ open });

function cancel(note) {
  if (verifying.value || confirming.value) return;   // an answer is on its way
  step.value = '';
  password.value = '';
  token.value = '';
  emit('cancelled', note);
}

async function verifyPassword() {
  if (!password.value) return;
  verifying.value = true;
  try {
    token.value = await props.verify(password.value);
    password.value = '';
    step.value = 'final';
    await nextTick();
    cancelFinal.value?.focus();
  } catch (e) {
    // Wrong password (or too many tries): nothing changes
    step.value = '';
    password.value = '';
    emit('failed', e.message);
  } finally {
    verifying.value = false;
  }
}

async function confirmIt() {
  confirming.value = true;
  try {
    const result = await props.confirm(token.value);
    step.value = '';
    token.value = '';
    emit('done', result);
  } catch (e) {
    step.value = '';
    token.value = '';
    emit('failed', e.message);
  } finally {
    confirming.value = false;
  }
}
</script>

<template>
  <!-- First confirmation: warnings and the admin password -->
  <ModalDialog v-if="step === 'password'" class="danger-dialog" tag="form" :labelledby="`${idPrefix}-title`" @close="cancel(CANCELLED)" @submit.prevent="verifyPassword">
    <h2 :id="`${idPrefix}-title`">{{ title }}</h2>
    <slot />
    <div class="field">
      <label :for="`${idPrefix}-password`">Admin password</label>
      <input :id="`${idPrefix}-password`" ref="passwordInput" v-model="password" type="password" autocomplete="current-password" required />
    </div>
    <div class="actions">
      <button type="button" class="btn-ghost" :disabled="verifying" @click="cancel(CANCELLED)">Cancel</button>
      <button type="submit" class="btn-primary" :disabled="verifying || !password">{{ verifying ? 'Checking…' : 'Continue' }}</button>
    </div>
  </ModalDialog>

  <!-- Final confirmation -->
  <ModalDialog v-if="step === 'final'" class="danger-dialog" role="alertdialog" :labelledby="`${idPrefix}-final-title`" :describedby="`${idPrefix}-final-body`" @close="cancel(CANCELLED)">
    <h2 :id="`${idPrefix}-final-title`">{{ finalTitle }}</h2>
    <div :id="`${idPrefix}-final-body`">
      <slot name="final" />
    </div>
    <div class="actions">
      <button ref="cancelFinal" type="button" class="btn-ghost" :disabled="confirming" @click="cancel('Cancelled at the last moment. Nothing was changed.')">
        {{ cancelLabel }}
      </button>
      <button type="button" class="btn-danger" :disabled="confirming" @click="confirmIt">
        {{ confirming ? busyLabel : confirmLabel }}
      </button>
    </div>
  </ModalDialog>
</template>
