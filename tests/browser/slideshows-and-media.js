// QALife batch 2: hide/unhide, sample protection and updates, slideshow durations (and the
// last slide keeping its time across a switch), video thumbnails, the slide preview.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { connect } = require('../helpers/cdp.js');
const { MODULES, sleep, check, makeApp, server, page, done } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));
const { io } = require(path.join(MODULES, 'socket.io-client'));

const { ffmpegEnv, hasFfmpeg } = require('../helpers/app.js');
const FF = ffmpegEnv();
if (!hasFfmpeg()) { console.log('SKIPPED: needs ffmpeg (FFMPEG_PATH and FFPROBE_PATH, or ffmpeg on the PATH)'); process.exit(0); }
const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

async function png(w, h, colour) {
  return new Blob([await sharp({ create: { width: w, height: h, channels: 3, background: colour } }).png().toBuffer()], { type: 'image/png' });
}
function makeVideo(file, seconds = 4) {
  execFileSync(FF.FFMPEG_PATH || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=25:duration=${seconds}`, '-pix_fmt', 'yuv420p', file]);
  return new Blob([fs.readFileSync(file)], { type: 'video/mp4' });
}
async function playlistOf(env) {
  const sock = io(env.base, { transports: ['websocket'] });
  const list = await new Promise((resolve) => { sock.on('connect', () => sock.emit('display:ready')); sock.on('playlist:update', resolve); });
  sock.close();
  return list;
}
const waitFor = async (fn, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(500); } return null; };

(async () => {
  const env = makeApp({ keepSample: true });
  const s = server(env);
  await s.start(FF);
  await s.login();
  const cfg = () => JSON.parse(fs.readFileSync(path.join(env.APP, 'data/config.json'), 'utf8'));

  // ── Sample slideshow ──
  let list = (await s.api('GET', '/api/slideshows')).data;
  const sample = list.find((x) => x.sample);
  check('new install: the sample exists, unpublished, marked as the sample, 3 s per image', sample && sample.enabled === false && sample.slideDurationSeconds === 3 && sample.slideCount === 5, JSON.stringify(sample));
  let r = await s.api('DELETE', `/api/slideshows/${sample.folder}`);
  check('the sample can\'t be deleted', r.status === 403 && /can't be deleted/.test(r.data.error) && (await s.api('GET', '/api/slideshows')).data.some((x) => x.sample));
  const sampleVideo = await waitFor(async () => (await s.api('GET', `/api/slideshows/${sample.folder}/slides`)).data.find((x) => x.type === 'video' && x.thumbnail));
  check('the sample\'s video gets a thumbnail by itself', !!sampleVideo && fs.existsSync(path.join(env.APP, 'data/slideshows', sample.folder, 'slides', sampleVideo.thumbnail)));

  // ── Hide / unhide ──
  const a = (await s.api('POST', '/api/slideshows', { name: 'Alpha' })).data;
  for (const [i, c] of ['#c00', '#0c0'].entries()) { const f = new FormData(); f.append('files', await png(1600, 1200, c), `a${i}.png`); await s.api('POST', `/api/slideshows/${a.folder}/slides`, f); }
  await waitFor(async () => (await s.api('GET', `/api/slideshows/${a.folder}/slides`)).data.every((x) => x.status === 'ready'));
  await s.api('PUT', `/api/slideshows/${a.folder}`, { enabled: true });
  r = await s.api('PUT', `/api/slideshows/${a.folder}`, { hidden: true });
  check('a published slideshow can\'t be hidden', r.status === 409 && /Only unpublished/.test(r.data.error));
  await s.api('PUT', `/api/slideshows/${a.folder}`, { enabled: false, schedule: { type: 'timed', startTime: '08:00', endTime: '17:00', days: [1, 2] }, priority: 4 });
  const before = { entry: cfg().slideshows.find((x) => x.folder === a.folder), slides: fs.readFileSync(path.join(env.APP, 'data/slideshows', a.folder, 'slideshow.json'), 'utf8') };
  r = await s.api('PUT', `/api/slideshows/${a.folder}`, { hidden: true });
  const hiddenEntry = cfg().slideshows.find((x) => x.folder === a.folder);
  check('an unpublished one can be hidden', r.status === 200 && r.data.hidden === true);
  check('hiding changes nothing else (settings, schedule, slides)', JSON.stringify({ ...hiddenEntry, hidden: undefined }) === JSON.stringify(before.entry)
    && fs.readFileSync(path.join(env.APP, 'data/slideshows', a.folder, 'slideshow.json'), 'utf8') === before.slides);
  r = await s.api('PUT', `/api/slideshows/${a.folder}`, { enabled: true });
  check('a hidden slideshow must be unhidden before publishing', r.status === 409 && /Unhide/.test(r.data.error));
  r = await s.api('PUT', `/api/slideshows/${a.folder}`, { hidden: false });
  check('unhiding brings it back as it was', r.status === 200 && !r.data.hidden && JSON.stringify(cfg().slideshows.find((x) => x.folder === a.folder)) === JSON.stringify(before.entry));
  r = await s.api('PUT', `/api/slideshows/${sample.folder}`, { hidden: true });
  check('the sample can be hidden', r.status === 200 && r.data.hidden === true);
  r = await s.api('PUT', `/api/slideshows/${sample.folder}`, { hidden: false });
  check('and unhidden', r.status === 200 && !r.data.hidden);
  const junk = (await s.api('POST', '/api/slideshows', { name: 'Junk' })).data;
  r = await s.api('DELETE', `/api/slideshows/${junk.folder}`);
  check('other slideshows can still be deleted', r.status === 200 && !(await s.api('GET', '/api/slideshows')).data.some((x) => x.folder === junk.folder));

  // ── Durations ──
  r = await s.api('PUT', `/api/slideshows/${a.folder}`, { slideDurationSeconds: 0 });
  check('an invalid slideshow duration is refused', r.status === 400);
  await s.api('PUT', `/api/slideshows/${a.folder}`, { slideDurationSeconds: 6, schedule: { type: 'always' } });
  const b = (await s.api('POST', '/api/slideshows', { name: 'Bravo' })).data;
  { const f = new FormData(); f.append('files', await png(300, 200, '#00c'), 'b.png'); await s.api('POST', `/api/slideshows/${b.folder}/slides`, f); }
  await waitFor(async () => (await s.api('GET', `/api/slideshows/${b.folder}/slides`)).data.every((x) => x.status === 'ready'));
  await s.api('PUT', `/api/slideshows/${a.folder}`, { enabled: true });
  await s.api('PUT', `/api/slideshows/${b.folder}`, { enabled: true });
  let pl = await playlistOf(env);
  const durs = (folder) => pl.slides.filter((x) => x.slideshow === folder).map((x) => x.duration);
  check('each slideshow\'s own duration, or the default, rides with its slides', durs(a.folder).join() === '6,6' && durs(b.folder).join() === '10', JSON.stringify(pl.slides.map((x) => [x.slideshow, x.duration])));
  await s.api('PUT', `/api/slideshows/${a.folder}`, { slideDurationSeconds: null });
  pl = await playlistOf(env);
  check('back to the default: 10 s', durs(a.folder).join() === '10,10');
  await s.api('PUT', `/api/slideshows/${b.folder}`, { enabled: false });

  // ── The slide on screen keeps its whole time when the playlist changes ──
  await s.api('PUT', `/api/slideshows/${a.folder}`, { slideDurationSeconds: 8 });
  const v = await page(connect);
  await v.go(env.base + '/');
  const topSrc = `[...document.querySelectorAll('.slide-img, .slide-video')].pop()?.getAttribute('src') ?? ''`;
  await v.until(`${topSrc}.includes('${a.folder}')`, 15000);
  // Wait for a fresh slide (the clock's own counter), then switch slideshows 2 s into it
  const gen = () => v.evaluate('window.noticeboard.slideshow().generation');
  const g0 = await gen();
  await v.until(`window.noticeboard.slideshow().generation > ${g0} && window.noticeboard.slideshow().phase === 'showing'`, 15000);
  const shownAt = Date.now();
  const g1 = await gen();
  await sleep(2000);
  await s.api('PUT', `/api/slideshows/${b.folder}`, { enabled: true });
  await s.api('PUT', `/api/slideshows/${a.folder}`, { enabled: false });
  await v.until(`window.noticeboard.slideshow().generation > ${g1}`, 20000);
  const held = Date.now() - shownAt;
  await sleep(300);
  const nowShowing = await v.evaluate(topSrc);
  check('a slideshow switch doesn\'t cut the slide on screen short (8 s slide)', held >= 7500 && held <= 10500 && nowShowing.includes(b.folder), `held ${(held / 1000).toFixed(1)} s, then ${nowShowing.split('/').slice(-3).join('/')}`);
  v.close();

  // ── Video thumbnails ──
  const vid = makeVideo(path.join(env.T, 'clip.mp4'));
  { const f = new FormData(); f.append('files', vid, 'clip.mp4'); await s.api('POST', `/api/slideshows/${b.folder}/slides`, f); }
  const video = await waitFor(async () => (await s.api('GET', `/api/slideshows/${b.folder}/slides`)).data.find((x) => x.type === 'video' && x.status === 'ready'), 120000);
  const slidesDir = path.join(env.APP, 'data/slideshows', b.folder, 'slides');
  const thumbMeta = video?.thumbnail && await sharp(path.join(slidesDir, video.thumbnail)).metadata();
  check('an uploaded video gets a thumbnail while it\'s processed', !!thumbMeta && thumbMeta.format === 'jpeg' && thumbMeta.width === 640 && thumbMeta.height === 360, video && `${video.thumbnail} ${thumbMeta?.width}×${thumbMeta?.height}`);
  // Pretend it was uploaded before thumbnails existed
  const videoHash = hash(path.join(slidesDir, video.filename));
  fs.rmSync(path.join(slidesDir, video.thumbnail));
  const json = JSON.parse(fs.readFileSync(path.join(env.APP, 'data/slideshows', b.folder, 'slideshow.json'), 'utf8'));
  delete json.slides.find((x) => x.id === video.id).thumbnail;
  fs.writeFileSync(path.join(env.APP, 'data/slideshows', b.folder, 'slideshow.json'), JSON.stringify(json));

  // ── Admin: preview, missing thumbnails, sample and hidden in the list ──
  const ad = await page(connect, { width: 1280, height: 900 });
  await ad.login(env.base);
  await ad.go(`${env.base}/admin/slideshows/${b.folder}`);
  await ad.until(`!!document.querySelector('.thumb-note')`);
  check('an old video without a thumbnail: offered "Create thumbnails"', /1 video has no thumbnail/.test(await ad.evaluate(`document.querySelector('.thumb-note').innerText`)));
  await ad.click('Create thumbnails');
  check('created from a frame of the video, and the note goes away', await ad.until(`!document.querySelector('.thumb-note') && [...document.querySelectorAll('.slide-thumb img')].length === 2`, 60000));
  const redone = (await s.api('GET', `/api/slideshows/${b.folder}/slides`)).data.find((x) => x.id === video.id);
  check('the video file itself is unchanged', hash(path.join(slidesDir, video.filename)) === videoHash && fs.existsSync(path.join(slidesDir, redone.thumbnail)));

  // Hover: a preview that doesn't get in the way; small images aren't enlarged
  const thumbs = async () => ad.evaluate(`[...document.querySelectorAll('.slide-thumb')].map((t) => { const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })`);
  let t = await thumbs();
  await ad.mouse(t[0].x, t[0].y);
  check('hovering a thumbnail shows a larger preview', await ad.until(`!!document.querySelector('.overlay .media')`, 3000));
  let m = await ad.evaluate(`(() => { const i = document.querySelector('.overlay img.media'); return { w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, nat: i.naturalWidth, pe: getComputedStyle(document.querySelector('.overlay')).pointerEvents }; })()`);
  check('a 300 × 200 slide shows at its own size (not enlarged), and hover doesn\'t block clicks', Math.round(m.w) === 300 && Math.round(m.h) === 200 && m.pe === 'none', JSON.stringify(m));
  await ad.mouse(5, 5);
  check('moving away closes it', await ad.until(`!document.querySelector('.overlay')`, 2000));
  // Click on the video: pinned, playable, closable
  await ad.evaluate(`document.querySelectorAll('.slide-thumb')[1].click()`);
  await ad.until(`!!document.querySelector('.overlay--pinned video')`, 3000);
  m = await ad.evaluate(`(() => { const v = document.querySelector('.overlay video'); return { poster: v.poster, controls: v.controls }; })()`);
  check('clicking a video pins a playable preview with its thumbnail as the poster', m.controls && m.poster.includes('-thumb.jpg'), JSON.stringify(m));
  await ad.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-qa-preview-video.png'));
  await ad.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  check('Esc closes it', await ad.until(`!document.querySelector('.overlay')`, 2000));

  // A big image in Alpha fits 500 × 500 keeping its shape; reordering still works
  await ad.go(`${env.base}/admin/slideshows/${a.folder}`);
  await ad.until(`document.querySelectorAll('.slide-thumb img').length === 2`);
  await ad.evaluate(`document.querySelectorAll('.slide-thumb')[0].click()`);
  await ad.until(`!!document.querySelector('.overlay--pinned img.media')`, 3000);
  await sleep(300);
  m = await ad.evaluate(`(() => { const r = document.querySelector('.overlay img.media').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  check('a 1600 × 1200 slide is scaled down to 500 × 375 (shape kept)', m.w === 500 && m.h === 375, JSON.stringify(m));
  await ad.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-qa-preview-image.png'));
  await ad.evaluate(`document.querySelector('.overlay').click()`);
  check('a click outside closes it', await ad.until(`!document.querySelector('.overlay')`, 2000));
  const order0 = (await s.api('GET', `/api/slideshows/${a.folder}/slides`)).data.map((x) => x.id);
  await ad.evaluate(`[...document.querySelectorAll('.slide-row button')].find((b) => b.textContent.trim() === '↓').click()`);
  await sleep(800);
  const order1 = (await s.api('GET', `/api/slideshows/${a.folder}/slides`)).data.map((x) => x.id);
  check('reordering still works', order1[0] === order0[1] && order1[1] === order0[0]);

  // Duration setting in the page
  await ad.click('Edit');
  await ad.until(`!!document.querySelector('input[type=radio]')`);
  await ad.evaluate(`(() => { const r = document.querySelectorAll('input[type=radio]'); r[1].click(); const n = [...document.querySelectorAll('input[type=number]')].find((i) => !i.disabled && i.max === '3600'); n.value = 12; n.dispatchEvent(new Event('input')); document.querySelector('form').requestSubmit(); })()`);
  await ad.until(`document.body.innerText.includes('12 s (this slideshow)')`, 5000);
  check('the page sets a slideshow\'s own duration', cfg().slideshows.find((x) => x.folder === a.folder).slideDurationSeconds === 12);
  await ad.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-qa-detail.png'));

  // List: sample can't be deleted; hide/unhide; hidden shown on request
  await s.api('PUT', `/api/slideshows/${a.folder}`, { enabled: false });
  await ad.go(`${env.base}/admin/slideshows`);
  await ad.until(`document.querySelectorAll('.card').length >= 3`);
  const rowOf = (name) => `[...document.querySelectorAll('.card')].find((c) => c.innerText.includes(${JSON.stringify(name)}))`;
  check('the sample is marked, and its Delete button is off', await ad.evaluate(`(() => { const c = ${rowOf('Sample slideshow')}; const del = [...c.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete'); return /SAMPLE/i.test(c.innerText) && del.disabled; })()`));
  check('a published slideshow\'s Hide button is off', await ad.evaluate(`[...${rowOf('Bravo')}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Hide').disabled`));
  await ad.evaluate(`[...${rowOf('Alpha')}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Hide').click()`);
  check('hidden: gone from the list, "Show hidden slideshows (1)" offered', await ad.until(`!${rowOf('Alpha')} && document.body.innerText.includes('Show hidden slideshows (1)')`, 3000));
  await ad.click('Show hidden slideshows');
  await ad.until(`!!${rowOf('Alpha')}`, 2000);
  await ad.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-qa-list-hidden.png'));
  await ad.evaluate(`[...${rowOf('Alpha')}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Unhide').click()`);
  await sleep(800);
  check('unhide from the list', !cfg().slideshows.find((x) => x.folder === a.folder).hidden);
  ad.close();

  // ── Sample updates carried forward by a software update ──
  await s.api('PUT', `/api/slideshows/${sample.folder}`, { enabled: true });
  await s.stop();
  const sd = path.join(env.APP, 'sample-data/sample-slideshow');
  fs.writeFileSync(path.join(sd, '06-new.png'), await sharp({ create: { width: 800, height: 450, channels: 3, background: '#fa0' } }).png().toBuffer());
  fs.copyFileSync(path.join(env.T, 'clip.mp4'), path.join(sd, '07-new-video.mp4'));
  fs.writeFileSync(path.join(sd, 'sample.json'), JSON.stringify({ slideDurationSeconds: 4 }));
  await s.start(FF);
  await s.login();
  let sm = (await s.api('GET', '/api/slideshows')).data.find((x) => x.sample);
  const smSlides = (await s.api('GET', `/api/slideshows/${sm.folder}/slides`)).data;
  check('an update with a new image and video: both added to the sample', sm.slideCount === 7 && smSlides.filter((x) => x.type === 'video').length === 2, `${sm.slideCount} slides`);
  check('an update with new sample settings: applied (4 s); still published as the admin left it', sm.slideDurationSeconds === 4 && sm.enabled === true);
  await s.api('PUT', `/api/slideshows/${sm.folder}`, { enabled: false });
  await s.stop();
  // An older version let the sample be deleted: it comes back, hidden
  const c = cfg();
  c.slideshows = c.slideshows.filter((x) => x.folder !== sm.folder);
  c.sampleSlideshow = { folder: null, signature: 'old' };
  fs.rmSync(path.join(env.APP, 'data/slideshows', sm.folder), { recursive: true, force: true });
  fs.writeFileSync(path.join(env.APP, 'data/config.json'), JSON.stringify(c));
  await s.start(FF);
  await s.login();
  sm = (await s.api('GET', '/api/slideshows')).data.find((x) => x.sample);
  check('a sample deleted by an older version comes back, hidden and unpublished', !!sm && sm.hidden === true && sm.enabled === false && sm.slideCount === 7);

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
