// client/admin/src/composables/useItemList.js — a show's list of items on its page (slides, tracks)
//
// What every item list does: reload it, upload several files at once, reload every 2 seconds while
// an item is being processed (or `busy` says so), delete one (after a question naming it), and move
// one up or down (the new order is saved; if saving fails, moveErr says so and the list is loaded
// again, so what's shown is what's saved: SYSTEM_DESIGN §18.5 item 7).
// Provides: useItemList({ items, path, busy }) → { load(), fileInput, uploading, uploadErr,
//   uploadCount, upload(event), remove(item), move(index, dir), moveErr, stop() }. `items` is the list (a
//   ref, e.g. a v-model); `path()` is the list's API path, e.g. /slideshows/<folder>/slides;
//   `busy(item)` adds to "processing" what keeps the list reloading (e.g. a thumbnail being made).
//   Call stop() when the component goes (it clears the reload timer).
// Used by: components/slideshow/SlideList, components/audio/TrackList
// Uses: useApi; mediaDisplayName from @shared (the delete question)
import { ref, computed, watch } from 'vue';
import { mediaDisplayName } from '@shared/index.js';
import { api } from './useApi.js';

export function useItemList({ items, path, busy = () => false }) {
  async function load() {
    items.value = await api.get(path());
  }

  // Upload
  const fileInput   = ref(null);
  const uploading   = ref(false);
  const uploadErr   = ref('');
  const uploadCount = ref(0);

  async function upload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    uploadErr.value = '';
    uploading.value = true;
    uploadCount.value = files.length;
    const fd = new FormData();
    for (const file of files) fd.append('files', file);
    try {
      const added = await api.upload(path(), fd);
      items.value.push(...added);
    } catch (err) {
      uploadErr.value = err.message;
    } finally {
      uploading.value = false;
      uploadCount.value = 0;
      if (fileInput.value) fileInput.value.value = '';
    }
  }

  // Reloading while any item is being processed
  let pollTimer = null;
  const processing = computed(() => items.value.some(s => s.status === 'processing' || busy(s)));
  watch(processing, (v) => {
    if (v && !pollTimer) {
      pollTimer = setInterval(async () => {
        await load().catch(() => {});
        if (!processing.value) { clearInterval(pollTimer); pollTimer = null; }
      }, 2000);
    }
  }, { immediate: true });

  async function remove(item) {
    if (!confirm(`Delete “${mediaDisplayName(item)}”?`)) return;
    try {
      await api.del(`${path()}/${item.id}`);
      items.value = items.value.filter(s => s.id !== item.id);
    } catch (e) {
      alert(e.message);
    }
  }

  const moveErr = ref('');
  async function move(index, dir) {
    const list = [...items.value];
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    items.value = list;
    moveErr.value = '';
    try {
      await api.put(`${path()}/reorder`, { order: list.map(s => s.id) });
    } catch (e) {
      moveErr.value = `Couldn't save the new order: ${e.message} The list shows the order that is saved.`;
      await load().catch(() => {});
    }
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  return { load, fileInput, uploading, uploadErr, uploadCount, upload, remove, move, moveErr, stop };
}
