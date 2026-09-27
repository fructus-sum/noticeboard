// The pages the server sends when the web apps haven't been built (e.g. an update's build failed
// half way): the viewer's and the admin panel's "not yet built" pages, for any path. Recorded in
// tests/fixtures/spa-fallback.json from the code before routes/spa.js replaced the two separate
// fallbacks (NB_UPDATE_SNAPSHOT=1 records it again, only for a deliberate change).
const fs = require('fs');
const path = require('path');
const { makeApp, server, check, done } = require('../helpers/app.js');

const SNAPSHOT = path.join(__dirname, '..', 'fixtures', 'spa-fallback.json');

(async () => {
  const env = makeApp({ port: 3933 });
  for (const app of ['admin', 'display']) fs.rmSync(path.join(env.APP, 'client', app, 'dist', 'index.html'), { force: true });
  const s = server(env);
  await s.start();
  const pages = {};
  for (const p of ['/', '/some/page', '/admin/', '/admin/settings']) {
    const res = await fetch(env.base + p);
    pages[p] = { status: res.status, type: (res.headers.get('content-type') || '').split(';')[0], body: await res.text() };
  }
  await s.stop();

  if (!fs.existsSync(SNAPSHOT) || process.env.NB_UPDATE_SNAPSHOT === '1') {
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(pages, null, 2)}\n`);
    check(`recorded the "not built" pages for ${Object.keys(pages).length} paths in tests/fixtures/spa-fallback.json`, true);
  } else {
    const want = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    for (const p of Object.keys(want)) {
      check(`${p}: the same page when the app isn't built`, JSON.stringify(want[p]) === JSON.stringify(pages[p]),
        JSON.stringify(pages[p]).slice(0, 160));
    }
  }
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
