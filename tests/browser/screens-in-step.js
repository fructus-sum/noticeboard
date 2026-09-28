// Every screen in step (SYSTEM_DESIGN §18.8). Two viewers in one browser, each told its own clock is
// minutes out (?debugClockOffset, in opposite directions), must still agree on the Server's time
// (phase 1) and show the same slide at the same moment, including a third one that joins later and
// after a playlist change, which both follow at the same boundary (phase 2).
const path = require('path');
const { MODULES, makeApp, server, page, check, done, sleep } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));
const { connect } = require('../helpers/cdp.js');

(async () => {
  const env = makeApp({ port: 3968 });
  const s = server(env);
  await s.start();
  await s.login();
  // A slideshow of three 2-second images, each its own colour
  const ss = (await s.api('POST', '/api/slideshows', { name: 'Lobby' })).data.folder;
  for (const colour of ['#c33', '#3c3', '#33c']) {
    const f = new FormData();
    f.append('files', new Blob([await sharp({ create: { width: 160, height: 90, channels: 3, background: colour } }).png().toBuffer()], { type: 'image/png' }), `${colour.slice(1)}.png`);
    await s.api('POST', `/api/slideshows/${ss}/slides`, f);
  }
  for (let i = 0; i < 50 && !(await s.api('GET', `/api/slideshows/${ss}/slides`)).data.every((x) => x.status === 'ready'); i++) await sleep(100);
  await s.api('PUT', `/api/slideshows/${ss}`, { enabled: true, slideDurationSeconds: 2 });
  await sleep(500);

  const viewer = async (offsetMs) => {
    // A window each, so every viewer is visible, as a real screen is
    const v = await page(() => connect(9222, { newWindow: true }), { width: 480, height: 270 });
    await v.go(`${env.base}/?kiosk=off&debugClockOffset=${offsetMs}`);
    return v;
  };
  const a = await viewer(-5 * 60_000);
  const b = await viewer(3 * 60_000 + 417);
  const synced = (v) => v.until('window.noticeboardClock && window.noticeboardClock().synced', 10000);
  check('both screens measure their clock against the Server\'s', await synced(a) && await synced(b));

  // The Server's time here is this machine's own clock (the test and the Server share it)
  const read = async (v) => { const before = Date.now(); const c = await v.evaluate('window.noticeboardClock()'); const after = Date.now(); return { ...c, truth: (before + after) / 2 }; };
  const ca = await read(a);
  const cb = await read(b);
  check('a clock 5 minutes slow: its Server time is right (within 100 ms)', Math.abs(ca.serverNow - ca.truth) < 100 && Math.abs(ca.offset - 5 * 60_000) < 100, JSON.stringify({ off: ca.serverNow - ca.truth, offset: ca.offset, roundTrip: ca.roundTrip }));
  check('a clock 3 minutes fast: its Server time is right (within 100 ms)', Math.abs(cb.serverNow - cb.truth) < 100, JSON.stringify({ off: cb.serverNow - cb.truth, offset: cb.offset, roundTrip: cb.roundTrip }));

  // The slide on screen: the newest layer's image
  const onScreen = (v) => v.evaluate(`(() => { const imgs = [...document.querySelectorAll('.slideshow img')]; return imgs.length ? imgs[imgs.length - 1].getAttribute('src') : null; })()`);
  const sameSlide = async (tag, views) => {
    let agree = 0;
    let tries = 0;
    for (let i = 0; i < 16; i++) {
      await sleep(700 + (i % 3) * 110);   // at various points in the slides
      const shown = await Promise.all(views.map(onScreen));
      tries += 1;
      if (shown.every((x) => x && x === shown[0])) agree += 1;
    }
    // Right at a boundary one screen may be a few ms ahead: nearly every sample must agree
    check(`${tag}: the same slide on every screen (${agree} of ${tries} samples)`, agree >= tries - 2);
  };
  await a.until(`!!document.querySelector('.slideshow img')`, 10000);
  await b.until(`!!document.querySelector('.slideshow img')`, 10000);
  await sameSlide('two screens with clocks minutes out', [a, b]);
  const c = await viewer(-47_000);
  await c.until(`!!document.querySelector('.slideshow img')`, 10000);
  await sameSlide('a third screen joining later goes straight to the same slide', [a, b, c]);

  // A playlist change: every screen switches at the same boundary
  await s.api('PUT', `/api/slideshows/${ss}`, { slideDurationSeconds: 3 });
  await sleep(3500);
  await sameSlide('after a change, all three follow the new timeline together', [a, b, c]);

  a.close();
  b.close();
  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
