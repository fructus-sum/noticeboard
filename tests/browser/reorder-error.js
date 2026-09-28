// A reorder that can't be saved is shown (SYSTEM_DESIGN §18.5 item 7): moving a slide saves the new
// order; when that fails (here the slideshow was deleted from another tab), the slide list says so
// instead of silently showing an order that isn't saved. A move that works shows nothing.
const path = require('path');
const { MODULES, makeApp, server, page, check, done, sleep } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');
const sharp = require(path.join(MODULES, 'sharp'));

(async () => {
  const env = makeApp({ port: 3964 });
  const s = server(env);
  await s.start();
  await s.login();
  const folder = (await s.api('POST', '/api/slideshows', { name: 'Lobby' })).data.folder;
  for (const colour of ['#c33', '#3c3']) {
    const f = new FormData();
    f.append('files', new Blob([await sharp({ create: { width: 320, height: 180, channels: 3, background: colour } }).png().toBuffer()], { type: 'image/png' }), `${colour.slice(1)}.png`);
    await s.api('POST', `/api/slideshows/${folder}/slides`, f);
  }
  for (let i = 0; i < 50; i++) {
    const slides = (await s.api('GET', `/api/slideshows/${folder}/slides`)).data;
    if (slides.length === 2 && slides.every((x) => x.status === 'ready')) break;
    await sleep(100);
  }

  const c = await page(connect, { width: 1100, height: 900 });
  await c.login(env.base);
  await c.go(`${env.base}/admin/slideshows/${folder}`);
  await c.until(`document.querySelectorAll('.slide-row').length === 2`);
  const moveDown = `[...document.querySelectorAll('.slide-row')][0].querySelectorAll('button')].find((b) => b.textContent.trim() === '↓').click()`;
  await c.evaluate(`[...${moveDown}`);
  await sleep(800);
  check('a move that is saved shows no error', !(await c.evaluate(`!!document.querySelector('.move-error')`)));

  await s.api('DELETE', `/api/slideshows/${folder}`);
  await c.evaluate(`[...${moveDown}`);
  check('a move that can\'t be saved says so', await c.until(`(document.querySelector('.move-error')?.textContent ?? '').includes("Couldn't save the new order: Slideshow not found")`, 5000),
    await c.evaluate(`document.querySelector('.move-error')?.textContent ?? '(no message)'`));

  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
