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

  onUnmounted(() => socket.disconnect());

  return { playlist, connected };
}
