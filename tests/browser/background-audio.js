// Background audio (SYSTEM_DESIGN §18.3, phase 4): choosing a slideshow's audio show in its
// settings (only published shows offered; the fact shows its name), and the viewer following it:
// the slideshow on screen gives the engine its audio show, a change reaches an open screen, and
// "None" takes it away. A headless browser may refuse sound, so the engine's state is checked
// (window.noticeboardAudio), not what is heard; a click on the screen starts refused sound at once.
// Phase 5: a video's Sound switch in the slide list; on screen the video plays (aloud, or muted if
// the browser refuses), the background audio is lowered to the chosen volume meanwhile and brought
// back after, or paused and resumed. Phase 6: the Event audio card: Start now takes over every screen,
// Stop gives the slideshow's show back; saving an event that overlaps another is refused, naming it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { MODULES, makeApp, server, page, check, done, sleep, ffmpegEnv, hasFfmpeg } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');
const sharp = require(path.join(MODULES, 'sharp'));

if (!hasFfmpeg()) {
  console.log('SKIPPED: needs ffmpeg (FFMPEG_PATH and FFPROBE_PATH, or ffmpeg on the PATH)');
  process.exit(0);
}
const FFMPEG = ffmpegEnv().FFMPEG_PATH || 'ffmpeg';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-bg-audio-'));
execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:a', 'libmp3lame', path.join(dir, 'tune.mp3')]);
// A 4-second video with its own sound
execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'clip.mp4')]);

(async () => {
  // H.264, which a PC's headless Chrome can play
  const env = makeApp({ port: 3956, config: { display: { defaultSlideDurationSeconds: 3, videoFormat: 'h264' } } });
  const s = server(env);
  // It clicks through the admin panel much faster than a person: past the 120 API requests a
  // minute on a fast machine (a CI runner)
  await s.start({ NOTICEBOARD_API_RATE_LIMIT: '1000' });
  await s.login();

  // A published slideshow with an image, a published audio show with a track, and an unpublished one
  const ss = (await s.api('POST', '/api/slideshows', { name: 'Lobby' })).data.folder;
  const img = new FormData();
  img.append('files', new Blob([await sharp({ create: { width: 800, height: 450, channels: 3, background: '#39c' } }).png().toBuffer()], { type: 'image/png' }), 'x.png');
  await s.api('POST', `/api/slideshows/${ss}/slides`, img);
  const clip = new FormData();
  clip.append('files', new Blob([fs.readFileSync(path.join(dir, 'clip.mp4'))], { type: 'video/mp4' }), 'clip.mp4');
  await s.api('POST', `/api/slideshows/${ss}/slides`, clip);
  for (let i = 0; i < 600; i++) {
    const all = (await s.api('GET', `/api/slideshows/${ss}/slides`)).data;
    if (all.length === 2 && all.every((x) => x.status === 'ready')) break;
    await sleep(100);
  }
  await s.api('PUT', `/api/slideshows/${ss}`, { enabled: true });
  // The clip's sound came in at 44.1 kHz: processed, it's 48 kHz like the tracks (§18.3 phase 8)
  const FFPROBE = ffmpegEnv().FFPROBE_PATH || 'ffprobe';
  const clipFile = (await s.api('GET', `/api/slideshows/${ss}/slides`)).data.find((x) => x.type === 'video').filename;
  const clipRate = execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', path.join(env.APP, 'data', 'slideshows', ss, 'slides', clipFile)], { encoding: 'utf8' }).trim();
  check('a video\'s sound is processed to 48 kHz', clipRate === '48000', clipRate);
  const music = (await s.api('POST', '/api/audioshows', { name: 'Lobby music' })).data.folder;
  const tune = new FormData();
  tune.append('files', new Blob([fs.readFileSync(path.join(dir, 'tune.mp3'))], { type: 'audio/mpeg' }), 'tune.mp3');
  await s.api('POST', `/api/audioshows/${music}/tracks`, tune);
  for (let i = 0; i < 300; i++) {
    if ((await s.api('GET', `/api/audioshows/${music}/tracks`)).data.every((t) => t.status === 'ready')) break;
    await sleep(100);
  }
  await s.api('PUT', `/api/audioshows/${music}`, { enabled: true });
  await s.api('POST', '/api/audioshows', { name: 'Not ready yet' });

  // The viewer, open before anything is chosen
  const v = await page(connect, { width: 800, height: 450 });
  await v.go(env.base + '/?kiosk=off');
  const audioState = `(window.noticeboardAudio ? window.noticeboardAudio() : null)`;
  check('the viewer runs the audio engine (nothing to play yet)', await v.until(`${audioState}?.show === null`, 15000), JSON.stringify(await v.evaluate(audioState)));

  // The slideshow's settings
  const c = await page(connect, { width: 1100, height: 900 });
  await c.login(env.base);
  await c.go(`${env.base}/admin/slideshows/${ss}`);
  const fact = `([...document.querySelectorAll('div')].find((d) => d.firstElementChild?.textContent === 'Background audio')?.innerText ?? '').replace(/\\s+/g, ' ').trim()`;
  check('Settings shows "Background audio: None"', await c.until(`${fact} === 'Background audio None'`), await c.evaluate(fact));
  await c.evaluate(`[...document.querySelectorAll('.card-actions button')].find((b) => b.textContent.trim() === 'Edit').click()`);
  await c.until(`!!document.querySelector('#slideshow-audio')`);
  const options = await c.evaluate(`[...document.querySelectorAll('#slideshow-audio option')].map((o) => o.textContent.trim())`);
  check('the choices: None and the published audio shows', options.join('|') === 'None|Lobby music', options.join('|'));
  await c.evaluate(`(() => { const sel = document.querySelector('#slideshow-audio'); sel.value = ${JSON.stringify(music)}; sel.dispatchEvent(new Event('change')); [...document.querySelectorAll('button[type=submit]')].find((b) => b.textContent.trim() === 'Save').click(); })()`);
  check('saved: the fact names the audio show', await c.until(`${fact} === 'Background audio Lobby music'`), await c.evaluate(fact));
  check('  … and the server has it', (await s.api('GET', `/api/slideshows/${ss}`)).data.audioShow === music);

  check('the open screen starts the slideshow\'s audio show', await v.until(`${audioState}?.show === ${JSON.stringify(music)}`, 10000), JSON.stringify(await v.evaluate(audioState)));
  const st = await v.evaluate(audioState);
  check('  … playing, or waiting for the browser to allow sound', st.playing === true || st.blocked === true, JSON.stringify(st));
  if (st.blocked) {
    // A click lets the browser play sound: it starts at once, not after the minute's wait
    for (const type of ['mousePressed', 'mouseReleased']) await v.send('Input.dispatchMouseEvent', { type, x: 400, y: 225, button: 'left', clickCount: 1 });
    check('  … refused at first: a click on the screen starts it straight away', await v.until(`${audioState}?.playing === true`, 5000), JSON.stringify(await v.evaluate(audioState)));
  }

  // Unpublished: marked in the settings, silent on the screen
  await s.api('PUT', `/api/audioshows/${music}`, { enabled: false });
  check('an unpublished audio show stops on the screen', await v.until(`${audioState}?.show === null`, 10000));
  await c.go(`${env.base}/admin/slideshows/${ss}`);
  check('  … and the settings say so', await c.until(`${fact}.includes('Lobby music (not published: silent until it is)')`), await c.evaluate(fact));
  await s.api('PUT', `/api/audioshows/${music}`, { enabled: true });
  check('published again: it plays again', await v.until(`${audioState}?.show === ${JSON.stringify(music)}`, 10000));

  // A video with its own sound: the switch in the slide list, lowered to 30 %
  await c.go(`${env.base}/admin/slideshows/${ss}`);
  await c.until(`!!document.querySelector('.video-sound input[type=checkbox]')`);
  await c.evaluate(`document.querySelector('.video-sound input[type=checkbox]').click()`);
  check('the Sound switch turns a video\'s sound on (lowered by default)', await c.until(`!!document.querySelector('.video-sound select') && document.querySelector('.video-sound select').value === 'lower'`));
  await c.evaluate(`(() => { const i = document.querySelector('.video-sound__volume'); i.value = '30'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); })()`);
  let saved = null;
  for (let i = 0; i < 30 && saved?.lowerTo !== 30; i++) { await sleep(100); saved = (await s.api('GET', `/api/slideshows/${ss}/slides`)).data.find((x) => x.type === 'video'); }
  check('  … and the volume while it plays is saved', saved?.sound === true && saved.withSound === 'lower' && saved.lowerTo === 30, JSON.stringify(saved));
  // The viewer's tab to the front, as on a real screen: Chrome holds back media in a tab behind another
  await v.send('Page.bringToFront');
  // From the start of its slot: a video that starts late joins its slot part-way (every screen in
  // step, SYSTEM_DESIGN §18.8), which could leave too little of it to see the volume settle
  const videoPlaying = `(() => { const v = document.querySelector('video'); return !!v && v.currentTime > 0.3 && v.currentTime < 1.5 && !v.paused; })()`;
  check('on screen the video plays (aloud, or muted if the browser won\'t)', await v.until(videoPlaying, 20000), JSON.stringify(await v.evaluate(`(() => { const x = document.querySelector('video'); return x && { t: x.currentTime, paused: x.paused, muted: x.muted }; })()`)));
  // The saved volume reaches the screen when the slide on air ends (the switch saved 20 % first): it
  // may take a round of the slideshow
  check('  … with the background audio lowered to 30 %', await v.until(`!!document.querySelector('video') && Math.abs((${audioState}?.duck ?? 1) - 0.3) < 0.01`, 15000), JSON.stringify(await v.evaluate(audioState)));
  check('  … and back to full once it has gone', await v.until(`!document.querySelector('video') && ${audioState}?.duck === 1`, 15000), JSON.stringify(await v.evaluate(audioState)));
  await s.api('PUT', `/api/slideshows/${ss}/slides/${saved.id}/sound`, { sound: true, withSound: 'pause' });
  check('paused instead: the background audio pauses while the video plays', await v.until(`${audioState}?.paused === true && !!document.querySelector('video')`, 20000), JSON.stringify(await v.evaluate(audioState)));
  check('  … and carries on after', await v.until(`${audioState}?.paused === false && ${audioState}?.playing === true && !document.querySelector('video')`, 15000), JSON.stringify(await v.evaluate(audioState)));

  // Event audio: another show, started by hand from its page
  const drill = (await s.api('POST', '/api/audioshows', { name: 'Fire drill' })).data.folder;
  const drillTrack = new FormData();
  drillTrack.append('files', new Blob([fs.readFileSync(path.join(dir, 'tune.mp3'))], { type: 'audio/mpeg' }), 'tune.mp3');
  await s.api('POST', `/api/audioshows/${drill}/tracks`, drillTrack);
  for (let i = 0; i < 300; i++) {
    if ((await s.api('GET', `/api/audioshows/${drill}/tracks`)).data.every((t) => t.status === 'ready')) break;
    await sleep(100);
  }
  await s.api('PUT', `/api/audioshows/${drill}`, { enabled: true });
  await c.go(`${env.base}/admin/audio/${drill}`);
  const eventCard = `[...document.querySelectorAll('.card')].find((x) => x.textContent.includes('Event audio'))`;
  const cardText = `((${eventCard})?.innerText ?? '').replace(/\\s+/g, ' ')`;
  check('the Event audio card: off', await c.until(`${cardText}.includes('Off: this show plays only behind the slideshows that choose it.')`), await c.evaluate(cardText));
  await c.evaluate(`[...(${eventCard}).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click()`);
  await c.until(`!!document.querySelector('#audio-event-mode')`);
  await c.evaluate(`(() => { const m = document.querySelector('#audio-event-mode'); m.value = 'now'; m.dispatchEvent(new Event('change')); })()`);
  await c.until(`[...(${eventCard}).querySelectorAll('button[type=submit]')].some((b) => b.textContent.trim() === 'Start now')`);
  await c.evaluate(`[...(${eventCard}).querySelectorAll('button[type=submit]')].find((b) => b.textContent.trim() === 'Start now').click()`);
  check('Start now: playing now on every screen', await c.until(`${cardText}.includes('playing now on every screen')`), await c.evaluate(cardText));
  check('  … the screen plays the event\'s show instead', await v.until(`${audioState}?.show === ${JSON.stringify(drill)}`, 10000), JSON.stringify(await v.evaluate(audioState)));
  await c.evaluate(`[...(${eventCard}).querySelectorAll('button')].find((b) => b.textContent.includes('Stop')).click()`);
  check('Stop: the event is off', await c.until(`${cardText}.includes('Off: this show plays')`), await c.evaluate(cardText));
  check('  … and the screen is back on the slideshow\'s show', await v.until(`${audioState}?.show === ${JSON.stringify(music)}`, 10000), JSON.stringify(await v.evaluate(audioState)));

  // Overlapping another show's event: refused, naming it (tomorrow, so nothing plays)
  const day = new Date(Date.now() + 24 * 3600 * 1000);
  const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  await s.api('PUT', `/api/audioshows/${music}/event`, { mode: 'once', from: `${ymd}T10:00`, to: `${ymd}T12:00` });
  await c.evaluate(`[...(${eventCard}).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click()`);
  await c.until(`!!document.querySelector('#audio-event-mode')`);
  await c.evaluate(`(() => { const m = document.querySelector('#audio-event-mode'); m.value = 'once'; m.dispatchEvent(new Event('change')); })()`);
  await c.until(`!!document.querySelector('#audio-event-from')`);
  await c.evaluate(`(() => {
    const set = (sel, v) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event('input')); };
    set('#audio-event-from', '${ymd}T11:00'); set('#audio-event-to', '${ymd}T13:00');
    [...(${eventCard}).querySelectorAll('button[type=submit]')].find((b) => b.textContent.trim() === 'Save').click();
  })()`);
  check('an overlapping event is refused, naming the other show', await c.until(`${cardText}.includes('Clashes with “Lobby music”')`), await c.evaluate(cardText));
  await s.api('PUT', `/api/audioshows/${music}/event`, { event: null });

  // None
  await c.go(`${env.base}/admin/slideshows/${ss}`);
  await c.until(`[...document.querySelectorAll('.card-actions button')].some((b) => b.textContent.trim() === 'Edit')`);
  await c.evaluate(`[...document.querySelectorAll('.card-actions button')].find((b) => b.textContent.trim() === 'Edit').click()`);
  await c.until(`!!document.querySelector('#slideshow-audio')`);
  await c.evaluate(`(() => { const sel = document.querySelector('#slideshow-audio'); sel.value = ''; sel.dispatchEvent(new Event('change')); [...document.querySelectorAll('button[type=submit]')].find((b) => b.textContent.trim() === 'Save').click(); })()`);
  check('None: the fact says so', await c.until(`${fact} === 'Background audio None'`), await c.evaluate(fact));
  check('  … and the screen\'s audio stops', await v.until(`${audioState}?.show === null`, 10000));

  // ?debug=audio: the read-only panel showing what the audio is doing (§18.3 phase 8)
  await v.go(env.base + '/?kiosk=off&debug=audio');
  check('?debug=audio shows the engine, its audio elements and the video', await v.until(`/engine: /.test(document.querySelector('.audio-debug')?.innerText ?? '') && /video: /.test(document.querySelector('.audio-debug').innerText)`, 10000), await v.evaluate(`document.querySelector('.audio-debug')?.innerText ?? '(no panel)'`));
  v.close();
  c.close();
  await s.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
