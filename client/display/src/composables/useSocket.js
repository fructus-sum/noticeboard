// client/display/src/composables/useSocket.js — the viewer's live connection to the server
//
// Provides
//   useSocket() → { playlist, connected, received, settings, audio, serverNow }
//   Sends display:ready on every connect; takes playlist:update, display:settings, audio:update
//   (the background audio: { shows, slideshows, event }, SYSTEM_DESIGN §18.3) and display:build.
//   Measures this screen's clock against the Server's (time:ping / time:pong, serverClock.js): a
//   burst of exchanges on every connect, then one every 5 minutes; serverNow() is the Server's time
//   as this screen can best tell it (SYSTEM_DESIGN §18.8). ?debugClockOffset=<ms> shifts this
//   screen's own clock, for tests that check screens with wrong clocks still line up. Reconnects by itself after any outage (every 2–10 s, never giving up), and
//   reloads onto a new build when display:build changes (once the server answers).
//
// Used by: App.vue
// Uses: socket.io-client, SOCKET_EVENTS and DEFAULT_BACKGROUND from @shared, recovery.js (reloadSoon),
//   serverClock.js
//
// Change impact
//   The event names and payloads are a contract with the server (SYSTEM_DESIGN §3.4, §15).
import { ref, onUnmounted } from 'vue';
import { io } from 'socket.io-client';
import { SOCKET_EVENTS, DEFAULT_BACKGROUND } from '@shared/index.js';
import { reloadSoon } from '../recovery.js';
import { createServerClock, BURST, BURST_GAP_MS, REFRESH_MS } from '../serverClock.js';

export function useSocket() {
  const playlist = ref({ slides: [] });
  const connected = ref(false);
  const received = ref(false);   // true once the server has sent a playlist
  // This display's look, set in the admin panel: the location pin and the logo
  const settings = ref({ showDeviceInfo: true, logo: null, background: DEFAULT_BACKGROUND, installerNeeded: false, updateAvailable: false, restartNeeded: false });
  // The background audio: none until the server says (an older server never does)
  const audio = ref({ shows: {}, slideshows: {}, event: null });

  // The Server's time, as this screen can best tell it
  const skew = Number(new URLSearchParams(window.location.search).get('debugClockOffset')) || 0;
  const clock = createServerClock({ now: () => Date.now() + skew });
  let burstTimers = [];
  let refreshTimer = null;

  // Reconnects on its own after any outage, retrying every 2–10 s for as long as it takes
  const socket = io({
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });

  const askTime = () => socket.emit(SOCKET_EVENTS.TIME_PING, clock.ping());
  socket.on('connect', () => {
    connected.value = true;
    socket.emit(SOCKET_EVENTS.DISPLAY_READY);
    burstTimers.forEach(clearTimeout);
    burstTimers = Array.from({ length: BURST }, (_, i) => setTimeout(askTime, i * BURST_GAP_MS));
    clearInterval(refreshTimer);
    refreshTimer = setInterval(askTime, REFRESH_MS);
  });
  socket.on(SOCKET_EVENTS.TIME_PONG, (answer) => clock.pong(answer));

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
      installerNeeded: data?.installerNeeded === true,
      updateAvailable: data?.updateAvailable === true,
      restartNeeded: data?.restartNeeded === true,
    };
  });

  socket.on(SOCKET_EVENTS.AUDIO_UPDATE, (data) => {
    audio.value = { shows: data?.shows ?? {}, slideshows: data?.slideshows ?? {}, event: data?.event ?? null };
  });

  // The server sends its display build on every connect. If it changes (the Server was
  // updated), reload so this screen runs the new version. reloadSoon only reloads once the
  // server answers, so the kiosk can't end up on the browser's error page.
  let buildId;
  socket.on(SOCKET_EVENTS.DISPLAY_BUILD, (id) => {
    if (buildId === undefined) buildId = id;
    else if (id && id !== buildId) reloadSoon();
  });

  onUnmounted(() => {
    burstTimers.forEach(clearTimeout);
    clearInterval(refreshTimer);
    socket.disconnect();
  });
  // Read-only diagnostic: window.noticeboardClock()
  window.noticeboardClock = () => ({ ...clock.state(), serverNow: clock.serverNow() });

  return { playlist, connected, received, settings, audio, serverNow: clock.serverNow };
}
