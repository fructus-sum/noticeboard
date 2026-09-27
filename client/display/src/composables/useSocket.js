// client/display/src/composables/useSocket.js — the viewer's live connection to the server
//
// Provides
//   useSocket() → { playlist, connected, received, settings }
//   Sends display:ready on every connect; takes playlist:update, display:settings and
//   display:build. Reconnects by itself after any outage (every 2–10 s, never giving up), and
//   reloads onto a new build when display:build changes (once the server answers).
//
// Used by: App.vue
// Uses: socket.io-client, SOCKET_EVENTS and DEFAULT_BACKGROUND from @shared, recovery.js (reloadSoon)
//
// Change impact
//   The event names and payloads are a contract with the server (SYSTEM_DESIGN §3.4, §15).
import { ref, onUnmounted } from 'vue';
import { io } from 'socket.io-client';
import { SOCKET_EVENTS, DEFAULT_BACKGROUND } from '@shared/index.js';
import { reloadSoon } from '../recovery.js';

export function useSocket() {
  const playlist = ref({ slides: [] });
  const connected = ref(false);
  const received = ref(false);   // true once the server has sent a playlist
  // This display's look, set in the admin panel: the location pin and the logo
  const settings = ref({ showDeviceInfo: true, logo: null, background: DEFAULT_BACKGROUND });

  // Reconnects on its own after any outage, retrying every 2–10 s for as long as it takes
  const socket = io({
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    connected.value = true;
    socket.emit(SOCKET_EVENTS.DISPLAY_READY);
  });

  socket.on('disconnect', (reason) => {
    connected.value = false;
    // socket.io only stops retrying when the server ends the connection on purpose; a
    // display should never give up, so ask again
    if (reason === 'io server disconnect') socket.connect();
  });

  socket.on(SOCKET_EVENTS.PLAYLIST_UPDATE, (data) => {
    playlist.value = data;
    received.value = true;
  });

  socket.on(SOCKET_EVENTS.DISPLAY_SETTINGS, (data) => {
    settings.value = {
      showDeviceInfo: data?.showDeviceInfo !== false,
      logo: data?.logo ?? null,
      background: data?.background || DEFAULT_BACKGROUND,
    };
  });

  // The server sends its display build on every connect. If it changes (the Pi was
  // updated), reload so this screen runs the new version. reloadSoon only reloads once the
  // server answers, so the kiosk can't end up on the browser's error page.
  let buildId;
  socket.on(SOCKET_EVENTS.DISPLAY_BUILD, (id) => {
    if (buildId === undefined) buildId = id;
    else if (id && id !== buildId) reloadSoon();
  });

  onUnmounted(() => socket.disconnect());

  return { playlist, connected, received, settings };
}
