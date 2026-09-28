// A video's own sound (SYSTEM_DESIGN §18.3, phase 5): PUT …/slides/:id/sound for videos only, its
// choices and limits (from the contract), the defaults, off removing the keys; the playlist gives a
// video with sound its keys and no other slide any.
const path = require('path');
const fs = require('fs');
const { MODULES, makeApp, server, check, done, sleep } = require('../helpers/app.js');
const { io } = require(path.join(MODULES, 'socket.io-client'));

(async () => {
  const env = makeApp({ port: 3957, keepSample: true });
  const s = server(env);
  await s.start();
  await s.login();

  const sample = (await s.api('GET', '/api/slideshows')).data.find((x) => x.sample);
  const url = `/api/slideshows/${sample.folder}/slides`;
  const slides = (await s.api('GET', url)).data;
  const video = slides.find((x) => x.type === 'video');
  const image = slides.find((x) => x.type === 'image');
  const put = (id, body) => s.api('PUT', `${url}/${id}/sound`, body);

  const onImage = await put(image.id, { sound: true });
  check('an image has no sound of its own (400)', onImage.status === 400 && onImage.data.error === 'Only a video has its own sound', JSON.stringify(onImage.data));
  check('an unknown slide: 404', (await put('nope', { sound: true })).status === 404);
  for (const [body, what] of [[{ sound: 'yes' }, 'sound that isn\'t true or false'], [{ sound: true, withSound: 'mute' }, 'an unknown choice'], [{ sound: true, lowerTo: 101 }, 'a volume over 100'], [{ sound: true, lowerTo: 20.5 }, 'a volume that isn\'t whole']]) {
    const r = await put(video.id, body);
    check(`${what} is refused (400)`, r.status === 400, JSON.stringify(r.data));
  }

  const on = await put(video.id, { sound: true });
  check('sound on: lowered to 20 % by default', on.status === 200 && on.data.sound === true && on.data.withSound === 'lower' && on.data.lowerTo === 20, JSON.stringify(on.data));
  const paused = await put(video.id, { sound: true, withSound: 'pause' });
  check('  … or paused, keeping the volume chosen before', paused.data.withSound === 'pause' && paused.data.lowerTo === 20, JSON.stringify(paused.data));
  const lowered = await put(video.id, { sound: true, withSound: 'lower', lowerTo: 35 });
  check('  … or lowered to another volume', lowered.data.withSound === 'lower' && lowered.data.lowerTo === 35);
  const stored = JSON.parse(fs.readFileSync(path.join(env.APP, 'data', 'slideshows', sample.folder, 'slideshow.json'), 'utf8')).slides.find((x) => x.id === video.id);
  check('  … stored with the slide', stored.sound === true && stored.withSound === 'lower' && stored.lowerTo === 35, JSON.stringify(stored));

  // What the screens get
  await s.api('PUT', `/api/slideshows/${sample.folder}`, { enabled: true });
  const playlist = await new Promise((resolve) => {
    const sock = io(env.base, { transports: ['websocket'] });
    sock.on('playlist:update', (p) => { if (p.slides.length) { sock.close(); resolve(p); } });
    sock.on('connect', () => sock.emit('display:ready'));
  });
  const withSound = playlist.slides.filter((x) => 'sound' in x || 'withSound' in x || 'lowerTo' in x);
  check('the playlist: only the video with sound carries the keys', withSound.length === 1 && withSound[0].type === 'video'
    && withSound[0].sound === true && withSound[0].withSound === 'lower' && withSound[0].lowerTo === 35, JSON.stringify(withSound));

  const off = await put(video.id, { sound: false });
  check('sound off removes the keys', off.status === 200 && !('sound' in off.data) && !('withSound' in off.data) && !('lowerTo' in off.data), JSON.stringify(off.data));
  await sleep(200);
  const after = JSON.parse(fs.readFileSync(path.join(env.APP, 'data', 'slideshows', sample.folder, 'slideshow.json'), 'utf8')).slides.find((x) => x.id === video.id);
  check('  … from the stored slide too, as it was before', JSON.stringify(Object.keys(after)) === JSON.stringify(Object.keys(video).filter((k) => k in after)) && !('sound' in after), JSON.stringify(after));

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
