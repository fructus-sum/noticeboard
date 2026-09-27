// What a connected display receives, event by event, for each admin action: which events, how many,
// and what they carry (the playlist's slides, the display settings). Recorded in
// tests/fixtures/socket-events.json from the code before the playlist and the socket had their
// own modules; the sequence must stay exactly the same (NB_UPDATE_SNAPSHOT=1 records it again, only for a deliberate change).
const fs = require('fs');
const path = require('path');
const { MODULES, makeApp, server, check, done, sleep } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));
const { io } = require(path.join(MODULES, 'socket.io-client'));

const SNAPSHOT = path.join(__dirname, '..', 'fixtures', 'socket-events.json');

function summary(name, payload) {
  if (name === 'playlist:update') {
    return `${name} ${payload.slides.map((s) => `${s.slideshow}:${s.type}:${s.duration}`).join(',') || '(empty)'}`;
  }
  if (name === 'display:settings') return `${name} ${JSON.stringify(payload).replace(/v=\d+/, 'v=V')}`;
  if (name === 'display:build') return `${name} ${typeof payload}`;
  return name;
}

(async () => {
  const env = makeApp({ port: 3932 });
  const s = server(env);
  await s.start();
  await s.login();
  const png = async (c) => new Blob([await sharp({ create: { width: 64, height: 36, channels: 3, background: c } }).png().toBuffer()], { type: 'image/png' });

  let received = [];
  const sock = io(env.base, { transports: ['websocket'] });
  sock.onAny((name, payload) => received.push(summary(name, payload)));
  sock.on('connect', () => sock.emit('display:ready'));
  const steps = {};
  const step = async (name, action, settleMs = 1500) => {
    received = [];
    await action();
    await sleep(settleMs);
    steps[name] = received;
  };
  const waitReady = async (folder) => {
    for (let i = 0; i < 80; i++) {
      const slides = (await s.api('GET', `/api/slideshows/${folder}/slides`)).data;
      if (slides.length && !slides.some((x) => x.status === 'processing')) return slides;
      await sleep(100);
    }
    throw new Error('processing never finished');
  };
  const upload = async (folder, colour) => {
    const form = new FormData();
    form.append('files', await png(colour), 'a.png');
    await s.api('POST', `/api/slideshows/${folder}/slides`, form);
    return waitReady(folder);
  };

  await step('01 connect', async () => {}, 2000);
  let folder;
  await step('02 create a slideshow', async () => { folder = (await s.api('POST', '/api/slideshows', { name: 'Events' })).data.folder; });
  await step('03 upload an image (unpublished)', () => upload(folder, '#c0392b'));
  await step('04 publish', () => s.api('PUT', `/api/slideshows/${folder}`, { enabled: true }));
  await step('05 change its duration', () => s.api('PUT', `/api/slideshows/${folder}`, { slideDurationSeconds: 6 }));
  await step('06 upload another image (published)', () => upload(folder, '#2980b9'));
  let slides;
  await step('07 reorder', async () => {
    slides = (await s.api('GET', `/api/slideshows/${folder}/slides`)).data;
    await s.api('PUT', `/api/slideshows/${folder}/slides/reorder`, { order: [slides[1].id, slides[0].id] });
  });
  await step('08 delete a slide', () => s.api('DELETE', `/api/slideshows/${folder}/slides/${slides[0].id}`));
  await step('09 hide the location pin', () => s.api('PUT', '/api/settings', { display: { showDeviceInfo: false } }));
  await step('10 change the default duration', () => s.api('PUT', '/api/settings', { display: { defaultSlideDurationSeconds: 11 } }));
  await step('11 upload a logo', async () => {
    const form = new FormData();
    form.append('logo', await png('#f39c12'), 'logo.png');
    await s.api('POST', '/api/settings/logo', form);
  });
  await step('12 turn the logo off', () => s.api('PUT', '/api/settings', { display: { logo: { enabled: false } } }));
  await step('13 back to the default logo', () => s.api('DELETE', '/api/settings/logo'));
  await step('14 unpublish', () => s.api('PUT', `/api/slideshows/${folder}`, { enabled: false }));
  await step('15 delete the slideshow', () => s.api('DELETE', `/api/slideshows/${folder}`));
  sock.close();
  await s.stop();

  if (!fs.existsSync(SNAPSHOT) || process.env.NB_UPDATE_SNAPSHOT === '1') {
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(steps, null, 2)}\n`);
    check(`recorded what a display receives for ${Object.keys(steps).length} steps in tests/fixtures/socket-events.json`, true);
    for (const [name, events] of Object.entries(steps)) console.log(`      ${name}: ${events.join(' | ') || '(nothing)'}`);
  } else {
    const want = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    for (const name of Object.keys(want)) {
      check(`${name}: the same events`, JSON.stringify(want[name]) === JSON.stringify(steps[name]),
        `was ${want[name].join(' | ') || '(nothing)'}; now ${(steps[name] || []).join(' | ') || '(nothing)'}`);
    }
  }
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
