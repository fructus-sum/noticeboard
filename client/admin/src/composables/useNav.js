import { ref, watch } from 'vue';

// Whether the sidebar is collapsed to icons. Remembered in this browser; on a phone-sized
// screen it starts collapsed until the admin chooses otherwise.
const KEY = 'noticeboard:navCollapsed';

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved !== null) return saved === '1';
  } catch {
    // Storage unavailable: fall back to the screen size
  }
  return window.matchMedia?.('(max-width: 700px)').matches ?? false;
}

const collapsed = ref(initial());
watch(collapsed, (value) => {
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // Not remembered, but it still works for this visit
  }
});

export function useNav() {
  return { collapsed, toggle: () => { collapsed.value = !collapsed.value; } };
}
