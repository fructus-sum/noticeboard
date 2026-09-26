// Page reloads that are safe on an unattended screen. Reloading while the server is down
// would leave the kiosk on the browser's own error page, which never recovers by itself,
// so every reload here first checks that the server will answer.

const STARTED = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_CHECK_MS = 5 * 60 * 1000;
const RECOVERY_KEY = 'noticeboard:lastRecoveryReload';
const RECOVERY_GAP_MS = 30 * 60 * 1000;   // at most one recovery reload per half hour

export async function reloadWhenServerUp() {
  try {
    const res = await fetch('/', { cache: 'no-store' });
    if (!res.ok) return false;
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

// Keep trying until the server answers, e.g. to load a new build right after an update
export function reloadSoon(retryMs = 10_000) {
  reloadWhenServerUp().then((done) => {
    if (!done) setTimeout(() => reloadSoon(retryMs), retryMs);
  });
}

// Last resort when the page itself seems broken. Rate-limited so it can never loop.
export function recoverByReloading(reason) {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RECOVERY_KEY)) || 0;
  } catch { /* storage unavailable: carry on without the rate limit's memory */ }
  if (Date.now() - last < RECOVERY_GAP_MS) return;
  try {
    sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
  } catch { /* as above */ }
  console.warn(`Noticeboard: reloading the page (${reason})`);
  reloadWhenServerUp();
}

// After a day of running, reload once between 2 and 5 am while connected, clearing anything
// the browser has built up over a long run
export function startDailyReload(isConnected) {
  setInterval(() => {
    const hour = new Date().getHours();
    if (Date.now() - STARTED >= DAY_MS && hour >= 2 && hour < 5 && isConnected()) {
      reloadWhenServerUp();
    }
  }, DAILY_CHECK_MS);
}
