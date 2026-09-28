// Audio shows (SYSTEM_DESIGN §18.3, phase 2): creating one (unpublished, the default settings), its
// settings checked against the contract's limits, uploading tracks (converted to AAC in .m4a with
// their length and name recorded, other file types refused), renaming, reordering and deleting
// them, /audio serving only the processed tracks (with byte ranges), and deleting a show with its
// folder. The API needs the admin login.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { MODULES, makeApp, server, check, done, sleep, ffmpegEnv, hasFfmpeg } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));

if (!hasFfmpeg()) {
  console.log('SKIPPED: needs ffmpeg (FFMPEG_PATH and FFPROBE_PATH, or ffmpeg on the PATH)');
  process.exit(0);
}
const FFMPEG = ffmpegEnv().FFMPEG_PATH || 'ffmpeg';
const FFPROBE = ffmpegEnv().FFPROBE_PATH || 'ffprobe';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-audio-'));
// Two short tracks: an MP3 (as most music is) and a WAV
execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'libmp3lame', path.join(dir, 'Morning theme.mp3')]);
execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', path.join(dir, 'chime.wav')]);
const rateOf = (file) => execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();
const codecOf = (file) => execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();

(async () => {
  const env = makeApp({ port: 3953 });
  const s = server(env);
  await s.start();
  await s.login();

  const created = await s.api('POST', '/api/audioshows', { name: 'Reception music' });
  const show = created.data;
  check('an audio show is created unpublished, with the default settings', created.status === 201 && show.folder === 'reception-music'
    && show.enabled === false && show.order === 'in-order' && show.transition === 'none' && show.fadeSeconds === 3 && show.volume === 100 && show.trackCount === 0, JSON.stringify(show));
  check('  … its folder, tracks/ and an empty audioshow.json', JSON.parse(fs.readFileSync(path.join(env.APP, 'data', 'audioshows', show.folder, 'audioshow.json'), 'utf8')).tracks.length === 0
    && fs.existsSync(path.join(env.APP, 'data', 'audioshows', show.folder, 'tracks')));
  check('no name: 400', (await s.api('POST', '/api/audioshows', {})).status === 400);

  for (const [body, what] of [[{ order: 'random' }, 'an unknown order'], [{ transition: 'swirl' }, 'an unknown transition'], [{ fadeSeconds: 11 }, 'a fade over 10 s'], [{ volume: 101 }, 'a volume over 100'], [{ volume: 50.5 }, 'a volume that isn\'t whole']]) {
    const r = await s.api('PUT', `/api/audioshows/${show.folder}`, body);
    check(`${what} is refused (400)`, r.status === 400, JSON.stringify(r.data));
  }
  const saved = await s.api('PUT', `/api/audioshows/${show.folder}`, { order: 'shuffle', transition: 'crossfade', fadeSeconds: 5, volume: 80, enabled: true });
  check('valid settings are saved', saved.status === 200 && saved.data.order === 'shuffle' && saved.data.transition === 'crossfade' && saved.data.fadeSeconds === 5 && saved.data.volume === 80 && saved.data.enabled === true, JSON.stringify(saved.data));

  // Tracks
  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(path.join(dir, 'Morning theme.mp3'))], { type: 'audio/mpeg' }), 'Morning theme.mp3');
  form.append('files', new Blob([fs.readFileSync(path.join(dir, 'chime.wav'))], { type: 'audio/wav' }), 'chime.wav');
  const up = await s.api('POST', `/api/audioshows/${show.folder}/tracks`, form);
  check('two tracks accepted', up.status === 202 && up.data.length === 2 && up.data.every((t) => t.type === 'audio' && t.status === 'processing'), JSON.stringify(up.data));
  let tracks = [];
  for (let i = 0; i < 120; i++) {
    tracks = (await s.api('GET', `/api/audioshows/${show.folder}/tracks`)).data;
    if (tracks.every((t) => t.status !== 'processing')) break;
    await sleep(250);
  }
  const tracksDir = path.join(env.APP, 'data', 'audioshows', show.folder, 'tracks');
  check('both are ready: AAC in .m4a, with their length and name', tracks.length === 2 && tracks.every((t) => t.status === 'ready' && /\.m4a$/.test(t.filename) && codecOf(path.join(tracksDir, t.filename)) === 'aac')
    && tracks[0].originalName === 'Morning theme.mp3' && tracks[0].duration === 3 && tracks[1].duration === 2, JSON.stringify(tracks.map((t) => [t.status, t.filename, t.duration, t.originalName])));
  check('  … at 48 kHz, whatever they came in at (one rate for every sound: SYSTEM_DESIGN §18.3 phase 8)', tracks.every((t) => rateOf(path.join(tracksDir, t.filename)) === '48000'), tracks.map((t) => rateOf(path.join(tracksDir, t.filename))).join(','));
  check('the list shows the track count', (await s.api('GET', '/api/audioshows')).data[0].trackCount === 2);
  const bad = new FormData();
  bad.append('files', new Blob([await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer()], { type: 'image/png' }), 'picture.png');
  const refused = await s.api('POST', `/api/audioshows/${show.folder}/tracks`, bad);
  check('an image is refused as a track (400)', refused.status === 400 && refused.data?.error === 'Unsupported file type');

  const renamed = await s.api('PATCH', `/api/audioshows/${show.folder}/tracks/${tracks[1].id}`, { name: 'Door chime' });
  check('a track is renamed; its file isn\'t', renamed.status === 200 && renamed.data.name === 'Door chime' && renamed.data.filename === tracks[1].filename);
  const reordered = await s.api('PUT', `/api/audioshows/${show.folder}/tracks/reorder`, { order: [tracks[1].id, tracks[0].id] });
  check('tracks are reordered', reordered.status === 200 && reordered.data.map((t) => t.id).join() === [tracks[1].id, tracks[0].id].join());
  check('a missing track: 404 "Track not found"', (await s.api('PATCH', `/api/audioshows/${show.folder}/tracks/nope`, { name: 'x' })).data?.error === 'Track not found');
  check('a missing show: 404 "Audio show not found"', (await s.api('GET', '/api/audioshows/nope/tracks')).data?.error === 'Audio show not found');

  // Serving
  const served = await fetch(`${env.base}/audio/${show.folder}/tracks/${tracks[0].filename}`, { headers: { Range: 'bytes=0-99' } });
  check('/audio serves a track, in byte ranges', served.status === 206 && served.headers.get('accept-ranges') === 'bytes', `HTTP ${served.status}`);
  check('/audio doesn\'t serve the show\'s JSON file', (await fetch(`${env.base}/audio/${show.folder}/audioshow.json`)).status === 404);

  const del = await s.api('DELETE', `/api/audioshows/${show.folder}/tracks/${tracks[0].id}`);
  check('a track is deleted with its file', del.status === 200 && !fs.existsSync(path.join(tracksDir, tracks[0].filename)));
  check('the API needs a login (401)', (await s.api('GET', '/api/audioshows', undefined, { auth: false })).status === 401);
  const gone = await s.api('DELETE', `/api/audioshows/${show.folder}`);
  check('the show is deleted with its folder', gone.status === 200 && !fs.existsSync(path.join(env.APP, 'data', 'audioshows', show.folder)) && (await s.api('GET', '/api/audioshows')).data.length === 0);

  await s.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
