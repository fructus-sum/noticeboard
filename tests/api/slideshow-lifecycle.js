// Regression pass through the API (cleans up after itself):
// 3 rounds of 2-image uploads, then publish (live playlist), media served, reorder, schedule, disable, delete.
const path = require('path');
const { MODULES, makeApp, server: appServer, untilSlideEnds } = require('../helpers/app.js');
const ENV = makeApp({ port: 3923 });
const APP_SERVER = appServer(ENV);
const BASE = ENV.base;
const modules = MODULES;   // a node_modules folder to load sharp and socket.io-client from
const sharp = require(path.join(modules, 'sharp'));
const { io } = require(path.join(modules, 'socket.io-client'));
let cookie = '';
const api = async (method, p, body) => {
  const isForm = body instanceof FormData;
  const res = await fetch(BASE + '/api' + p, {
    method,
    headers: { Cookie: cookie, ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(data)}`);
  return { data, res };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (name, pass, detail = '') => { ok &&= pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

(async () => {
  await APP_SERVER.start();
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/api/auth/status'); break; } catch { await sleep(500); } }
  const login = await api('POST', '/auth/login', { password: 'Admin@12345' });
  cookie = login.res.headers.get('set-cookie').split(';')[0];

  let playlist = { slides: [] };
  const display = io(BASE, { transports: ['websocket'] });
  display.on('connect', () => display.emit('display:ready'));
  display.on('playlist:update', (p) => { playlist = p; });
  await sleep(1500);

  const folder = (await api('POST', '/slideshows', { name: 'zz regression test' })).data.folder;
  try {
    const colors = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#f39c12', '#16a085'];
    for (let round = 0; round < 3; round++) {
      const form = new FormData();
      for (const color of colors.slice(round * 2, round * 2 + 2)) {
        const png = await sharp({ create: { width: 320, height: 180, channels: 3, background: color } }).png().toBuffer();
        form.append('files', new Blob([png], { type: 'image/png' }), `test-${color.slice(1)}.png`);
      }
      await api('POST', `/slideshows/${folder}/slides`, form);
      await sleep(4000);   // tiny images: processing takes well under a second
    }
    const slides = (await api('GET', `/slideshows/${folder}/slides`)).data;
    const counts = slides.reduce((m, s) => ({ ...m, [s.status]: (m[s.status] || 0) + 1 }), {});
    check('6 images uploaded 2 at a time are all processed', slides.length === 6 && counts.ready === 6, JSON.stringify(counts));

    const ready = slides.filter((s) => s.status === 'ready');
    await api('PUT', `/slideshows/${folder}`, { enabled: true, schedule: { type: 'always' } });
    await sleep(2500);
    const live = playlist.slides.filter((s) => s.slideshow === folder);
    check('publish -> display gets every ready slide live', ready.length > 0 && live.length === ready.length, `${live.length} of ${ready.length} ready`);
    const media = await fetch(BASE + live[0].url);
    check('processed image is served to the display', media.ok && media.headers.get('content-type') === 'image/png', `HTTP ${media.status}`);

    const order = [...slides].reverse().map((s) => s.id);
    const reordered = (await api('PUT', `/slideshows/${folder}/slides/reorder`, { order })).data;
    check('reorder slides', reordered.map((s) => s.id).join() === order.join());

    await api('PUT', `/slideshows/${folder}`, { enabled: false });
    await sleep(500);
    await untilSlideEnds(playlist);   // the change reaches the screens when the slide on air ends
    check('disable -> slides leave the display', playlist.slides.every((s) => s.slideshow !== folder));
  } finally {
    await api('DELETE', `/slideshows/${folder}`);
    const left = (await api('GET', '/slideshows')).data.some((s) => s.folder === folder);
    check('delete test slideshow (cleanup)', !left);
    display.close();
  }
  await APP_SERVER.stop();
  require('fs').rmSync(ENV.T, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
