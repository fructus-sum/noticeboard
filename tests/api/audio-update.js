// Background audio for the screens (SYSTEM_DESIGN §18.3, phase 4): a slideshow's audio show
// (checked, stored only when chosen, cleared with null), and what a display is told in audio:update:
// with its playlist on display:ready, then again only when it changes. Only published audio shows
// with a ready track are sent, each in the shape the audio engine takes; deleting an audio show
// clears it from the slideshows that chose it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { MODULES, makeApp, server, check, done, sleep, ffmpegEnv, hasFfmpeg } = require('../helpers/app.js');
const { io } = require(path.join(MODULES, 'socket.io-client'));

if (!hasFfmpeg()) {
  console.log('SKIPPED: needs ffmpeg (FFMPEG_PATH and FFPROBE_PATH, or ffmpeg on the PATH)');
  process.exit(0);
}
const FFMPEG = ffmpegEnv().FFMPEG_PATH || 'ffmpeg';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-audio-update-'));
execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'libmp3lame', path.join(dir, 'tune.mp3')]);

(async () => {
  const env = makeApp({ port: 3955 });
  const s = server(env);
  await s.start();
  await s.login();

  // A display
  const got = [];
  const sock = io(env.base, { transports: ['websocket'] });
  sock.on('audio:update', (a) => got.push(a));
  sock.on('connect', () => sock.emit('display:ready'));
  const wait = async (n, ms = 3000) => { const end = Date.now() + ms; while (got.length < n && Date.now() < end) await sleep(50); return got.length >= n; };
  const quiet = async (ms = 800) => { const n = got.length; await sleep(ms); return got.length === n; };
  const last = () => got[got.length - 1];

  check('display:ready: the audio comes with the playlist (none yet)', await wait(1) && JSON.stringify(got[0]) === JSON.stringify({ shows: {}, slideshows: {}, event: null }), JSON.stringify(got[0]));

  const ss = (await s.api('POST', '/api/slideshows', { name: 'Lobby' })).data.folder;
  await s.api('PUT', `/api/slideshows/${ss}`, { enabled: true });
  const show = (await s.api('POST', '/api/audioshows', { name: 'Lobby music' })).data.folder;
  check('changes that don\'t touch the audio send nothing', await quiet());

  const bad = await s.api('PUT', `/api/slideshows/${ss}`, { audioShow: 'no-such-show' });
  check('a slideshow\'s audio show must exist (400)', bad.status === 400 && bad.data.error === 'Choose an audio show that exists', JSON.stringify(bad.data));
  const chose = await s.api('PUT', `/api/slideshows/${ss}`, { audioShow: show });
  check('choosing an audio show is saved', chose.status === 200 && (await s.api('GET', `/api/slideshows/${ss}`)).data.audioShow === show);
  check('  … an unpublished show isn\'t sent', await quiet());
  await s.api('PUT', `/api/audioshows/${show}`, { enabled: true });
  check('  … nor a published one without a ready track', await quiet());

  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(path.join(dir, 'tune.mp3'))], { type: 'audio/mpeg' }), 'tune.mp3');
  const n = got.length;
  await s.api('POST', `/api/audioshows/${show}/tracks`, form);
  check('a track becoming ready sends the audio', await wait(n + 1, 30000), `${got.length} updates`);
  const a = last();
  const track = (await s.api('GET', `/api/audioshows/${show}/tracks`)).data[0];
  check('  … the show as the engine takes it, and the slideshow that plays it',
    JSON.stringify(a) === JSON.stringify({
      shows: { [show]: { id: show, order: 'in-order', transition: 'none', fadeSeconds: 3, volume: 100, tracks: [{ url: `/audio/${show}/tracks/${track.filename}`, length: track.duration }] } },
      slideshows: { [ss]: show },
      event: null,
    }), JSON.stringify(a));
  check('  … its track is served there', (await s.api('GET', a.shows[show].tracks[0].url, undefined, { raw: true })).status === 200);

  await s.api('PUT', `/api/audioshows/${show}`, { volume: 60 });
  check('a change to the show sends it again', await wait(n + 2) && last().shows[show].volume === 60);
  await s.api('PUT', `/api/slideshows/${ss}`, { priority: 2 });
  check('  … a slideshow change that doesn\'t touch the audio sends nothing', await quiet());

  await s.api('PUT', `/api/slideshows/${ss}`, { audioShow: null });
  const cleared = (await s.api('GET', `/api/slideshows/${ss}`)).data;
  check('none: the slideshow has no audioShow at all', !('audioShow' in cleared), JSON.stringify(cleared));
  check('  … and the screens are told', await wait(n + 3) && JSON.stringify(last().slideshows) === '{}' && !!last().shows[show]);
  const entry = JSON.parse(fs.readFileSync(path.join(env.APP, 'data', 'config.json'), 'utf8')).slideshows.find((x) => x.folder === ss);
  check('  … nor in config.json', !('audioShow' in entry), JSON.stringify(entry));

  await s.api('PUT', `/api/slideshows/${ss}`, { audioShow: show });
  await wait(n + 4);
  await s.api('PUT', `/api/audioshows/${show}`, { enabled: false });
  check('unpublishing a show takes it off the screens', await wait(n + 5) && JSON.stringify(last()) === JSON.stringify({ shows: {}, slideshows: {}, event: null }), JSON.stringify(last()));
  check('  … the slideshow keeps its choice', (await s.api('GET', `/api/slideshows/${ss}`)).data.audioShow === show);

  await s.api('DELETE', `/api/audioshows/${show}`);
  const after = (await s.api('GET', `/api/slideshows/${ss}`)).data;
  check('deleting a show clears it from the slideshows that chose it', !('audioShow' in after), JSON.stringify(after));

  // A display that connects later gets the audio as it is now
  const late = [];
  const sock2 = io(env.base, { transports: ['websocket'] });
  sock2.on('audio:update', (x) => late.push(x));
  sock2.on('connect', () => sock2.emit('display:ready'));
  for (let i = 0; i < 60 && !late.length; i++) await sleep(50);
  check('a display connecting later gets the current audio', late.length === 1 && JSON.stringify(late[0].slideshows) === '{}');

  sock.close();
  sock2.close();
  await s.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
