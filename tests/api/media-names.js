// Friendly names for slides (SYSTEM_DESIGN §14 D38): an upload records the file's own name, even
// with accents or other scripts; renaming sets a name without touching the stored file; an empty
// name goes back to the uploaded one; the rule's limits are enforced; and names never reach the
// screens (no playlist is sent for a rename, and the playlist has no names).
const path = require('path');
const { MODULES, makeApp, server, check, done, sleep } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));
const { io } = require(path.join(MODULES, 'socket.io-client'));

const png = (colour) => sharp({ create: { width: 64, height: 36, channels: 3, background: colour } }).png().toBuffer();

(async () => {
  const env = makeApp({ port: 3941 });
  const s = server(env);
  await s.start();
  await s.login();

  const folder = (await s.api('POST', '/api/slideshows', { name: 'Names' })).data.folder;
  const form = new FormData();
  form.append('files', new Blob([await png('#39c')], { type: 'image/png' }), 'Café menu – 日本.png');
  form.append('files', new Blob([await png('#c93')], { type: 'image/png' }), 'plain.png');
  const up = await s.api('POST', `/api/slideshows/${folder}/slides`, form);
  check('upload accepted', up.status === 202, `HTTP ${up.status}`);
  const [cafe, plain] = up.data;
  check('the uploaded file names are recorded, accents and all', cafe.originalName === 'Café menu – 日本.png' && plain.originalName === 'plain.png', `${cafe.originalName}, ${plain.originalName}`);
  check('an upload has no name of its own', !('name' in cafe));

  let slides = [];
  for (let i = 0; i < 40; i++) {
    slides = (await s.api('GET', `/api/slideshows/${folder}/slides`)).data;
    if (slides.every((x) => x.status === 'ready')) break;
    await sleep(250);
  }
  const ready = slides.find((x) => x.id === cafe.id);
  check('processing keeps the recorded name', ready.status === 'ready' && ready.originalName === 'Café menu – 日本.png');
  await s.api('PUT', `/api/slideshows/${folder}`, { enabled: true });

  // A display, to see what the screens receive
  const received = [];
  const sock = io(env.base, { transports: ['websocket'] });
  sock.on('connect', () => sock.emit('display:ready'));
  sock.on('playlist:update', (p) => received.push(p));
  await sleep(1500);
  const before = received.length;

  const renamed = await s.api('PATCH', `/api/slideshows/${folder}/slides/${cafe.id}`, { name: '  Lunch menu\n' });
  check('rename answers with the slide, its name cleaned', renamed.status === 200 && renamed.data.name === 'Lunch menu' && renamed.data.originalName === 'Café menu – 日本.png', JSON.stringify(renamed.data?.name));
  check('the stored file keeps its name', renamed.data.filename === ready.filename);
  const listed = (await s.api('GET', `/api/slideshows/${folder}/slides`)).data.find((x) => x.id === cafe.id);
  check('the name is saved', listed.name === 'Lunch menu');
  await sleep(1500);
  check('renaming sends no playlist to the screens', received.length === before, `${received.length - before} sent`);
  const last = received[received.length - 1];
  check('the playlist carries no names', !!last && last.slides.length === 2 && last.slides.every((x) => !('name' in x) && !('originalName' in x)), JSON.stringify(last?.slides?.[0]));

  const cleared = await s.api('PATCH', `/api/slideshows/${folder}/slides/${cafe.id}`, { name: '   ' });
  check('an empty name goes back to the uploaded name', cleared.status === 200 && !('name' in cleared.data) && cleared.data.originalName === 'Café menu – 日本.png');
  const nulled = await s.api('PATCH', `/api/slideshows/${folder}/slides/${plain.id}`, { name: null });
  check('a null name is the same as an empty one', nulled.status === 200 && !('name' in nulled.data));

  const longest = await s.api('PATCH', `/api/slideshows/${folder}/slides/${plain.id}`, { name: 'é'.repeat(200) });
  check('a name of 200 characters is accepted', longest.status === 200 && [...longest.data.name].length === 200);
  const tooLong = await s.api('PATCH', `/api/slideshows/${folder}/slides/${plain.id}`, { name: 'x'.repeat(201) });
  check('a longer name is refused (400)', tooLong.status === 400 && /200/.test(tooLong.data?.error), JSON.stringify(tooLong.data));
  const notText = await s.api('PATCH', `/api/slideshows/${folder}/slides/${plain.id}`, { name: 42 });
  check('a name that isn\'t text is refused (400)', notText.status === 400);
  const kept = (await s.api('GET', `/api/slideshows/${folder}/slides`)).data.find((x) => x.id === plain.id);
  check('a refused name leaves the slide as it was', [...(kept.name ?? '')].length === 200);

  const missing = await s.api('PATCH', `/api/slideshows/${folder}/slides/00000000-0000-0000-0000-000000000000`, { name: 'x' });
  check('renaming a missing slide: 404', missing.status === 404 && missing.data?.error === 'Slide not found');
  const noShow = await s.api('PATCH', '/api/slideshows/no-such-show/slides/x', { name: 'x' });
  check('renaming in a missing slideshow: 404', noShow.status === 404 && noShow.data?.error === 'Slideshow not found');
  const loggedOut = await s.api('PATCH', `/api/slideshows/${folder}/slides/${plain.id}`, { name: 'x' }, { auth: false });
  check('renaming needs a login (401)', loggedOut.status === 401);

  sock.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
