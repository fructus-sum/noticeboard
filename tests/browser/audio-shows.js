// The audio pages in the admin panel (SYSTEM_DESIGN §18.3, phase 2): "Audio" in the sidebar, creating
// a show (it opens), its settings (edit, the fade length only with a crossfade, save, publish), the
// track list (upload through the file picker, processing then ready, ▶ plays and ■ stops, rename,
// reorder, delete), "Preview the show" (phase 3: off until a track is ready, plays naming the track,
// ⏭ moves on, ■ stops), and the list page's summary, publish toggle and delete.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeApp, server, page, check, done, sleep, shot, ffmpegEnv, hasFfmpeg } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');

if (!hasFfmpeg()) {
  console.log('SKIPPED: needs ffmpeg (FFMPEG_PATH and FFPROBE_PATH, or ffmpeg on the PATH)');
  process.exit(0);
}
const FFMPEG = ffmpegEnv().FFMPEG_PATH || 'ffmpeg';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-audio-ui-'));
for (const [name, hz] of [['First song.mp3', 440], ['Second song.mp3', 550]]) {
  execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=4`, '-c:a', 'libmp3lame', path.join(dir, name)]);
}

(async () => {
  const env = makeApp({ port: 3954 });
  const s = server(env);
  await s.start();
  const c = await page(connect, { width: 1100, height: 900 });
  await c.login(env.base);

  check('"Audio" is in the sidebar', await c.until(`!!document.querySelector('a.nav__link[href="/admin/audio"]')`));
  await c.evaluate(`document.querySelector('a.nav__link[href="/admin/audio"]').click()`);
  check('the Audio page: no shows yet', await c.until(`document.body.innerText.includes('No audio shows yet')`));

  // Create: it opens
  await c.click('+ New audio show');
  await c.until(`!!document.querySelector('#audio-new-name')`);
  await c.evaluate(`(() => { const i = document.querySelector('#audio-new-name'); i.value = 'Café music'; i.dispatchEvent(new Event('input')); i.form.requestSubmit(); })()`);
  check('creating a show opens it', await c.until(`location.pathname === '/admin/audio/cafe-music' && document.querySelector('h1')?.textContent === 'Café music'`));

  // Settings
  await c.until(`[...document.querySelectorAll('.card-actions button')].some((b) => b.textContent.trim() === 'Edit')`);
  await c.evaluate(`[...document.querySelectorAll('.card-actions button')].find((b) => b.textContent.trim() === 'Edit').click()`);
  await c.until(`!!document.querySelector('#audio-transition')`);
  check('the fade length shows only with a crossfade', !(await c.evaluate(`!!document.querySelector('#audio-fade')`)));
  await c.evaluate(`(() => {
    const set = (sel, v, ev) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event(ev)); };
    set('#audio-order', 'shuffle', 'change'); set('#audio-transition', 'crossfade', 'change');
  })()`);
  await c.until(`!!document.querySelector('#audio-fade')`);
  await c.evaluate(`(() => { const set = (sel, v, ev) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event(ev)); };
    set('#audio-fade', '6', 'input'); set('#audio-volume', '70', 'input'); document.querySelector('form.edit').requestSubmit(); })()`);
  check('saved: the settings show shuffled, crossfade 6 s, 70 %', await c.until(`(document.querySelector('.facts')?.innerText ?? '').includes('Shuffled') && document.querySelector('.facts').innerText.includes('Fade / crossfade, 6 s') && document.querySelector('.facts').innerText.includes('70 %')`));
  const saved = (await s.api('GET', '/api/audioshows/cafe-music', undefined, { auth: false }));
  await s.login();
  const stored = (await s.api('GET', '/api/audioshows/cafe-music')).data;
  check('  … and on the server', stored.order === 'shuffle' && stored.transition === 'crossfade' && stored.fadeSeconds === 6 && stored.volume === 70, JSON.stringify(stored));
  check('  … the API needed the login', saved.status === 401);

  // Preview: nothing to play yet
  const previewBtn = `[...document.querySelectorAll('.preview button')].find((b) => b.textContent.includes('Preview the show'))`;
  check('"Preview the show" is off until a track is ready', await c.evaluate(`${previewBtn}?.disabled === true && document.querySelector('.preview').innerText.includes('Upload a track')`));

  // Upload two tracks through the file picker
  const { root } = await c.send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await c.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  await c.send('DOM.setFileInputFiles', { nodeId, files: [path.join(dir, 'First song.mp3'), path.join(dir, 'Second song.mp3')] });
  check('uploaded tracks become ready, named after their files', await c.until(`[...document.querySelectorAll('.track-row')].length === 2 && [...document.querySelectorAll('.track-row .badge')].every((b) => b.textContent.trim() === 'ready')`, 60000));
  const names = await c.evaluate(`[...document.querySelectorAll('.track-name')].map((n) => n.textContent.trim())`);
  check('  … in upload order, with their length', names.join('|') === 'First song.mp3|Second song.mp3' && (await c.evaluate(`document.querySelector('.track-detail').textContent.trim().startsWith('0:04')`)), names.join('|'));

  // ▶ plays (a real click: browsers only play sound after one), ■ stops
  const box = await c.evaluate(`(() => { const r = document.querySelector('.track-play').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  check('▶ plays the track (the button becomes ■)', await c.until(`document.querySelector('.track-play').textContent.trim() === '■'`, 5000));
  for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  check('■ stops it', await c.until(`document.querySelector('.track-play').textContent.trim() === '▶'`, 5000));

  // Preview the show (a real click again), ⏭, ■
  const clickText = async (text) => {
    const at = await c.evaluate(`(() => { const b = [...document.querySelectorAll('.preview button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  };
  await clickText('Preview the show');
  const playingName = `(document.querySelector('.preview__now strong')?.textContent ?? '').trim()`;
  check('▶ Preview the show plays, naming the track', await c.until(`['First song.mp3', 'Second song.mp3'].includes(${playingName})`, 5000), await c.evaluate(`document.querySelector('.preview')?.innerText`));
  const firstPlayed = await c.evaluate(playingName);
  await clickText('Next track');
  check('  … ⏭ moves to the other track', await c.until(`${playingName} !== '' && ${playingName} !== ${JSON.stringify(firstPlayed)}`, 8000), await c.evaluate(playingName));
  await clickText('Stop');
  check('  … ■ Stop ends the preview', await c.until(`!!(${previewBtn}) && !document.querySelector('.preview__now')`, 5000));

  // Rename, reorder, delete
  await c.evaluate(`[...document.querySelectorAll('.track-row button')].find((b) => b.title === 'Rename').click()`);
  await c.until(`!!document.querySelector('.track-name-input')`);
  await c.send('Input.insertText', { text: 'Opening' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  check('a track is renamed', await c.until(`document.querySelector('.track-name')?.textContent.trim() === 'Opening'`));
  await c.evaluate(`[...document.querySelectorAll('.track-row')][1].querySelector('button[disabled]') ; [...[...document.querySelectorAll('.track-row')][1].querySelectorAll('button')].find((b) => b.textContent.trim() === '↑').click()`);
  check('↑ moves the second track up', await c.until(`[...document.querySelectorAll('.track-name')].map((n) => n.textContent.trim()).join('|') === 'Second song.mp3|Opening'`));
  await sleep(500);
  const order = (await s.api('GET', '/api/audioshows/cafe-music/tracks')).data.map((t) => t.name || t.originalName);
  check('  … and the server has the new order', order.join('|') === 'Second song.mp3|Opening', order.join('|'));
  let question = '';
  c.on((msg) => { if (msg.method === 'Page.javascriptDialogOpening') { question = msg.params.message; c.send('Page.handleJavaScriptDialog', { accept: true }); } });
  await c.evaluate(`document.querySelector('.track-row .btn-danger').click()`);
  check('✕ asks, naming the track, then deletes it', await c.until(`document.querySelectorAll('.track-row').length === 1`) && question === 'Delete “Second song.mp3”?', question);
  await c.screenshot(shot('audio-show.png'));

  // The list page
  await c.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '← Back').click()`);
  await c.until(`document.querySelectorAll('.show-row').length === 1`);
  const summary = await c.evaluate(`document.querySelector('.show-row').innerText.replace(/\\s+/g, ' ')`);
  check('the list shows the show and its settings', summary.includes('Café music') && summary.includes('1 track · Shuffled · Crossfade 6 s · Volume 70 %'), summary);
  await c.evaluate(`document.querySelector('.show-row .show-actions button').click()`);
  check('publishing from the list', await c.until(`document.querySelector('.show-row').innerText.includes('PUBLISHED') || document.querySelector('.show-row').innerText.includes('Published')`));
  await c.screenshot(shot('audio-list.png'));
  await c.evaluate(`document.querySelector('.show-row .btn-danger').click()`);
  check('deleting a show (after asking)', await c.until(`document.querySelectorAll('.show-row').length === 0`) && question.startsWith('Delete the audio show “Café music”?'), question);

  c.close();
  await s.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
