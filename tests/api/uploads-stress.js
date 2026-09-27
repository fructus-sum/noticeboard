// Stress the upload path: 10 images at once, then (while those are processing) a second
// batch of 4 and a reorder. Every slide must end up ready and the reorder must stick.
const path = require('path');
const { MODULES, makeApp, server: appServer } = require('../helpers/app.js');
const ENV = makeApp({ port: 3922 });
const APP_SERVER = appServer(ENV);
const BASE = ENV.base;
const modules = MODULES;
const sharp = require(path.join(modules, 'sharp'));
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
const images = async (n, seed) => {
  const form = new FormData();
  for (let i = 0; i < n; i++) {
    const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: { r: (seed * 40 + i * 20) % 256, g: i * 12, b: 200 - i * 10 } } }).png().toBuffer();
    form.append('files', new Blob([png], { type: 'image/png' }), `img-${seed}-${i}.png`);
  }
  return form;
};
let ok = true;
const check = (name, pass, detail = '') => { ok &&= pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

(async () => {
  await APP_SERVER.start();
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/api/auth/status'); break; } catch { await sleep(500); } }
  const login = await api('POST', '/auth/login', { password: 'Admin@12345' });
  cookie = login.res.headers.get('set-cookie').split(';')[0];
  const folder = (await api('POST', '/slideshows', { name: 'zz upload stress test' })).data.folder;
  try {
    const [form1, form2] = [await images(10, 1), await images(4, 2)];
    const batch1 = (await api('POST', `/slideshows/${folder}/slides`, form1)).data.map((s) => s.id);
    // While batch 1 is processing: upload batch 2 and reorder batch 1 (reverse), both at once
    const wanted = [...batch1].reverse();
    const [b2] = await Promise.all([
      api('POST', `/slideshows/${folder}/slides`, form2),
      api('PUT', `/slideshows/${folder}/slides/reorder`, { order: wanted }),
    ]);
    const batch2 = b2.data.map((s) => s.id);

    let slides = [];
    for (let i = 0; i < 90; i++) {
      slides = (await api('GET', `/slideshows/${folder}/slides`)).data;
      if (!slides.some((s) => s.status === 'processing')) break;
      await sleep(500);
    }
    const counts = slides.reduce((m, s) => ({ ...m, [s.status]: (m[s.status] || 0) + 1 }), {});
    check('all 14 slides kept (none lost)', slides.length === 14, `${slides.length} slides`);
    check('every slide processed (none stuck on "processing")', counts.ready === 14, JSON.stringify(counts));
    const ids = slides.map((s) => s.id);
    const batch1Order = ids.filter((id) => batch1.includes(id));
    check('reorder made during processing stuck', batch1Order.join() === wanted.join());
    check('second batch all present', batch2.every((id) => ids.includes(id)));
  } finally {
    await api('DELETE', `/slideshows/${folder}`);
    check('cleanup', !(await api('GET', '/slideshows')).data.some((s) => s.folder === folder));
  }
  await APP_SERVER.stop();
  require('fs').rmSync(ENV.T, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
