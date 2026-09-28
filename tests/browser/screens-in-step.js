// Every screen in step (SYSTEM_DESIGN §18.8). Two viewers in one browser, each told its own clock is
// minutes out (?debugClockOffset, in opposite directions), must still agree on the Server's time
// (phase 1) and show the same slide at the same moment, including a third one that joins later and
// after a playlist change, which both follow at the same boundary (phase 2), and play the same track
// of the slideshow's music at the same point (phase 3; needs ffmpeg). A headless browser may refuse
// sound at first: a click on each screen lets it play, as on a real one.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { MODULES, makeApp, server, page, check, done, sleep, ffmpegEnv, hasFfmpeg } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));
const { connect } = require('../helpers/cdp.js');

(async () => {
  const env = makeApp({ port: 3968 });
  const s = server(env);
  await s.start(ffmpegEnv());
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

  // ── The music: the same track at the same point on every screen ──
  if (!hasFfmpeg()) {
    console.log('      (the music checks need ffmpeg: skipped)');
  } else {
    const FFMPEG = ffmpegEnv().FFMPEG_PATH || 'ffmpeg';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-in-step-'));
    const music = (await s.api('POST', '/api/audioshows', { name: 'Lobby music' })).data.folder;
    for (const [name, hz, secs] of [['low', 440, 9], ['high', 660, 7]]) {
      execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${secs}`, '-c:a', 'libmp3lame', path.join(dir, `${name}.mp3`)]);
      const f = new FormData();
      f.append('files', new Blob([fs.readFileSync(path.join(dir, `${name}.mp3`))], { type: 'audio/mpeg' }), `${name}.mp3`);
      await s.api('POST', `/api/audioshows/${music}/tracks`, f);
    }
    for (let i = 0; i < 300 && !(await s.api('GET', `/api/audioshows/${music}/tracks`)).data.every((t) => t.status === 'ready'); i++) await sleep(100);
    await s.api('PUT', `/api/audioshows/${music}`, { enabled: true });
    await s.api('PUT', `/api/slideshows/${ss}`, { audioShow: music });
    const audioOf = (v) => v.evaluate('window.noticeboardAudio ? window.noticeboardAudio() : null');
    for (const v of [a, b, c]) {
      await v.until('window.noticeboardAudio && (window.noticeboardAudio().playing || window.noticeboardAudio().blocked)', 10000);
      if ((await audioOf(v)).blocked) {
        for (const type of ['mousePressed', 'mouseReleased']) await v.send('Input.dispatchMouseEvent', { type, x: 240, y: 135, button: 'left', clickCount: 1 });
      }
    }
    const allPlaying = await Promise.all([a, b, c].map((v) => v.until('window.noticeboardAudio().playing', 5000)));
    check('the music plays on every screen', allPlaying.every(Boolean), JSON.stringify(await Promise.all([a, b, c].map(audioOf))));
    // The loudest element playing on each screen: its file and how far in it is
    const heard = async (v) => {
      const st = await audioOf(v);
      const el = st.elements.filter((e) => !e.paused && e.src).sort((x, y) => y.volume - x.volume)[0];
      return el ? { src: el.src, time: el.time } : null;
    };
    let agree = 0;
    let tries = 0;
    let worst = 0;
    for (let i = 0; i < 16; i++) {
      await sleep(900 + (i % 3) * 130);
      const now = await Promise.all([a, b, c].map(heard));
      tries += 1;
      if (now.every((x) => x && x.src === now[0].src)) {
        const spread = Math.max(...now.map((x) => x.time)) - Math.min(...now.map((x) => x.time));
        worst = Math.max(worst, spread);
        if (spread <= 0.4) agree += 1;
      }
    }
    // Right at a track change one screen may be a moment ahead: nearly every sample must agree
    check(`the same track at the same point on every screen (${agree} of ${tries} samples)`, agree >= tries - 2, `at most ${worst.toFixed(2)} s apart`);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  a.close();
  b.close();
  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
