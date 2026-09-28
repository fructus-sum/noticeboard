// The HTTP and socket contract (SYSTEM_DESIGN §4, §15): every route's status code, content
// type and JSON shape, plus the exact texts that other programs compare (the MAC-denied page, the
// kiosk-exit answer, the login cookie). The first run on the baseline records
// tests/fixtures/api-contract.json (or NB_UPDATE_SNAPSHOT=1 records it again); every later run must
// match it. Shapes, not values: "string", "number", {…keys}, [first item's shape].
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MODULES, makeApp, server, check, done, sleep } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));
const { io } = require(path.join(MODULES, 'socket.io-client'));

const SNAPSHOT = path.join(__dirname, '..', 'fixtures', 'api-contract.json');
const records = {};

function shape(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])]));
  return typeof v;
}

async function record(name, env, method, p, { body, cookie, exact = false, host } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch((host || env.base) + p, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const type = (res.headers.get('content-type') || '').split(';')[0];
  const text = await res.text();
  let content;
  if (exact) content = text;
  else if (type === 'application/json') content = shape(JSON.parse(text));
  else content = `${type}, ${text.length ? 'non-empty' : 'empty'}`;
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;   // slide ids vary per run
  records[name] = { method, path: p.replace(uuid, ':id'), status: res.status, type, content };
  return { res, text, json: type === 'application/json' ? JSON.parse(text) : null };
}

function lanAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) return a.address;
  }
  return null;
}

(async () => {
  const env = makeApp({ port: 3926 });
  const s = server(env);
  await s.start();

  // ── Anonymous ──
  await record('viewer page', env, 'GET', '/');
  await record('viewer SPA route', env, 'GET', '/some/page');
  await record('admin page', env, 'GET', '/admin/');
  await record('admin SPA route', env, 'GET', '/admin/settings');
  await record('user guide', env, 'GET', '/admin/help');
  const logo = await record('logo', env, 'GET', '/branding/logo');
  const logoV = await record('logo, versioned', env, 'GET', '/branding/logo?v=1');
  records['logo cache headers'] = { content: [logo.res.headers.get('cache-control'), logoV.res.headers.get('cache-control')] };
  await record('media: not an allowed type', env, 'GET', '/media/x/slideshow.json', { exact: true });
  await record('auth status, logged out', env, 'GET', '/api/auth/status', { exact: true });
  await record('settings, logged out', env, 'GET', '/api/settings', { exact: true });
  await record('slideshows, logged out', env, 'GET', '/api/slideshows', { exact: true });
  await record('device info', env, 'GET', '/api/device');
  await record('kiosk exit claim, none asked', env, 'POST', '/api/device/kiosk-exit/claim', { exact: true });
  await record('kiosk exit request', env, 'POST', '/api/device/kiosk-exit', { exact: true });
  await record('kiosk exit claim, asked', env, 'POST', '/api/device/kiosk-exit/claim', { exact: true });
  await record('kiosk exit claim, taken', env, 'POST', '/api/device/kiosk-exit/claim', { exact: true });
  await record('login, wrong password', env, 'POST', '/api/auth/login', { body: { password: 'nope' }, exact: true });
  await record('login, no password', env, 'POST', '/api/auth/login', { body: {}, exact: true });

  // ── Logged in ──
  const login = await record('login', env, 'POST', '/api/auth/login', { body: { password: 'Admin@12345' }, exact: true });
  const setCookie = login.res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  s.setCookie(cookie);
  records['login cookie attributes'] = {
    content: setCookie.split(';').map((p) => p.trim()).map((p, i) => (i === 0 ? p.split('=')[0] : p.replace(/^Expires=.*/, 'Expires=…'))).sort(),
  };
  const a = (name, method, p, opts = {}) => record(name, env, method, p, { cookie, ...opts });
  await a('auth status, logged in', 'GET', '/api/auth/status', { exact: true });
  await a('settings', 'GET', '/api/settings');
  await a('settings: server device', 'GET', '/api/settings/device');
  await a('settings: my device', 'GET', '/api/settings/my-device', { exact: true });
  await a('settings: security', 'GET', '/api/settings/security', { exact: true });
  await a('settings: logo', 'GET', '/api/settings/logo');
  await a('settings: bad duration', 'PUT', '/api/settings', { body: { display: { defaultSlideDurationSeconds: 0 } }, exact: true });
  await a('settings: nothing to change', 'PUT', '/api/settings', { body: { nope: 1 }, exact: true });
  await a('settings: display saved', 'PUT', '/api/settings', { body: { display: { defaultSlideDurationSeconds: 10, showDeviceInfo: true } } });
  await a('password: wrong current', 'PUT', '/api/settings/password', { body: { current: 'nope', newPassword: 'longenough1' }, exact: true });
  await a('password: too short', 'PUT', '/api/settings/password', { body: { current: 'Admin@12345', newPassword: 'short' }, exact: true });
  await a('password: missing', 'PUT', '/api/settings/password', { body: {}, exact: true });
  await a('updates: info', 'GET', '/api/settings/updates');
  await a('updates: notice', 'GET', '/api/settings/updates/notice', { exact: true });
  await a('updates: installer', 'GET', '/api/settings/updates/installer');
  await a('updates: version', 'GET', '/api/settings/version');
  await a('updates: branches', 'GET', '/api/settings/updates/branches');
  await a('updates: check, invalid name', 'POST', '/api/settings/updates/check', { body: { branch: '../x' }, exact: true });
  await a('updates: check, missing branch', 'POST', '/api/settings/updates/check', { body: { branch: 'no-such-branch-xyz' }, exact: true });
  // The update schedule (this copy has no updater units: checked, then refused)
  await a('updates: schedule, bad', 'PUT', '/api/settings/updates/schedule', { body: { every: 'sometimes' }, exact: true });
  await a('updates: schedule, updater not set up', 'PUT', '/api/settings/updates/schedule', { body: { every: 'manual' }, exact: true });
  await a('updates: install at, bad', 'PUT', '/api/settings/updates/install-at', { body: { at: 'soon' }, exact: true });
  await a('updates: install now, updater not set up', 'POST', '/api/settings/updates/install-now', { exact: true });
  await a('updates: verify, wrong password', 'POST', '/api/settings/updates/verify-password', { body: { password: 'nope', branch: 'main' }, exact: true });
  await a('updates: switch, no token', 'POST', '/api/settings/updates/switch', { body: { branch: 'main', token: 'x' }, exact: true });

  // Slideshows and slides
  const created = await a('slideshow: create', 'POST', '/api/slideshows', { body: { name: 'Contract test' } });
  const folder = created.json.folder;
  await a('slideshow: create, no name', 'POST', '/api/slideshows', { body: {}, exact: true });
  await a('slideshows: list', 'GET', '/api/slideshows');
  await a('slideshow: get', 'GET', `/api/slideshows/${folder}`);
  await a('slideshow: get, missing', 'GET', '/api/slideshows/no-such-show', { exact: true });
  await a('slideshow: bad duration', 'PUT', `/api/slideshows/${folder}`, { body: { slideDurationSeconds: 5000 }, exact: true });
  await a('slideshow: hide while published', 'PUT', `/api/slideshows/${folder}`, { body: { enabled: true, hidden: true }, exact: true });
  await a('slideshow: update', 'PUT', `/api/slideshows/${folder}`, { body: { slideDurationSeconds: 7, priority: 2 } });
  await a('slides: list, empty', 'GET', `/api/slideshows/${folder}/slides`, { exact: true });
  await a('slides: list, missing slideshow', 'GET', '/api/slideshows/no-such-show/slides', { exact: true });
  await a('slides: upload nothing', 'POST', `/api/slideshows/${folder}/slides`, { body: new FormData(), exact: true });
  const bad = new FormData();
  bad.append('files', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  await a('slides: upload unsupported', 'POST', `/api/slideshows/${folder}/slides`, { body: bad, exact: true });
  const form = new FormData();
  form.append('files', new Blob([await sharp({ create: { width: 64, height: 36, channels: 3, background: '#39c' } }).png().toBuffer()], { type: 'image/png' }), 'a.png');
  const up = await a('slides: upload', 'POST', `/api/slideshows/${folder}/slides`, { body: form });
  const id = up.json[0].id;
  for (let i = 0; i < 40; i++) {
    const r = await s.api('GET', `/api/slideshows/${folder}/slides`);
    if (r.data?.[0]?.status === 'ready') break;
    await sleep(250);
  }
  await a('slides: list, ready', 'GET', `/api/slideshows/${folder}/slides`);
  const file = (await s.api('GET', `/api/slideshows/${folder}/slides`)).data[0].filename;
  const media = await record('media: slide image', env, 'GET', `/media/${folder}/slides/${file}`);
  records['media headers'] = { content: [media.res.headers.get('accept-ranges')] };
  await a('slides: reorder, bad body', 'PUT', `/api/slideshows/${folder}/slides/reorder`, { body: { order: 'x' }, exact: true });
  await a('slides: reorder', 'PUT', `/api/slideshows/${folder}/slides/reorder`, { body: { order: [id] } });
  await a('slide: rename', 'PATCH', `/api/slideshows/${folder}/slides/${id}`, { body: { name: 'Front desk' } });
  await a('slide: rename, too long', 'PATCH', `/api/slideshows/${folder}/slides/${id}`, { body: { name: 'x'.repeat(201) }, exact: true });
  await a('slide: rename, missing', 'PATCH', `/api/slideshows/${folder}/slides/no-such-slide`, { body: { name: 'x' }, exact: true });
  await a('slides: thumbnails', 'POST', `/api/slideshows/${folder}/slides/thumbnails`, { exact: true });
  await s.api('PUT', `/api/slideshows/${folder}`, { enabled: true });

  // The socket, as a display sees it
  const events = await new Promise((resolve) => {
    const got = {};
    const sock = io(env.base, { transports: ['websocket'] });
    sock.onAny((name, payload) => { got[name] = payload; });
    sock.on('connect', () => sock.emit('display:ready'));
    setTimeout(() => { sock.close(); resolve(got); }, 2000);
  });
  records['socket events'] = { content: Object.keys(events).sort() };
  records['socket: display:build'] = { content: shape(events['display:build']) };
  records['socket: display:settings'] = { content: shape(events['display:settings']) };
  records['socket: playlist:update'] = { content: shape(events['playlist:update']) };
  const slide = events['playlist:update']?.slides?.find((x) => x.slideshow === folder);
  records['playlist slide values'] = { content: slide ? { type: slide.type, url: slide.url.replace(/[^/]+$/, 'FILE'), duration: slide.duration } : null };

  await a('slide: delete', 'DELETE', `/api/slideshows/${folder}/slides/${id}`, { exact: true });
  await a('slide: delete, missing', 'DELETE', `/api/slideshows/${folder}/slides/${id}`, { exact: true });
  await s.api('PUT', `/api/slideshows/${folder}`, { enabled: false });
  await a('slideshow: delete', 'DELETE', `/api/slideshows/${folder}`, { exact: true });
  await a('slideshow: delete, missing', 'DELETE', `/api/slideshows/${folder}`, { exact: true });

  // MAC filtering, seen from this PC's network address (not localhost), which isn't approved
  const lan = lanAddress();
  if (lan) {
    await s.api('PUT', '/api/settings', { macFiltering: { enabled: true, approved: [{ mac: 'localhost', label: 'Server itself' }] } });
    const remote = `http://${lan}:${env.port}`;
    for (const [name, p] of [['viewer', '/'], ['admin', '/admin/'], ['guide', '/admin/help'], ['api status', '/api/auth/status'], ['api settings', '/api/settings'], ['media', '/media/x/slides/a.png']]) {
      await record(`MAC denied: ${name}`, env, 'GET', p, { host: remote, cookie, exact: true }).catch(() => {});
    }
    await record('MAC filter on, localhost still allowed', env, 'GET', '/api/auth/status', { exact: true });
    await s.api('PUT', '/api/settings', { macFiltering: { enabled: false, approved: [] } });
  } else {
    console.log('(no network address found: the MAC-denied checks are skipped)');
  }

  // Delete All: the password step, then the action with its token
  await a('maintenance: verify, unknown action', 'POST', '/api/settings/maintenance/verify-password', { body: { password: 'Admin@12345', action: 'x' }, exact: true });
  await a('maintenance: verify, wrong password', 'POST', '/api/settings/maintenance/verify-password', { body: { password: 'nope', action: 'delete-all' }, exact: true });
  await a('maintenance: delete all, no token', 'POST', '/api/settings/maintenance/delete-all', { body: {}, exact: true });
  const verified = await a('maintenance: verify', 'POST', '/api/settings/maintenance/verify-password', { body: { password: 'Admin@12345', action: 'delete-all' } });
  await a('maintenance: delete all', 'POST', '/api/settings/maintenance/delete-all', { body: { token: verified.json.token } });
  await a('maintenance: restore defaults, no token', 'POST', '/api/settings/maintenance/restore-defaults', { body: {}, exact: true });
  const forRestore = await s.api('POST', '/api/settings/maintenance/verify-password', { password: 'Admin@12345', action: 'restore-defaults' });
  await a('maintenance: restore defaults, updater not set up', 'POST', '/api/settings/maintenance/restore-defaults', { body: { token: forRestore.data.token }, exact: true });

  await a('logout', 'POST', '/api/auth/logout', { exact: true });
  await s.stop();

  // ── Compare with (or record) the baseline ──
  if (!fs.existsSync(SNAPSHOT) || process.env.NB_UPDATE_SNAPSHOT === '1') {
    fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(records, null, 2)}\n`);
    check(`recorded the contract (${Object.keys(records).length} entries) in tests/fixtures/api-contract.json`, true);
  } else {
    const want = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    for (const name of new Set([...Object.keys(want), ...Object.keys(records)])) {
      const same = JSON.stringify(want[name]) === JSON.stringify(records[name]);
      if (!same && !(name.startsWith('MAC denied') && !lan)) {
        check(name, false, `was ${JSON.stringify(want[name])?.slice(0, 200)}; now ${JSON.stringify(records[name])?.slice(0, 200)}`);
      }
    }
    check(`all ${Object.keys(want).length} contract entries unchanged`, Object.keys(want).every((n) => JSON.stringify(want[n]) === JSON.stringify(records[n]) || (n.startsWith('MAC denied') && !lan)));
  }
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
