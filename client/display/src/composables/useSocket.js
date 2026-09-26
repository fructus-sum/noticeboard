import { ref, onUnmounted } from 'vue';
import { io } from 'socket.io-client';
import { SOCKET_EVENTS } from '@shared/constants.js';

export function useSocket() {
  const playlist = ref({ slides: [] });
  const connected = ref(false);

  const socket = io({
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    connected.value = true;
    socket.emit(SOCKET_EVENTS.DISPLAY_READY);
  });

  socket.on('disconnect', () => {
    connected.value = false;
  });

  socket.on(SOCKET_EVENTS.PLAYLIST_UPDATE, (data) => {
    playlist.value = data;
  });

  // The server sends its display build on every connect. If it changes (the Pi was
  // updated), reload so this screen runs the new version.
  let buildId;
  socket.on(SOCKET_EVENTS.DISPLAY_BUILD, (id) => {
    if (buildId === undefined) buildId = id;
    else if (id && id !== buildId) window.location.reload();
  });

  onUnmounted(() => socket.disconnect());

  return { playlist, connected };
}
