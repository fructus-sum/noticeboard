// Background audio (SYSTEM_DESIGN §18.3, phase 4): choosing a slideshow's audio show in its
// settings (only published shows offered; the fact shows its name), and the viewer following it:
// the slideshow on screen gives the engine its audio show, a change reaches an open screen, and
// "None" takes it away. A headless browser may refuse sound, so the engine's state is checked
// (window.noticeboardAudio), not what is heard; a click on the screen starts refused sound at once.
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

(async () => {
  const env = makeApp({ port: 3956 });
  const s = server(env);
  await s.start();
  await s.login();

  // A published slideshow with an image, a published audio show with a track, and an unpublished one
  const ss = (await s.api('POST', '/api/slideshows', { name: 'Lobby' })).data.folder;
  const img = new FormData();
  img.append('files', new Blob([await sharp({ create: { width: 800, height: 450, channels: 3, background: '#39c' } }).png().toBuffer()], { type: 'image/png' }), 'x.png');
  await s.api('POST', `/api/slideshows/${ss}/slides`, img);
  await s.api('PUT', `/api/slideshows/${ss}`, { enabled: true });
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

  // None
  await c.go(`${env.base}/admin/slideshows/${ss}`);
  await c.until(`[...document.querySelectorAll('.card-actions button')].some((b) => b.textContent.trim() === 'Edit')`);
  await c.evaluate(`[...document.querySelectorAll('.card-actions button')].find((b) => b.textContent.trim() === 'Edit').click()`);
  await c.until(`!!document.querySelector('#slideshow-audio')`);
  await c.evaluate(`(() => { const sel = document.querySelector('#slideshow-audio'); sel.value = ''; sel.dispatchEvent(new Event('change')); [...document.querySelectorAll('button[type=submit]')].find((b) => b.textContent.trim() === 'Save').click(); })()`);
  check('None: the fact says so', await c.until(`${fact} === 'Background audio None'`), await c.evaluate(fact));
  check('  … and the screen\'s audio stops', await v.until(`${audioState}?.show === null`, 10000));

  v.close();
  c.close();
  await s.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
