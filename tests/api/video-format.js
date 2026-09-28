// The video format for new uploads and converting the existing videos (Settings → Display,
// SYSTEM_DESIGN §14 D43): H.265 unless H.264 is chosen; only the contract's formats are
// accepted; each upload is converted to the format chosen when it's processed (checked with
// ffprobe) and records it; the playlist gives each video its length. Converting the existing videos
// shows each as processing in its turn while the screens keep its current file, then replaces it;
// videos already in the format are left alone; a restart mid-way leaves the old files in place.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { MODULES, makeApp, server, check, done, sleep, ffmpegEnv, hasFfmpeg, untilSlideEnds } = require('../helpers/app.js');
const { io } = require(path.join(MODULES, 'socket.io-client'));

if (!hasFfmpeg()) {
  console.log('SKIPPED: needs ffmpeg (FFMPEG_PATH and FFPROBE_PATH, or ffmpeg on the PATH)');
  process.exit(0);
}
const FFMPEG = ffmpegEnv().FFMPEG_PATH || 'ffmpeg';
const FFPROBE = ffmpegEnv().FFPROBE_PATH || 'ffprobe';

// A test video, H.264 as a phone would upload it: HD with noise, so converting it takes a moment
const clip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nb-clip-')), 'clip.mp4');
execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '4', '-vf', 'noise=alls=30:allf=t', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
const codecOf = (file) => execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,codec_tag_string', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();

(async () => {
  const env = makeApp({ port: 3950 });
  const s = server(env);
  await s.start();
  await s.login();
  const folder = (await s.api('POST', '/api/slideshows', { name: 'Videos' })).data.folder;
  const slidesDir = path.join(env.APP, 'data', 'slideshows', folder, 'slides');
  const slides = async () => (await s.api('GET', `/api/slideshows/${folder}/slides`)).data;
  const file = (slide) => path.join(slidesDir, slide.filename);

  async function upload(name) {
    const form = new FormData();
    form.append('files', new Blob([fs.readFileSync(clip)], { type: 'video/mp4' }), name);
    const id = (await s.api('POST', `/api/slideshows/${folder}/slides`, form)).data[0].id;
    for (let i = 0; i < 240; i++) {
      const slide = (await slides()).find((x) => x.id === id);
      if (slide?.status !== 'processing') return slide;
      await sleep(500);
    }
    return null;
  }

  const before = (await s.api('GET', '/api/settings')).data.display;
  check('no format saved yet', before.videoFormat === undefined);
  const first = await upload('first.mp4');
  check('by default a new video is H.265 (hvc1), and says so', first?.status === 'ready' && codecOf(file(first)) === 'hevc,hvc1' && first.format === 'h265', first && `${codecOf(file(first))} ${first.format}`);

  const bad = await s.api('PUT', '/api/settings', { display: { videoFormat: 'av1' } });
  check('a format that isn\'t offered is refused (400)', bad.status === 400 && /h265, h264/.test(bad.data?.error), JSON.stringify(bad.data));
  const ok = await s.api('PUT', '/api/settings', { display: { videoFormat: 'h264' } });
  check('H.264 is saved, the other display settings kept', ok.status === 200 && ok.data.display.videoFormat === 'h264'
    && ok.data.display.defaultSlideDurationSeconds === before.defaultSlideDurationSeconds && ok.data.display.showDeviceInfo === before.showDeviceInfo);
  const second = await upload('second.mp4');
  check('then a new video is H.264', second?.status === 'ready' && codecOf(file(second)).startsWith('h264') && second.format === 'h264');
  check('the video uploaded before keeps its format', codecOf(file((await slides()).find((x) => x.id === first.id))) === 'hevc,hvc1');

  // The playlist gives each video its length
  await s.api('PUT', `/api/slideshows/${folder}`, { enabled: true });
  let playlist = null;
  const display = io(env.base, { transports: ['websocket'] });
  display.on('connect', () => display.emit('display:ready'));
  display.on('playlist:update', (p) => { playlist = p; });
  await sleep(2000);
  const videos = playlist?.slides.filter((x) => x.slideshow === folder) ?? [];
  check('the playlist gives each video its length', videos.length === 2 && videos.every((v) => v.type === 'video' && v.length === 4 && v.duration === null), JSON.stringify(videos));

  // Convert the existing videos to H.265
  await s.api('PUT', '/api/settings', { display: { videoFormat: 'h265' } });
  const mixed = (await s.api('GET', '/api/settings/videos/formats')).data;
  check('the videos not in the selected format are counted (the Display card warns)', mixed.format === 'h265' && mixed.total >= 2 && mixed.other === mixed.total - 1, JSON.stringify(mixed));
  const secondFile = second.filename;
  const started = await s.api('POST', '/api/settings/videos/convert');
  // Every video on this noticeboard: these two and the sample slideshow's
  const all = started.data.total;
  check('converting starts, with every video to go through', started.status === 200 && started.data.running && all >= 2 && started.data.format === 'h265', JSON.stringify(started.data));
  const again = await s.api('POST', '/api/settings/videos/convert');
  check('  … not twice at once (409)', again.status === 409);
  let sawProcessing = false; let keptPlaying = false;
  const json = path.join(env.APP, 'data', 'slideshows', folder, 'slideshow.json');
  const onDisk = () => { try { return JSON.parse(fs.readFileSync(json, 'utf8')).slides.find((x) => x.id === second.id); } catch { return null; } };
  for (let i = 0; i < 2400; i++) {
    const now = onDisk();
    if (now?.status === 'processing' && now.reprocessing) {
      sawProcessing = true;
      keptPlaying ||= !!playlist?.slides.some((x) => x.url.endsWith(secondFile));
    }
    if (now?.format === 'h265' && now.status === 'ready') break;
    await sleep(25);
  }
  for (let i = 0; i < 240 && (await s.api('GET', '/api/settings/videos/convert')).data.running; i++) await sleep(250);
  check('in its turn the video shows processing', sawProcessing);
  check('  … while the screens keep playing its current file', keptPlaying);
  const status = (await s.api('GET', '/api/settings/videos/convert')).data;
  check('the run finishes: the H.264 videos converted, the H.265 one left alone', !status.running && status.converted === all - 1 && status.skipped === 1 && status.failed === 0, JSON.stringify(status));
  const rerun = await s.api('POST', '/api/settings/videos/convert');
  for (let i = 0; i < 240 && (await s.api('GET', '/api/settings/videos/convert')).data.running; i++) await sleep(250);
  const second2 = (await s.api('GET', '/api/settings/videos/convert')).data;
  check('run again: every video is already H.265, nothing converted', rerun.status === 200 && second2.converted === 0 && second2.skipped === all, JSON.stringify(second2));
  const allSame = (await s.api('GET', '/api/settings/videos/formats')).data;
  check('  … and none is counted as another format any more', allSame.other === 0 && allSame.total === all, JSON.stringify(allSame));
  const converted = (await slides()).find((x) => x.id === second.id);
  check('the converted video is ready, H.265, in a new file', converted.status === 'ready' && !converted.reprocessing && converted.format === 'h265'
    && converted.filename !== secondFile && codecOf(file(converted)) === 'hevc,hvc1');
  check('  … its old file is deleted, its thumbnail kept', !fs.existsSync(path.join(slidesDir, secondFile)) && converted.thumbnail === second.thumbnail && fs.existsSync(path.join(slidesDir, converted.thumbnail)));
  await sleep(500);
  await untilSlideEnds(playlist);   // the change reaches the screens when the slide on air ends
  check('  … and the screens get the new file', playlist.slides.some((x) => x.url.endsWith(converted.filename)));
  check('nothing is left in the uploads folder', fs.readdirSync(path.join(env.APP, 'tmp', 'noticeboard-uploads')).length === 0);

  // A restart in the middle of a conversion
  const data = JSON.parse(fs.readFileSync(json, 'utf8'));
  data.slides[0].status = 'processing';
  data.slides[0].reprocessing = true;
  fs.writeFileSync(json, JSON.stringify(data, null, 2));
  fs.mkdirSync(path.join(env.APP, 'tmp', 'noticeboard-uploads', 'convert-left'), { recursive: true });
  fs.writeFileSync(path.join(env.APP, 'tmp', 'noticeboard-uploads', 'convert-left', 'half.mp4'), 'x');
  display.close();
  await s.stop();
  await s.start();
  await s.login();
  const after = (await slides())[0];
  check('after a restart mid-way the video is ready again, with its file', after.status === 'ready' && !after.reprocessing && fs.existsSync(file(after)));
  check('  … and the unfinished output is deleted', !fs.existsSync(path.join(env.APP, 'tmp', 'noticeboard-uploads', 'convert-left')));

  await s.stop();
  fs.rmSync(path.dirname(clip), { recursive: true, force: true });
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
