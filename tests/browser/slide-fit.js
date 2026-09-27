// Slides fit the screen whole (SYSTEM_DESIGN §3.5): a landscape and a portrait image, each in a
// portrait and a landscape window, are drawn entirely, in their own shape, and the background
// colour chosen in Settings fills the rest. Checked on the screen's pixels, plus the admin's
// colour setting (saved in lower case; a bad code refused) and the display:settings it sends.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { connect } = require('../helpers/cdp.js');
const { makeApp, server, page, check, done, sleep, MODULES } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));

const MAGENTA = { r: 255, g: 0, b: 255 };
const near = (p, c) => Math.abs(p.r - c.r) < 24 && Math.abs(p.g - c.g) < 24 && Math.abs(p.b - c.b) < 24;

async function pixels(c, file) {
  await c.screenshot(file);
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return (x, y) => {
    const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };
}

(async () => {
  const env = makeApp({ port: 3939 });
  const s = server(env);
  await s.start();
  await s.login();

  // The colour setting
  const before = (await s.api('GET', '/api/settings')).data?.display;
  const bad = await s.api('PUT', '/api/settings', { display: { backgroundColor: 'magenta' } });
  check('a colour that isn\'t a colour code is refused (400)', bad.status === 400, `HTTP ${bad.status} ${bad.data?.error ?? ''}`);
  const good = await s.api('PUT', '/api/settings', { display: { backgroundColor: '#FF00FF' } });
  const saved = (await s.api('GET', '/api/settings')).data?.display?.backgroundColor;
  check('a colour code is saved, in lower case', good.status === 200 && saved === '#ff00ff', `HTTP ${good.status}, saved ${saved}`);
  const { backgroundColor, ...rest } = (await s.api('GET', '/api/settings')).data?.display ?? {};
  check('saving the colour keeps the other display settings', JSON.stringify(rest) === JSON.stringify(before), JSON.stringify(rest));

  // Two slideshows: a wide green image, a tall blue one; one published at a time
  async function slideshowWith(name, width, height, colour) {
    const folder = (await s.api('POST', '/api/slideshows', { name })).data.folder;
    const png = await sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer();
    const form = new FormData();
    form.append('files', new Blob([png], { type: 'image/png' }), `${name}.png`);
    await s.api('POST', `/api/slideshows/${folder}/slides`, form);
    for (let i = 0; i < 80; i++) {
      const slides = (await s.api('GET', `/api/slideshows/${folder}/slides`)).data;
      if (slides.every((x) => x.status === 'ready')) break;
      await sleep(250);
    }
    return folder;
  }
  const wide = await slideshowWith('wide', 1600, 800, '#00c800');
  const tall = await slideshowWith('tall', 600, 1200, '#0000c8');

  const shot = path.join(os.tmpdir(), 'noticeboard-test-slide-fit.png');
  async function look(label, folder, want, colour) {
    await s.api('PUT', `/api/slideshows/${wide}`, { enabled: folder === wide });
    await s.api('PUT', `/api/slideshows/${tall}`, { enabled: folder === tall });
    for (const [wName, width, height] of [['a portrait window', 540, 960], ['a landscape window', 960, 540]]) {
      const c = await page(connect, { width, height });
      await c.go(env.base + '/?kiosk=off');
      const shown = await c.until(`(() => { const img = document.querySelector('.slide-img'); return !!img && img.complete && img.naturalWidth === ${want.w} && getComputedStyle(img).opacity === '1'; })()`, 15000);
      await sleep(600);
      const fit = await c.evaluate(`getComputedStyle(document.querySelector('.slide-img')).objectFit`);
      const px = await pixels(c, shot);
      // Where the whole image should be: scaled to fit, centred
      const scale = Math.min(width / want.w, height / want.h);
      const w = want.w * scale;
      const h = want.h * scale;
      const x0 = (width - w) / 2;
      const y0 = (height - h) / 2;
      const inside = [[x0 + 3, y0 + 3], [x0 + w - 4, y0 + 3], [x0 + 3, y0 + h - 4], [x0 + w - 4, y0 + h - 4], [width / 2, height / 2]];
      const outside = x0 > 6 ? [[2, height / 2], [width - 3, height / 2]] : [[width / 2, 2], [width / 2, height - 3]];
      const allIn = inside.every(([x, y]) => near(px(x, y), colour));
      const allOut = (x0 > 6 || y0 > 6) ? outside.every(([x, y]) => near(px(x, y), MAGENTA)) : true;
      check(`${label} in ${wName}: drawn whole, in its own shape (${Math.round(w)} × ${Math.round(h)}), on the chosen colour`,
        shown && fit === 'contain' && allIn && allOut,
        `shown ${shown}, object-fit ${fit}, corners ${allIn ? 'image' : 'CUT OFF'}, around it ${allOut ? 'the colour' : JSON.stringify(outside.map(([x, y]) => px(x, y)))}`);
      c.close();
    }
  }
  await look('A landscape image', wide, { w: 1600, h: 800 }, { r: 0, g: 200, b: 0 });
  await look('A portrait image', tall, { w: 600, h: 1200 }, { r: 0, g: 0, b: 200 });

  // Nothing published: the waiting screen is on the same colour
  await s.api('PUT', `/api/slideshows/${tall}`, { enabled: false });
  const c = await page(connect, { width: 800, height: 600 });
  await c.go(env.base + '/?kiosk=off');
  await c.until(`!!document.querySelector('.waiting .message')`, 10000);
  await sleep(400);
  const bg = await c.evaluate(`getComputedStyle(document.querySelector('.waiting')).backgroundColor`);
  check('the waiting screen uses the chosen colour too', bg === 'rgb(255, 0, 255)', bg);
  // Back to the default: black again
  await s.api('PUT', '/api/settings', { display: { backgroundColor: '#000000' } });
  const black = await c.until(`getComputedStyle(document.querySelector('.waiting')).backgroundColor === 'rgb(0, 0, 0)'`, 8000);
  check('a change reaches an open screen by itself (display:settings)', black);
  c.close();
  fs.rmSync(shot, { force: true });

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
