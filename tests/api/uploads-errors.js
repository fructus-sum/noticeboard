// Upload 4 images (one of them broken) and delete a good one while the batch is processing.
// The broken one must end as "error" (not stuck), the deleted one must stay deleted.
const path = require('path');
const { MODULES, makeApp, server: appServer } = require('../helpers/app.js');
const ENV = makeApp({ port: 3921 });
const APP_SERVER = appServer(ENV);
const BASE = ENV.base;
const sharp = require(path.join(MODULES, 'sharp'));
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
  cookie = (await api('POST', '/auth/login', { password: 'Admin@12345' })).res.headers.get('set-cookie').split(';')[0];
  const folder = (await api('POST', '/slideshows', { name: 'zz upload error test' })).data.folder;
  try {
    const form = new FormData();
    const good = (c) => sharp({ create: { width: 1920, height: 1080, channels: 3, background: c } }).png().toBuffer();
    form.append('files', new Blob([await good('#aa0000')], { type: 'image/png' }), 'good-1.png');
    form.append('files', new Blob([Buffer.from('this is not really a png')], { type: 'image/png' }), 'broken.png');
    form.append('files', new Blob([await good('#00aa00')], { type: 'image/png' }), 'good-2.png');
    form.append('files', new Blob([await good('#0000aa')], { type: 'image/png' }), 'good-3.png');
    const [g1, broken, g2, g3] = (await api('POST', `/slideshows/${folder}/slides`, form)).data.map((s) => s.id);
    await api('DELETE', `/slideshows/${folder}/slides/${g3}`);   // while the batch is processing

    let slides = [];
    for (let i = 0; i < 60; i++) {
      slides = (await api('GET', `/slideshows/${folder}/slides`)).data;
      if (!slides.some((s) => s.status === 'processing')) break;
      await sleep(500);
    }
    await sleep(3000);   // let the deleted slide's processing finish too; it must not come back
    slides = (await api('GET', `/slideshows/${folder}/slides`)).data;
    const byId = Object.fromEntries(slides.map((s) => [s.id, s]));
    check('deleted slide stays deleted after its processing finishes', !byId[g3], `${slides.length} slides left`);
    check('broken image ends as "error", not stuck', byId[broken]?.status === 'error', `${byId[broken]?.status}: ${byId[broken]?.error ?? ''}`.slice(0, 90));
    check('the good images are ready', byId[g1]?.status === 'ready' && byId[g2]?.status === 'ready');
  } finally {
    await api('DELETE', `/slideshows/${folder}`);
    check('cleanup', !(await api('GET', '/slideshows')).data.some((s) => s.folder === folder));
  }
  await APP_SERVER.stop();
  require('fs').rmSync(ENV.T, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
