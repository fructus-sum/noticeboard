// tests/upgrade/state.js — seeds and snapshots an "installed Pi" for the upgrade rehearsal
//
//   node state.js seed     <base url> <install dir> <cookie file>   realistic data, made through the API
//   node state.js snapshot <base url> <install dir> <cookie file>   → JSON on stdout
//   node state.js compare  <before.json> <after.json>              exit 1 and list the differences
//
// A snapshot holds what an update must not change: every file in data/ (except the updater's own
// status files and branch setting, and the settings backups a branch switch makes), the media,
// the API's view of the slideshows and settings, the playlist a display receives, that the
// admin's existing login still works, and the kiosk-exit answer.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = path.resolve(__dirname, '..', '..', 'node_modules');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [cmd, base, dir, cookieFile] = process.argv.slice(2);

async function api(method, p, body, cookie) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + p, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, json, res };
}

async function waitQuiet(cookie) {
  for (let i = 0; i < 240; i++) {
    const list = (await api('GET', '/api/slideshows', null, cookie)).json || [];
    let busy = false;
    for (const ss of list) {
      const slides = (await api('GET', `/api/slideshows/${ss.folder}/slides`, null, cookie)).json || [];
      if (slides.some((s) => s.status === 'processing' || s.thumbnailPending)) busy = true;
    }
    if (!busy) return;
    await sleep(500);
  }
  throw new Error('processing never finished');
}

async function seed() {
  const sharp = require(path.join(MODULES, 'sharp'));
  const png = async (colour) => new Blob([await sharp({ create: { width: 320, height: 180, channels: 3, background: colour } }).png().toBuffer()], { type: 'image/png' });
  const login = await api('POST', '/api/auth/login', { password: 'Admin@12345' });
  const cookie = login.res.headers.get('set-cookie').split(';')[0];
  fs.writeFileSync(cookieFile, cookie);

  const shows = [];
  for (const [name, colours] of [['Front desk', ['#c0392b', '#2980b9']], ['Canteen menu', ['#27ae60']], ['Old notices', ['#8e44ad']]]) {
    const ss = (await api('POST', '/api/slideshows', { name }, cookie)).json;
    const form = new FormData();
    for (const c of colours) form.append('files', await png(c), `${c.slice(1)}.png`);
    await api('POST', `/api/slideshows/${ss.folder}/slides`, form, cookie);
    shows.push(ss.folder);
  }
  await waitQuiet(cookie);
  await api('PUT', `/api/slideshows/${shows[0]}`, { enabled: true, slideDurationSeconds: 7 }, cookie);
  await api('PUT', `/api/slideshows/${shows[1]}`, { enabled: true, schedule: { type: 'timed', days: [1, 2, 3, 4, 5], startTime: '07:00', endTime: '19:00' } }, cookie);
  await api('PUT', `/api/slideshows/${shows[2]}`, { hidden: true }, cookie);
  await api('PUT', '/api/settings', { display: { defaultSlideDurationSeconds: 12, showDeviceInfo: false } }, cookie);
  const logo = new FormData();
  logo.append('logo', await png('#f39c12'), 'logo.png');
  await api('POST', '/api/settings/logo', logo, cookie);
  await waitQuiet(cookie);
}

function hash(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}
function filesUnder(root, rel = '') {
  const out = {};
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) Object.assign(out, filesUnder(root, r));
    else out[r] = hash(path.join(root, r));
  }
  return out;
}

async function playlist() {
  const { io } = require(path.join(MODULES, 'socket.io-client'));
  return new Promise((resolve, reject) => {
    const sock = io(base, { transports: ['websocket'] });
    const got = {};
    sock.on('connect', () => sock.emit('display:ready'));
    sock.on('display:settings', (s) => { got.settings = s; });
    sock.on('playlist:update', (p) => { got.playlist = p; });
    setTimeout(() => { sock.close(); got.playlist ? resolve(got) : reject(new Error('no playlist')); }, 2500);
  });
}

async function snapshot() {
  const cookie = fs.readFileSync(cookieFile, 'utf8');
  await waitQuiet(cookie);
  const data = filesUnder(path.join(dir, 'data'));
  for (const k of Object.keys(data)) {
    // The updater's own records and branch setting (the rehearsal goes back by a switch), and the
    // Server's own copy of its config (config.last-good.json, 0.6.9)
    if (/^update-.*\.json$|^update-branch\.env$|^installer\.json$|^backups\/|^config\.last-good\.json$/.test(k)) delete data[k];
  }
  const slideshows = (await api('GET', '/api/slideshows', null, cookie)).json;
  const slides = {};
  for (const ss of slideshows) slides[ss.folder] = (await api('GET', `/api/slideshows/${ss.folder}/slides`, null, cookie)).json;
  const settings = (await api('GET', '/api/settings', null, cookie)).json;
  const shown = await playlist();
  const claim = await api('POST', '/api/device/kiosk-exit/claim');
  return {
    dataFiles: data,
    slideshows,
    slides,
    settings,
    logo: (await api('GET', '/api/settings/logo', null, cookie)).json,
    // Without startedAt (0.7.0): the Server's time the playlist started, which is new at every start
    playlist: shown.playlist && Object.fromEntries(Object.entries(shown.playlist).filter(([k]) => k !== 'startedAt')),
    displaySettings: shown.settings,
    oldLoginStillWorks: (await api('GET', '/api/auth/status', null, cookie)).json,
    kioskClaimAnswer: claim.text,
  };
}

function compare(beforeFile, afterFile) {
  const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
  const after = JSON.parse(fs.readFileSync(afterFile, 'utf8'));
  // display:settings may gain keys (open screens running an older viewer ignore them: SYSTEM_DESIGN
  // §15); the keys the older version sent must keep their values
  if (before.displaySettings && after.displaySettings) {
    after.displaySettings = Object.fromEntries(Object.keys(before.displaySettings).map((k) => [k, after.displaySettings[k]]));
  }
  let differences = 0;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = JSON.stringify(before[key]);
    const b = JSON.stringify(after[key]);
    if (a !== b) {
      differences += 1;
      console.log(`  differs: ${key}\n    before: ${a?.slice(0, 300)}\n    after:  ${b?.slice(0, 300)}`);
    }
  }
  process.exit(differences ? 1 : 0);
}

(async () => {
  if (cmd === 'seed') await seed();
  else if (cmd === 'snapshot') process.stdout.write(JSON.stringify(await snapshot(), null, 2));
  else if (cmd === 'compare') compare(base, dir);
  else throw new Error(`unknown command ${cmd}`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
