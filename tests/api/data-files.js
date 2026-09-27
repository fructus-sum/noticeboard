// What the server writes to data/ for a fixed script of admin actions: config.json (without the
// secrets), every slideshow.json and the media file names, byte-for-byte after the random parts
// (ids, times, the sample's signature) are replaced with stable placeholders. Recorded in
// tests/fixtures/data-files.json from the code before the slideshow store existed;
// NB_UPDATE_SNAPSHOT=1 records it again, only for a deliberate change. Needs ffmpeg (the sample's
// video thumbnail).
const fs = require('fs');
const path = require('path');
const { MODULES, makeApp, server, check, done, sleep, hasFfmpeg } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));

if (!hasFfmpeg()) {
  console.log('SKIPPED: needs ffmpeg (FFMPEG_PATH and FFPROBE_PATH, or ffmpeg on the PATH)');
  process.exit(0);
}
const SNAPSHOT = path.join(__dirname, '..', 'fixtures', 'data-files.json');

// Stable placeholders: each distinct id becomes ID1, ID2… in order of first appearance
function normaliser() {
  const ids = new Map();
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  return (text) => text
    .replace(uuid, (m) => { if (!ids.has(m)) ids.set(m, `ID${ids.size + 1}`); return ids.get(m); })
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, 'TIME')
    .replace(/"signature": "[0-9a-f]{40}"/g, '"signature": "SHA1"')
    .replace(/"passwordHash": "[^"]+"/, '"passwordHash": "HASH"')
    .replace(/"jwtSecret": "[^"]+"/, '"jwtSecret": "SECRET"');
}

function listFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out;
}

(async () => {
  const env = makeApp({ port: 3928, keepSample: true });
  const s = server(env);
  await s.start();
  await s.login();
  const png = async (c) => new Blob([await sharp({ create: { width: 64, height: 36, channels: 3, background: c } }).png().toBuffer()], { type: 'image/png' });
  const waitReady = async (folder) => {
    for (let i = 0; i < 120; i++) {
      const slides = (await s.api('GET', `/api/slideshows/${folder}/slides`)).data;
      if (!slides.some((x) => x.status === 'processing' || x.thumbnailPending)) return slides;
      await sleep(250);
    }
    throw new Error('processing never finished');
  };

  // The sample, as first created (its video thumbnail made in the background)
  const sample = (await s.api('GET', '/api/slideshows')).data.find((x) => x.sample);
  await waitReady(sample.folder);

  // A slideshow with three images, one at a time so their order is fixed
  const a = (await s.api('POST', '/api/slideshows', { name: 'Front desk' })).data.folder;
  for (const c of ['#c0392b', '#2980b9', '#27ae60']) {
    const form = new FormData();
    form.append('files', await png(c), 'x.png');
    await s.api('POST', `/api/slideshows/${a}/slides`, form);
    await waitReady(a);
  }
  let slides = await waitReady(a);
  await s.api('PUT', `/api/slideshows/${a}/slides/reorder`, { order: [slides[2].id, slides[0].id, slides[1].id] });
  await s.api('PUT', `/api/slideshows/${a}/slides/reorder`, { order: [slides[2].id, slides[0].id, slides[1].id] });   // the same order again
  await s.api('DELETE', `/api/slideshows/${a}/slides/${slides[0].id}`);
  await s.api('PUT', `/api/slideshows/${a}`, { enabled: true, slideDurationSeconds: 7, priority: 1 });
  await s.api('POST', `/api/slideshows/${a}/slides/thumbnails`);   // no videos: nothing to do

  // A second one: hidden, with its own duration cleared, and a broken upload
  const b = (await s.api('POST', '/api/slideshows', { name: 'Old notices' })).data.folder;
  const bad = new FormData();
  bad.append('files', new Blob([Buffer.from('not a png')], { type: 'image/png' }), 'broken.png');
  await s.api('POST', `/api/slideshows/${b}/slides`, bad);
  await waitReady(b);
  await s.api('PUT', `/api/slideshows/${b}`, { slideDurationSeconds: 12 });
  await s.api('PUT', `/api/slideshows/${b}`, { slideDurationSeconds: null, hidden: true, schedule: { type: 'timed', days: [1, 2], startTime: '08:00', endTime: '17:00' } });

  // A third, deleted again; and the sample published
  const c = (await s.api('POST', '/api/slideshows', { name: 'Gone soon' })).data.folder;
  await s.api('DELETE', `/api/slideshows/${c}`);
  await s.api('PUT', `/api/slideshows/${sample.folder}`, { enabled: true });
  await s.api('PUT', '/api/settings', { display: { defaultSlideDurationSeconds: 9 } });
  await sleep(500);
  await s.stop();

  // Restart: the sample sync must leave everything as it is
  await s.start();
  await sleep(1000);
  await s.stop();

  const norm = normaliser();
  const data = path.join(env.APP, 'data');
  const record = {};
  for (const f of listFiles(data)) {
    if (f.endsWith('.json')) record[f] = norm(fs.readFileSync(path.join(data, f), 'utf8'));
    else record[f] = `${fs.statSync(path.join(data, f)).size > 0 ? 'non-empty' : 'empty'} file`;
  }
  const files = {};
  for (const [name, content] of Object.entries(record)) files[norm(name)] = content;

  if (!fs.existsSync(SNAPSHOT) || process.env.NB_UPDATE_SNAPSHOT === '1') {
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(files, null, 2)}\n`);
    check(`recorded ${Object.keys(files).length} data files in tests/fixtures/data-files.json`, true);
  } else {
    const want = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    for (const name of new Set([...Object.keys(want), ...Object.keys(files)])) {
      if (want[name] !== files[name]) {
        check(`data/${name} is the same as before`, false, `was ${JSON.stringify(want[name])?.slice(0, 300)}\n        now ${JSON.stringify(files[name])?.slice(0, 300)}`);
      }
    }
    check(`all ${Object.keys(want).length} data files identical to the recorded ones`, Object.keys(want).length === Object.keys(files).length && Object.keys(want).every((n) => want[n] === files[n]));
  }
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
